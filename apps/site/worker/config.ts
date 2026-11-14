// Admin portal settings: plans and prices, Stripe, the Telegram bot, email, categories and admins.
// Keys are write-only: the browser only ever sees whether one is set and its last four characters.
// Changing a key needs a super admin and a fresh authenticator code, and is written to the audit log.
import { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_PLANS, ICONS, TRAVEL_MODES, normalizePlans } from '@zorion/core';
import { one } from '@zorion/db';
import { hashPassword, newTotpSecret, otpauthUri, randomToken, seal, sha256, unseal, verifyTotp } from '@zorion/server/crypto';
import { DEFAULT_EMAIL_FROM, EMAIL_STATUS_KEY, type EmailStatus, type SettingName, loadSettings, readJson, saveSetting, settingsStatus, tidySettings } from '@zorion/server/settings';
import { googleUsage } from '@zorion/server/google';
import { type App, type C, Fail, audit, body, need, stepUp } from './core';

export const config = new Hono<App>();

const save = (c: C, name: SettingName, value: string | null) => saveSetting(c.get('deps').db, c.get('deps').env.TOTP_KEY, name, value);
const saved = async (c: C) => ({ ...(c.get('deps').env as unknown as Record<string, string>), ...(await loadSettings(c.get('deps').db, c.get('deps').env.TOTP_KEY)) });
const putJson = (c: C, key: string, value: unknown) => c.get('deps').db.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, JSON.stringify(value)]);
const code = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator.');

// ---------- plans and prices ----------
export async function plans(c: C) {
  const { db } = c.get('deps');
  const [p, legacy] = await Promise.all([one(db, "select value from settings where key = 'plans'"), one(db, "select value from settings where key = 'group_size'")]);
  return normalizePlans(p?.value, { groupSize: legacy?.value as { free?: number; pro?: number } | undefined });
}
const featureSchema = z.object({
  ads: z.boolean(), groupSize: z.number().int().min(2).max(200), activeMeetups: z.number().int().min(0).max(100),
  travel: z.array(z.enum(TRAVEL_MODES as [string, ...string[]])).max(3), ownCategories: z.boolean(), goldTheme: z.boolean(), guestTheme: z.boolean(),
});
config.get('/plans', async (c) => { need(c); return c.json({ plans: await plans(c), defaults: DEFAULT_PLANS }); });
config.put('/plans', async (c) => {
  need(c, 'super');
  const input = await body(c, z.object({ free: featureSchema, pro: featureSchema, price: z.object({ monthly: z.number().int().min(0).max(100_000), yearly: z.number().int().min(0).max(1_000_000) }) }));
  if ((input.price.monthly > 0 && input.price.monthly < 100) || (input.price.yearly > 0 && input.price.yearly < 100)) throw new Fail(422, 'invalid', 'Prices must be at least S$1, or 0 to stop selling.');
  const next = normalizePlans({ ...input, price: { currency: 'sgd', ...input.price } });
  await putJson(c, 'plans', next);
  await audit(c, 'plans.save', null, { price: next.price, free: next.free, pro: next.pro });
  return c.json({ plans: next });
});

// ---------- Stripe ----------
const STRIPE_EVENTS = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'];
async function stripeCall(c: C, key: string, method: 'GET' | 'POST' | 'DELETE', path: string, form?: Array<[string, string]>) {
  const res = await c.get('deps').fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Fail(res.status === 401 ? 422 : 409, 'stripe', data?.error?.message ? `Stripe: ${data.error.message}` : `Stripe refused the request (${res.status}).`);
  return data;
}
const webhookUrl = (c: C) => `${c.get('deps').env.APP_ORIGIN}/api/webhooks/stripe`;
const keyMode = (k: string | undefined) => (!k ? null : /_live_/.test(k) ? 'live' : 'test');

