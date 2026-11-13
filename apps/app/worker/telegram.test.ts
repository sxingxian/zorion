import { beforeAll, describe, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import type { Deps, Env } from './core';
import { cleanUp } from './extras';
import { createApp } from './index';
import { asTelegram } from './telegram';

const env: Env = {
  DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'test-pepper', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef'),
  ENVIRONMENT: 'development', TELEGRAM_BOT_USERNAME: 'ZorionTestBot', TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_WEBHOOK_SECRET: 'tg-secret',
};

function browser(app: ReturnType<typeof createApp>, ip = '198.51.100.1') {
  const jar = new Map<string, string>();
  return async (method: string, path: string, json?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-zorion': '1', origin: env.APP_ORIGIN, 'cf-connecting-ip': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [k, v] = pair!.split('=');
      if (v) jar.set(k!, v);
      else jar.delete(k!);
    }
    return { status: res.status, body: (await res.json()) as any };
  };
}

// What Zorion sent to Telegram, and a switch to make Telegram answer "blocked".
const sent: Array<{ chat_id: string; text: string; parse_mode: string; link_preview_options: unknown }> = [];
let blocked = false;
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (u.includes('overpass')) return Response.json({ elements: Array.from({ length: 8 }, (_, i) => ({ type: 'node', id: i + 1, lat: 1.3, lon: 103.85 + i * 0.001, tags: { name: `Place ${i + 1}`, 'addr:street': 'Demo <Street>' } })) });
  if (u === 'https://api.telegram.org/bot123:ABC/sendMessage') {
    if (blocked) return Response.json({ ok: false, description: 'Forbidden: bot was blocked by the user' }, { status: 403 });
    sent.push(JSON.parse(String(init!.body)));
    return Response.json({ ok: true });
  }
  throw new Error(`unexpected fetch ${u}`);
}) as unknown as typeof fetch;

let deps: Partial<Deps>;
let app: ReturnType<typeof createApp>;
let h: ReturnType<typeof browser>;
let priya: ReturnType<typeof browser>;
let id = '';
let token = '';

/** Telegram calling our webhook, as a person pressing Start or typing a command in a private chat. */
const telegram = (chatId: number, text: string, opts: { secret?: string; type?: string } = {}) =>
  app.request('/api/webhooks/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.secret === '' ? {} : { 'x-telegram-bot-api-secret-token': opts.secret ?? 'tg-secret' }) },
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, text, chat: { id: chatId, type: opts.type ?? 'private' } } }),
  });
const startOf = (url: string) => new URL(url).searchParams.get('start')!;
const inbox = () => deps.outbox!.splice(0);
const g = (path: string, json?: unknown) => priya('POST', `/api/g/${token}${path}`, json);

beforeAll(async () => {
  deps = { db: await testDb(), env, fetch: fakeFetch, now: () => new Date('2026-11-13T04:00:00Z'), outbox: [] };
  app = createApp(deps);
  h = browser(app);
  await h('POST', '/api/auth/email-code', { email: 'maya@example.com' });
  await h('POST', '/api/auth/email-code/verify', { email: 'maya@example.com', code: inbox().at(-1)!.text.match(/\d{6}/)![0] });
  const made = await h('POST', '/api/meetups', { name: 'Midnight poetry party', timeZone: 'Asia/Singapore', startsAt: '2026-12-01T12:00:00.000Z', invitees: ['Priya'], ballot: [{ key: 'pizza' }, { key: 'ramen' }] });
  id = made.body.meetup.id;
  token = made.body.meetup.link.split('/j/')[1];
  await h('POST', `/api/meetups/${id}/vote`, { keys: ['pizza'] });
  await h('POST', `/api/meetups/${id}/share`, {});
  await h('POST', `/api/meetups/${id}/location`, { lat: 1.3, lng: 103.84 });
  priya = browser(app, '198.51.100.2');
  const view = (await priya('GET', `/api/g/${token}`)).body.meetup;
  await g('/join', { participantId: view.people.find((x: any) => x.name === 'Priya').id });
  inbox();
});

