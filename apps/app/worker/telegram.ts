// Telegram: the same updates as email, sent by Zorion's bot to people who connected a chat.
import { Hono } from 'hono';
import type { Db, Row } from '@zorion/db';
import { one } from '@zorion/db';
import { type App, type Deps, isProd } from './core';
import { randomToken, safeEqual, sha256 } from './crypto';

/** On when a bot is named, and either its token is set or this is development (messages then stay in the outbox). */
export const telegramReady = (deps: Deps): boolean => !!deps.env.TELEGRAM_BOT_USERNAME && (!!deps.env.TELEGRAM_BOT_TOKEN || !isProd(deps.env));

const LINK_MINUTES = 30;

/** A one-time link that opens the bot. Pressing Start in Telegram connects that chat. */
export async function connectLink(deps: Deps, owner: { userId: string } | { participantId: string }): Promise<string> {
  const token = randomToken(24); // 32 characters of A-Z a-z 0-9 _ -, as Telegram's start parameter allows
  await deps.db.batch([
    // One open link per person: a new one replaces the old.
    ['userId' in owner ? 'delete from telegram_links where user_id = $1' : 'delete from telegram_links where participant_id = $1', ['userId' in owner ? owner.userId : owner.participantId]],
    ['insert into telegram_links (token_hash, user_id, participant_id, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4::int))',
      [await sha256(token), 'userId' in owner ? owner.userId : null, 'participantId' in owner ? owner.participantId : null, LINK_MINUTES]],
  ]);
  return `https://t.me/${deps.env.TELEGRAM_BOT_USERNAME}?start=${token}`;
}

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Laid out like the email: the subject in bold, a blank line, then the same lines of text. */
export function asTelegram(subject: string | null, body: string): string {
  return (subject ? `<b>${escape(subject)}</b>\n\n${escape(body)}` : escape(body)).slice(0, 4000);
}

/** Forgets a chat everywhere. Used for /stop, and when Telegram says the person blocked the bot. */
export async function forgetChat(db: Db, chatId: string): Promise<void> {
  await db.batch([
    ['update users set telegram_chat_id = null where telegram_chat_id = $1', [chatId]],
    ['update participants set telegram_chat_id = null where telegram_chat_id = $1', [chatId]],
  ]);
}

export async function sendTelegram(deps: Deps, chatId: string, subject: string | null, body: string): Promise<void> {
  deps.outbox.push({ to: `telegram:${chatId}`, subject: subject ?? '', text: body });
  if (deps.outbox.length > 30) deps.outbox.shift();
  const token = deps.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    if (isProd(deps.env)) throw new Error('Telegram is not configured: set TELEGRAM_BOT_TOKEN');
    return; // development: the message stays in the outbox
  }
  const res = await deps.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: asTelegram(subject, body), parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 403) {
    await forgetChat(deps.db, chatId); // blocked or deleted: stop trying
    return;
  }
  if (!res.ok) throw new Error(`Telegram refused the message (${res.status})`);
}

/** Replies inside the bot chat. Plain text, no subject line. */
const reply = (deps: Deps, chatId: string, text: string) => sendTelegram(deps, chatId, null, text);

// ---------- the bot's webhook ----------

export const telegramWebhook = new Hono<App>();

telegramWebhook.post('/', async (c) => {
  const deps = c.get('deps');
  const secret = deps.env.TELEGRAM_WEBHOOK_SECRET;
  // Telegram sends the secret we gave it when we set the webhook. Without it, nothing here runs.
  if (!secret || !safeEqual(c.req.header('x-telegram-bot-api-secret-token') ?? '', secret)) return c.json({ error: 'not_found' }, 404);
  const update = (await c.req.json().catch(() => null)) as { message?: { text?: string; chat?: { id?: number | string; type?: string } } } | null;
  const msg = update?.message;
  const rawId = msg?.chat?.id;
  // Private chats only: updates are personal, so they never go to a group.
  if (!msg || rawId === undefined || msg.chat?.type !== 'private' || typeof msg.text !== 'string') return c.json({ ok: true });
  const chatId = String(rawId);
  const [command, arg] = msg.text.trim().split(/\s+/, 2) as [string, string | undefined];
  try {
    if (command === '/start' && arg && /^[A-Za-z0-9_-]{16,64}$/.test(arg)) await connect(deps, chatId, arg);
    else if (command === '/stop') {
      await forgetChat(deps.db, chatId);
      await reply(deps, chatId, "Stopped. You won't get more messages here.");
    } else {
      await reply(deps, chatId, 'Zorion sends meetup updates here. Connect from a meetup page, or under Account if you host. Send /stop to stop.');
    }
  } catch (err) {
    console.error('telegram update not handled', err instanceof Error ? err.message : err);
  }
  return c.json({ ok: true }); // always 200, so Telegram does not keep retrying
});

async function connect(deps: Deps, chatId: string, token: string): Promise<void> {
  const link = await one(deps.db, 'delete from telegram_links where token_hash = $1 returning user_id, participant_id, expires_at > now() as live', [await sha256(token)]);
  if (!link?.live) {
    await reply(deps, chatId, 'This link has expired or was already used. Get a new one from the meetup page.');
    return;
  }
  if (link.user_id) {
    await deps.db.query('update users set telegram_chat_id = $2 where id = $1', [link.user_id, chatId]);
    await reply(deps, chatId, "Connected. You'll get updates about meetups you host here. Send /stop to stop.");
    return;
  }
  const p = (await one(deps.db, `update participants p set telegram_chat_id = $2 from meetups m where p.id = $1 and m.id = p.meetup_id returning p.name, m.name as meetup`, [link.participant_id, chatId])) as Row | null;
  if (p) await reply(deps, chatId, `Connected. You'll get updates about "${p.meetup}" here. Send /stop to stop.`);
}

// ---------- connecting the bot to the app ----------

/**
 * Points the bot's webhook at this app, so nobody has to run a set-up command. Runs with the hourly job.
 * Telegram does not say which secret a webhook uses, so a hash of the one we gave it is remembered and the
 * webhook is set again whenever the address or the secret changes.
 */
export async function ensureTelegramWebhook(deps: Deps): Promise<'off' | 'ok' | 'set'> {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret, APP_ORIGIN } = deps.env;
  const url = `${APP_ORIGIN}/api/webhooks/telegram`;
  if (!token || !secret || !url.startsWith('https://')) return 'off';
  const call = async (method: string, body: unknown = {}) => {
    const res = await deps.fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: { url?: string }; description?: string } | null;
    if (!data?.ok) throw new Error(`Telegram ${method} failed: ${data?.description ?? res.status}`);
    return data.result;
  };
  const want = { url, secret: await sha256(secret) };
  const saved = (await one(deps.db, "select value from settings where key = 'telegram_webhook'"))?.value as typeof want | undefined;
  const current = await call('getWebhookInfo');
  if (current?.url === url && saved?.url === url && saved.secret === want.secret) return 'ok';
  await call('setWebhook', { url, secret_token: secret, allowed_updates: ['message'] });
  await call('setMyCommands', { commands: [{ command: 'stop', description: 'Stop all messages from Zorion' }] });
  await deps.db.query("insert into settings (key, value) values ('telegram_webhook', $1) on conflict (key) do update set value = excluded.value, updated_at = now()", [JSON.stringify(want)]);
  return 'set';
}