config.get('/payments', async (c) => {
  need(c);
  const { db, env } = c.get('deps');
  const status = await settingsStatus(db, env as unknown as Record<string, unknown>);
  const s = await saved(c);
  const [last, subs] = await Promise.all([
    one(db, 'select max(received_at) as at from stripe_events'),
    one(db, "select count(*) filter (where status in ('active', 'trialing', 'past_due'))::int as live, count(*)::int as total from subscriptions"),
  ]);
  return c.json({
    key: status.STRIPE_SECRET_KEY, webhook: status.STRIPE_WEBHOOK_SECRET, mode: keyMode(s.STRIPE_SECRET_KEY),
    webhookUrl: webhookUrl(c), lastEventAt: last?.at ?? null, subscriptions: subs, prices: (await plans(c)).price,
  });
});
config.post('/payments/check', async (c) => {
  need(c);
  const key = (await saved(c)).STRIPE_SECRET_KEY;
  if (!key) return c.json({ ok: false, message: 'No Stripe key yet.' });
  const account = await stripeCall(c, key, 'GET', 'account');
  const hooks = await stripeCall(c, key, 'GET', 'webhook_endpoints?limit=100');
  const ours = (hooks.data as any[]).find((h) => h.url === webhookUrl(c));
  return c.json({
    ok: true,
    account: { name: account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? account.email ?? account.id, country: account.country, charges: !!account.charges_enabled, payouts: !!account.payouts_enabled, details: !!account.details_submitted },
    webhook: ours ? { status: ours.status, events: STRIPE_EVENTS.every((e) => ours.enabled_events.includes(e) || ours.enabled_events.includes('*')) } : null,
  });
});
/** Creates Zorion's webhook in Stripe and keeps its signing secret, replacing any earlier one for the same address. */
async function connectWebhook(c: C, key: string) {
  const hooks = await stripeCall(c, key, 'GET', 'webhook_endpoints?limit=100');
  for (const h of (hooks.data as any[]).filter((h) => h.url === webhookUrl(c))) await stripeCall(c, key, 'DELETE', `webhook_endpoints/${encodeURIComponent(h.id)}`);
  const made = await stripeCall(c, key, 'POST', 'webhook_endpoints', [['url', webhookUrl(c)], ['description', 'Zorion'], ...STRIPE_EVENTS.map((e): [string, string] => ['enabled_events[]', e])]);
  await save(c, 'STRIPE_WEBHOOK_SECRET', made.secret);
  await audit(c, 'stripe.webhook', null, { url: webhookUrl(c) });
}
/** Saves the key; with connect (the portal's one Connect button) it also sets up the webhook, under the same code. */
config.put('/payments/key', async (c) => {
  const input = await body(c, z.object({ secretKey: z.string().trim().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/, "That isn't a Stripe secret key. It starts with sk_live_ or sk_test_."), code, connect: z.boolean().optional() }));
  await stepUp(c, input.code);
  await stripeCall(c, input.secretKey, 'GET', 'account'); // refuses a wrong key before it is saved
  await save(c, 'STRIPE_SECRET_KEY', input.secretKey);
  await audit(c, 'stripe.key', null, { mode: keyMode(input.secretKey), ends: input.secretKey.slice(-4) });
  if (input.connect) await connectWebhook(c, input.secretKey);
  return c.json({ ok: true });
});
config.post('/payments/webhook', async (c) => {
  const input = await body(c, z.object({ code }));
  await stepUp(c, input.code);
  const key = (await saved(c)).STRIPE_SECRET_KEY;
  if (!key) throw new Fail(409, 'no_key', 'Connect a Stripe key first.');
  await connectWebhook(c, key);
  return c.json({ ok: true });
});
config.post('/payments/remove', async (c) => {
  const input = await body(c, z.object({ code }));
  await stepUp(c, input.code);
  await save(c, 'STRIPE_SECRET_KEY', null);
  await save(c, 'STRIPE_WEBHOOK_SECRET', null);
  await audit(c, 'stripe.remove', null);
  return c.json({ ok: true });
});