describe('the bot webhook', () => {
  it('ignores anything without the secret Telegram was given', async () => {
    expect((await telegram(5, '/start whatever', { secret: '' })).status).toBe(404);
    expect((await telegram(5, '/start whatever', { secret: 'wrong' })).status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('never connects a group chat', async () => {
    const { url } = (await g('/telegram')).body;
    expect((await telegram(-100, `/start ${startOf(url)}`, { type: 'group' })).status).toBe(200);
    expect(sent).toHaveLength(0);
    expect((await priya('GET', `/api/g/${token}`)).body.meetup.me.telegram).toBe(false);
  });
});

describe('a guest on Telegram', () => {
  it('connects with a one-time link opened in their own Telegram', async () => {
    expect((await priya('GET', `/api/g/${token}`)).body.meetup.telegramReady).toBe(true);
    const { url } = (await g('/telegram')).body;
    expect(url).toMatch(/^https:\/\/t\.me\/ZorionTestBot\?start=[A-Za-z0-9_-]{32}$/);
    await telegram(1001, `/start ${startOf(url)}`);
    expect(sent.at(-1)!.chat_id).toBe('1001');
    expect(sent.at(-1)!.text).toContain('Connected. You\'ll get updates about "Midnight poetry party" here.');
    expect((await priya('GET', `/api/g/${token}`)).body.meetup.me.telegram).toBe(true);
    // The host and other people never learn the chat.
    expect(JSON.stringify((await h('GET', `/api/meetups/${id}`)).body)).not.toContain('1001');

    // The same link cannot be used twice, for example by someone it was forwarded to.
    await telegram(2002, `/start ${startOf(url)}`);
    expect(sent.at(-1)!.chat_id).toBe('2002');
    expect(sent.at(-1)!.text).toContain('This link has expired or was already used.');
  });

  it('gets the same update as the email, laid out like it', async () => {
    await g('/email', { email: 'priya@example.com' });
    const confirm = inbox().at(-1)!.text.match(/\?confirm=(\S+)/)![1]!;
    await g('/email/confirm', { t: confirm });
    for (const step of ['/rsvp', '/location', '/categories'] as const) {
      await g(step, step === '/rsvp' ? { rsvp: 'going' } : step === '/location' ? { lat: 1.3, lng: 103.86 } : { keys: ['pizza'] });
    }
    inbox();
    sent.length = 0;
    const places = (await h('POST', `/api/meetups/${id}/middle`, {})).body.meetup.places;
    await h('POST', `/api/meetups/${id}/shortlist`, { ids: [places[0].id] }); // one place: confirmed straight away
    const mail = inbox().filter((m) => m.to === 'priya@example.com');
    const tg = sent.filter((m) => m.chat_id === '1001');
    expect(mail).toHaveLength(1);
    expect(tg).toHaveLength(1);
    const [subject, ...rest] = tg[0]!.text.split('\n\n');
    expect(subject).toBe('<b>It is on: Midnight poetry party</b>');
    expect(mail[0]!.subject).toBe('It is on: Midnight poetry party');
    // Line for line the same as the email, except the last line, which says how to stop on that channel.
    const mailLines = mail[0]!.text.split('\n');
    const tgLines = rest.join('\n\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').split('\n');
    expect(tgLines.slice(0, -1)).toEqual(mailLines.slice(0, -1));
    expect(tgLines.at(-1)).toBe('Send /stop to stop these updates.');
    expect(mailLines.at(-1)).toMatch(/Stop these updates: http:\/\/localhost:5173\/j\/.+\?stop=/);
    expect(tg[0]!.parse_mode).toBe('HTML');
    expect(tg[0]!.link_preview_options).toEqual({ is_disabled: true });
    expect(tg[0]!.text).toContain('Demo &lt;Street&gt;'); // place details from OpenStreetMap are escaped
  });

  it('stops with /stop, and email updates carry on', async () => {
    await telegram(1001, '/stop');
    expect(sent.at(-1)!.text).toContain('Stopped. You won\'t get more messages here.');
    const me = (await priya('GET', `/api/g/${token}`)).body.meetup.me;
    expect(me.telegram).toBe(false);
    expect(me.email.confirmed).toBe(true);
  });

  it('is forgotten when the person blocks the bot', async () => {
    const { url } = (await g('/telegram')).body;
    await telegram(1001, `/start ${startOf(url)}`);
    blocked = true;
    await h('PATCH', `/api/meetups/${id}`, { startsAt: '2026-12-02T12:00:00.000Z' });
    blocked = false;
    expect((await priya('GET', `/api/g/${token}`)).body.meetup.me.telegram).toBe(false);
    expect(inbox().some((m) => m.to === 'priya@example.com' && m.subject.startsWith('New date'))).toBe(true); // email still went
  });

  it('can be switched off from the meetup page', async () => {
    const { url } = (await g('/telegram')).body;
    await telegram(1001, `/start ${startOf(url)}`);
    expect((await g('/telegram/stop', {})).body.meetup.me.telegram).toBe(false);
  });
});

describe('a host on Telegram', () => {
  it('connects from Account and gets the news there too', async () => {
    expect((await h('GET', '/api/auth/me')).body.telegram).toBe(true);
    const { url } = (await h('POST', '/api/account/telegram', {})).body;
    await telegram(3003, `/start ${startOf(url)}`);
    expect(sent.at(-1)!.text).toContain('Connected. You\'ll get updates about meetups you host here.');
    expect((await h('GET', '/api/auth/me')).body.user.telegram).toBe(true);
    sent.length = 0;
    inbox();
    await (deps.db as any).query("update participants set amend_until = now() + interval '10 minutes'");
    await g('/rsvp', { rsvp: 'maybe' });
    expect(sent.map((m) => [m.chat_id, m.text.split('\n')[0]])).toEqual([['3003', '<b>A guest changed their reply for Midnight poetry party</b>']]);
    expect(sent[0]!.text).toContain('Turn these off under Account: http://localhost:5173/account, or send /stop.');
    expect(inbox().map((m) => m.to)).toEqual(['maya@example.com', 'telegram:3003']); // both channels, the same news
  });

  it('can have Telegram only: email off, Telegram on', async () => {
    await h('PATCH', '/api/account', { notify: false });
    await (deps.db as any).query('delete from notices');
    sent.length = 0;
    await (deps.db as any).query("update participants set amend_until = now() + interval '10 minutes'");
    await g('/rsvp', { rsvp: 'going' });
    expect(sent.map((m) => m.chat_id)).toEqual(['3003']);
    expect(inbox().filter((m) => m.to === 'maya@example.com').map((m) => m.subject)).toEqual([]);
    expect((await h('GET', '/api/account/export')).body.account).toMatchObject({ emailsAboutMeetups: false, telegramConnected: true });
  });

  it('disconnects from Account', async () => {
    await h('POST', '/api/account/telegram/stop', {});
    expect((await h('GET', '/api/auth/me')).body.user.telegram).toBe(false);
  });
});

describe('housekeeping', () => {
  it('limits links to ten an hour per person', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await g('/telegram')).status);
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true); // four were made earlier in this file
    expect(statuses[6]).toBe(429);
    await (deps.db as any).query('delete from throttles');
  });

  it('erases guest chats and old links when the meetup ends', async () => {
    const { url } = (await g('/telegram')).body;
    await telegram(1001, `/start ${startOf(url)}`);
    await g('/telegram');
    await (deps.db as any).query("update telegram_links set expires_at = now() - interval '1 minute'");
    await (deps.db as any).query("update meetups set starts_at = now() - interval '2 days'");
    await cleanUp(deps.db!);
    expect(await (deps.db as any).query('select count(*)::int as n from participants where telegram_chat_id is not null')).toEqual([{ n: 0 }]);
    expect(await (deps.db as any).query('select count(*)::int as n from telegram_links')).toEqual([{ n: 0 }]);
  });

  it('is hidden when no bot is set up', async () => {
    const plain = createApp({ ...deps, env: { ...env, TELEGRAM_BOT_USERNAME: undefined } });
    expect((await (await plain.request('/api/auth/me')).json()).telegram).toBe(false);
  });

  it('escapes Telegram formatting in every message', () => {
    expect(asTelegram('A & B', 'x < y > z')).toBe('<b>A &amp; B</b>\n\nx &lt; y &gt; z');
  });
});