// ---------- Telegram ----------
async function tg(c: C, token: string, method: string, payload: unknown = {}) {
  const res = await c.get('deps').fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: any; description?: string } | null;
  if (!data?.ok) throw new Fail(422, 'telegram', `Telegram: ${data?.description ?? `request failed (${res.status})`}`);
  return data.result;
}
const tgUrl = (c: C) => `${c.get('deps').env.APP_ORIGIN}/api/webhooks/telegram`;

config.get('/telegram', async (c) => {
  need(c);
  const st = await settingsStatus(c.get('deps').db, c.get('deps').env as unknown as Record<string, unknown>);
  return c.json({ token: st.TELEGRAM_BOT_TOKEN, username: st.TELEGRAM_BOT_USERNAME.hint || null, webhookUrl: tgUrl(c) });
});
config.post('/telegram/check', async (c) => {
  need(c);
  const token = (await saved(c)).TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ ok: false, message: 'No bot yet.' });
  const [me, hook] = await Promise.all([tg(c, token, 'getMe'), tg(c, token, 'getWebhookInfo')]);
  return c.json({ ok: true, bot: { name: me.first_name, username: me.username }, webhook: { connected: hook.url === tgUrl(c), pending: hook.pending_update_count ?? 0, lastError: hook.last_error_message ?? null } });
});
config.put('/telegram', async (c) => {
  const input = await body(c, z.object({ token: z.string().trim().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,50}$/, 'That is not a bot token from @BotFather.'), code }));
  await stepUp(c, input.code);
  const me = await tg(c, input.token, 'getMe');
  const secret = randomToken(32).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!tgUrl(c).startsWith('https://')) throw new Fail(409, 'not_https', 'Telegram needs the app on https.');
  await tg(c, input.token, 'setWebhook', { url: tgUrl(c), secret_token: secret, allowed_updates: ['message'] });
  await tg(c, input.token, 'setMyCommands', { commands: [{ command: 'stop', description: 'Stop all messages from Zorion' }] });
  await save(c, 'TELEGRAM_BOT_TOKEN', input.token);
  await save(c, 'TELEGRAM_BOT_USERNAME', me.username);
  await save(c, 'TELEGRAM_WEBHOOK_SECRET', secret);
  // The app checks this record so it does not set the webhook again.
  await putJson(c, 'telegram_webhook', { url: tgUrl(c), secret: await sha256(secret) });
  await audit(c, 'telegram.connect', me.username);
  return c.json({ ok: true, username: me.username });
});
config.post('/telegram/remove', async (c) => {
  const input = await body(c, z.object({ code }));
  await stepUp(c, input.code);
  const token = (await saved(c)).TELEGRAM_BOT_TOKEN;
  if (token) await tg(c, token, 'deleteWebhook').catch(() => {});
  for (const n of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET'] as const) await save(c, n, null);
  await c.get('deps').db.query("delete from settings where key = 'telegram_webhook'");
  await audit(c, 'telegram.remove', null);
  return c.json({ ok: true });
});

// ---------- email (Resend) ----------
const fromSchema = z.string().trim().max(120).regex(/^([^<>"\r\n]{1,60} <)?[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}>?$/i, 'Use an address like Zorion <noreply@app.midnightpoetry.studio>.');
config.get('/email', async (c) => {
  need(c);
  const st = await settingsStatus(c.get('deps').db, c.get('deps').env as unknown as Record<string, unknown>);
  const last = await readJson<EmailStatus | null>(c.get('deps').db, EMAIL_STATUS_KEY, null);
  return c.json({ key: st.RESEND_API_KEY, from: st.EMAIL_FROM.hint || DEFAULT_EMAIL_FROM, fromSet: st.EMAIL_FROM.set, last });
});
config.put('/email', async (c) => {
  const input = await body(c, z.object({ apiKey: z.string().trim().regex(/^re_[A-Za-z0-9_]{16,}$/, 'That is not a Resend API key (re_…).').optional(), from: fromSchema, code }));
  await stepUp(c, input.code);
  if (input.apiKey) await save(c, 'RESEND_API_KEY', input.apiKey);
  await save(c, 'EMAIL_FROM', input.from);
  await audit(c, 'email.save', null, { from: input.from, key: input.apiKey ? `…${input.apiKey.slice(-4)}` : 'unchanged' });
  return c.json({ ok: true });
});
config.post('/email/test', async (c) => {
  const admin = need(c, 'super');
  const s = await saved(c);
  // The portal's key wins; otherwise the one set on this Worker in Cloudflare.
  const env = tidySettings({ ...(c.get('deps').env as unknown as Record<string, unknown>), ...s }) as Record<string, string | undefined>;
  if (!env.RESEND_API_KEY) throw new Fail(409, 'no_key', 'Save the Resend key first.');
  let res: Response;
  try {
    res = await c.get('deps').fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM || DEFAULT_EMAIL_FROM, to: [admin.email], subject: 'Zorion test email', text: 'Email from Zorion is working.' }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Fail(422, 'resend', 'Could not reach Resend. Try again.');
  }
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Fail(422, 'resend', `Resend ${res.status}: ${data.message ?? 'refused'}`);
  await audit(c, 'email.test', null);
  return c.json({ ok: true, to: admin.email });
});

// ---------- map services: Google (places, and routes) and openrouteservice (routes) ----------
const MAPS_STATUS = 'maps_status';
interface MapsStatus { google?: { places: boolean; routes: boolean; at: string }; ors?: { ok: boolean; at: string } }
/** One small, real request to each Google API the key might be used for. Routes is optional: Places is required. */
async function checkGoogle(c: C, key: string): Promise<{ places: boolean; routes: boolean; error: string | null }> {
  const post = (url: string, mask: string, payload: unknown) => c.get('deps').fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': mask }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
  });
  const reason = async (res: Response) => ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? `refused (${res.status})`;
  let places = false;
  let routes = false;
  let error: string | null = null;
  try {
    const res = await post('https://places.googleapis.com/v1/places:searchText', 'places.id', { textQuery: 'cafe', pageSize: 1, locationBias: { circle: { center: { latitude: 1.2966, longitude: 103.852 }, radius: 2000 } } });
    places = res.ok;
    if (!res.ok) error = `Google Places: ${await reason(res)}`;
  } catch { error = 'Could not reach Google. Try again.'; }
  if (places) {
    try {
      const res = await post('https://routes.googleapis.com/directions/v2:computeRoutes', 'routes.duration', { origin: { location: { latLng: { latitude: 1.2966, longitude: 103.852 } } }, destination: { location: { latLng: { latitude: 1.2996, longitude: 103.855 } } }, travelMode: 'WALK' });
      routes = res.ok;
    } catch { routes = false; }
  }
  return { places, routes, error };
}
async function checkOrs(c: C, key: string): Promise<string | null> {
  try {
    const res = await c.get('deps').fetch('https://api.openrouteservice.org/v2/directions/foot-walking?start=103.852,1.2966&end=103.855,1.2996', { headers: { authorization: key }, signal: AbortSignal.timeout(10000) });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: string | { message?: string } } | null;
    const msg = typeof data?.error === 'string' ? data.error : data?.error?.message;
    return `openrouteservice: ${msg ?? `refused (${res.status})`}`;
  } catch { return 'Could not reach openrouteservice. Try again.'; }
}
config.get('/maps', async (c) => {
  need(c);
  const { db, env } = c.get('deps');
  const st = await settingsStatus(db, env as unknown as Record<string, unknown>);
  return c.json({ google: st.GOOGLE_PLACES_KEY, ors: st.ORS_API_KEY, status: await readJson<MapsStatus>(db, MAPS_STATUS, {}), usage: await googleUsage(db, c.get('deps').now()) });
});
config.put('/maps/google', async (c) => {
  const input = await body(c, z.object({ key: z.string().trim().regex(/^[A-Za-z0-9_-]{30,60}$/, "That isn't a Google API key. It starts with AIza."), code }));
  await stepUp(c, input.code);
  const r = await checkGoogle(c, input.key);
  if (!r.places) throw new Fail(422, 'google', r.error ?? 'Google refused the key.');
  await save(c, 'GOOGLE_PLACES_KEY', input.key);
  const status = await readJson<MapsStatus>(c.get('deps').db, MAPS_STATUS, {});
  await putJson(c, MAPS_STATUS, { ...status, google: { places: true, routes: r.routes, at: new Date().toISOString() } });
  await audit(c, 'maps.google', null, { routes: r.routes, ends: input.key.slice(-4) });
  return c.json({ ok: true, routes: r.routes });
});
config.put('/maps/ors', async (c) => {
  const input = await body(c, z.object({ key: z.string().trim().min(20, "That isn't an openrouteservice key.").max(200).regex(/^[A-Za-z0-9=_-]+$/, "That isn't an openrouteservice key."), code }));
  await stepUp(c, input.code);
  const err = await checkOrs(c, input.key);
  if (err) throw new Fail(422, 'ors', err);
  await save(c, 'ORS_API_KEY', input.key);
  const status = await readJson<MapsStatus>(c.get('deps').db, MAPS_STATUS, {});
  await putJson(c, MAPS_STATUS, { ...status, ors: { ok: true, at: new Date().toISOString() } });
  await audit(c, 'maps.ors', null, { ends: input.key.slice(-4) });
  return c.json({ ok: true });
});
/** Checks the saved keys again, for example after turning on Routes API in Google Cloud. Changes no key. */
config.post('/maps/check', async (c) => {
  need(c, 'super');
  const keys = await saved(c);
  const status = await readJson<MapsStatus>(c.get('deps').db, MAPS_STATUS, {});
  const at = new Date().toISOString();
  let error: string | null = null;
  if (keys.GOOGLE_PLACES_KEY) { const r = await checkGoogle(c, keys.GOOGLE_PLACES_KEY); status.google = { places: r.places, routes: r.routes, at }; error = r.error; }
  if (keys.ORS_API_KEY) { const e = await checkOrs(c, keys.ORS_API_KEY); status.ors = { ok: !e, at }; error = error ?? e; }
  await putJson(c, MAPS_STATUS, status);
  return c.json({ status, error });
});
config.post('/maps/:service/remove', async (c) => {
  const service = c.req.param('service');
  if (service !== 'google' && service !== 'ors') throw new Fail(404, 'not_found', 'Not found.');
  const input = await body(c, z.object({ code }));
  await stepUp(c, input.code);
  await save(c, service === 'google' ? 'GOOGLE_PLACES_KEY' : 'ORS_API_KEY', null);
  const status = await readJson<MapsStatus>(c.get('deps').db, MAPS_STATUS, {});
  delete status[service];
  await putJson(c, MAPS_STATUS, status);
  await audit(c, `maps.${service}.remove`, null);
  return c.json({ ok: true });
});

// ---------- categories ----------
config.delete('/categories/:key', async (c) => {
  need(c, 'super');
  const key = c.req.param('key');
  if (!/^[a-z0-9_]{2,24}$/.test(key)) throw new Fail(404, 'not_found', 'Not found.');
  const { db } = c.get('deps');
  const left = await one(db, 'select count(*)::int as n from categories where active and key <> $1', [key]);
  if (Number(left?.n ?? 0) < 2) throw new Fail(409, 'too_few', 'Keep at least two food options.');
  // Meetups keep their own copy of the name and icon, so removing one never breaks a meetup in progress.
  await db.query('delete from categories where key = $1', [key]);
  await audit(c, 'category.remove', key);
  return c.json({ ok: true });
});
config.get('/icons', (c) => { need(c); return c.json({ icons: Object.keys(ICONS) }); });

// ---------- admins: invite by link; the invitee sets a password and an authenticator ----------
config.post('/admins/invite', async (c) => {
  const admin = need(c, 'super');
  const input = await body(c, z.object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(['super', 'support']), code }));
  await stepUp(c, input.code);
  const { db } = c.get('deps');
  if (await one(db, 'select 1 from admins where email = $1', [input.email])) throw new Fail(409, 'exists', 'That person is already an admin.');
  const token = randomToken(32);
  await db.query('delete from admin_invites where email = $1', [input.email]);
  await db.query("insert into admin_invites (token_hash, email, role, invited_by, expires_at) values ($1, $2, $3, $4, now() + interval '24 hours')", [await sha256(token), input.email, input.role, admin.id]);
  await audit(c, 'admin.invite', input.email, { role: input.role });
  return c.json({ link: `${c.get('deps').env.SITE_ORIGIN}/admin/join#${token}` });
});
config.post('/admins/:id/active', async (c) => {
  const admin = need(c, 'super');
  const input = await body(c, z.object({ active: z.boolean(), code }));
  await stepUp(c, input.code);
  const id = c.req.param('id');
  if (id === admin.id) throw new Fail(409, 'self', 'You cannot switch yourself off.');
  const { db } = c.get('deps');
  await db.batch([['update admins set active = $2 where id = $1', [id, input.active]], ...(input.active ? [] : [['delete from admin_sessions where admin_id = $1', [id]] as [string, unknown[]]])]);
  await audit(c, input.active ? 'admin.on' : 'admin.off', id);
  return c.json({ ok: true });
});