describe('connecting the bot to the app', () => {
  it('sets the webhook once, and again only when the address or the secret changes', async () => {
    const { ensureTelegramWebhook } = await import('./telegram');
    const calls: string[] = [];
    let current = '';
    const fetchTg = (async (url: string, init?: RequestInit) => {
      const method = String(url).split('/').at(-1)!;
      calls.push(method);
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (method === 'setWebhook') {
        expect(body).toEqual({ url: 'https://zorionapp.example/api/webhooks/telegram', secret_token: body.secret_token, allowed_updates: ['message'] });
        current = body.url;
      }
      return Response.json({ ok: true, result: method === 'getWebhookInfo' ? { url: current } : true });
    }) as unknown as typeof fetch;
    const prod = (secret: string) => ({ db: deps.db!, env: { ...env, APP_ORIGIN: 'https://zorionapp.example', TELEGRAM_WEBHOOK_SECRET: secret }, fetch: fetchTg, now: deps.now!, outbox: [] }) as Deps;

    expect(await ensureTelegramWebhook(prod('first-secret-value'))).toBe('set');
    expect(calls).toEqual(['getWebhookInfo', 'setWebhook', 'setMyCommands']);
    calls.length = 0;
    expect(await ensureTelegramWebhook(prod('first-secret-value'))).toBe('ok');
    expect(calls).toEqual(['getWebhookInfo']);
    calls.length = 0;
    expect(await ensureTelegramWebhook(prod('a-new-secret-value'))).toBe('set'); // the secret was replaced
    expect(calls).toContain('setWebhook');
    expect(await ensureTelegramWebhook({ ...prod('x'), env: { ...env, TELEGRAM_BOT_TOKEN: undefined } } as Deps)).toBe('off');
    expect(await ensureTelegramWebhook({ ...prod('x'), env: { ...env, APP_ORIGIN: 'http://localhost:5173' } } as Deps)).toBe('off'); // Telegram needs https
  });
});