// Public: used from the invite link, before the invitee has an account.
const inviteFor = async (c: C, token: string) => {
  const row = await one(c.get('deps').db, 'select * from admin_invites where token_hash = $1 and expires_at > now()', [await sha256(token)]);
  if (!row) throw new Fail(404, 'invite', 'This invite has expired or was already used.');
  return row;
};
config.post('/join/start', async (c) => {
  const input = await body(c, z.object({ token: z.string().min(20).max(100) }));
  const invite = await inviteFor(c, input.token);
  const { db, env } = c.get('deps');
  const secret = newTotpSecret();
  await db.query('update admin_invites set totp_secret = $2 where token_hash = $1', [invite.token_hash, await seal(secret, env.TOTP_KEY)]);
  return c.json({ email: invite.email, role: invite.role, secret, uri: otpauthUri(secret, invite.email, 'Zorion admin') });
});
config.post('/join', async (c) => {
  const input = await body(c, z.object({ token: z.string().min(20).max(100), password: z.string().min(12, 'Use at least 12 characters.').max(128), code }));
  const invite = await inviteFor(c, input.token);
  const { db, env, now } = c.get('deps');
  if (!invite.totp_secret) throw new Fail(409, 'invite', 'Open the invite link again.');
  const step = await verifyTotp(await unseal(invite.totp_secret, env.TOTP_KEY), input.code, now(), 0);
  if (step === null) throw new Fail(401, 'wrong_code', 'That code did not match. Check the time on your phone.');
  const made = await one(db, `insert into admins (email, password_hash, totp_secret, totp_enabled, totp_last_step, role) values ($1, $2, $3, true, $4, $5)
    on conflict (email) do nothing returning id`, [invite.email, await hashPassword(input.password, env.PEPPER), invite.totp_secret, step, invite.role]);
  await db.query('delete from admin_invites where token_hash = $1', [invite.token_hash]);
  if (!made) throw new Fail(409, 'exists', 'That person is already an admin.');
  await db.query('insert into audit_log (admin_id, action, target) values ($1, $2, $3)', [made.id, 'admin.joined', invite.email]);
  return c.json({ ok: true });
});

