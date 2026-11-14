import { beforeAll, describe, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import { hashPassword, newTotpSecret, seal, totpAt, totpStep } from '@zorion/server/crypto';
import { loadSettings } from '@zorion/server/settings';
import { type Env, createAdmin } from './index';

const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'https://zorionapp.example', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'pep', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef') };
const now = new Date('2026-11-14T04:00:00Z');
let db: Awaited<ReturnType<typeof testDb>>;
let app: ReturnType<typeof createAdmin>;
const secret = newTotpSecret();
const calls: Array<{ url: string; body: string }> = [];
// Made-up keys, assembled here so the file holds nothing that looks like a real key.
const TEST_KEY = ['sk', 'test', '51abcdefghijklmnopqrstuv'].join('_');
const WRONG_KEY = ['sk', 'test', 'wrongwrongwrongwrong'].join('_');
const GOOGLE_KEY = ['AIza', 'SyFakeFakeFakeFakeFakeFakeFakeFake12'].join('');
const GOOGLE_NO_ROUTES = ['AIza', 'SyNoRoutesNoRoutesNoRoutesNoRout34'].join('');
const ORS_KEY = ['5b3ce3597851110001cf6248', 'fakefakefakefake'].join('');

// Stand-ins for Stripe, Telegram and Resend.
const fakeFetch = (async (input: string, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, body: String(init?.body ?? '') });
  const json = (v: unknown, status = 200) => Response.json(v, { status });
  if (url.includes('api.stripe.com')) {
    if ((init?.headers as Record<string, string>).authorization === `Bearer ${WRONG_KEY}`) return json({ error: { message: 'Invalid API Key provided' } }, 401);
    if (url.endsWith('/account')) return json({ id: 'acct_1', country: 'SG', charges_enabled: true, payouts_enabled: true, details_submitted: true, settings: { dashboard: { display_name: 'Midnight Poetry' } } });
    if (url.includes('webhook_endpoints?')) return json({ data: [{ id: 'we_old', url: 'https://zorionapp.example/api/webhooks/stripe', status: 'enabled', enabled_events: ['checkout.session.completed'] }] });
    if (url.includes('webhook_endpoints/we_old')) return json({ deleted: true });
    if (url.endsWith('webhook_endpoints')) return json({ id: 'we_new', secret: ['whsec', 'newsecret1234'].join('_') });
  }
  if (url.includes('api.telegram.org')) {
    if (url.endsWith('/getMe')) return json({ ok: true, result: { username: 'ZorionMeetBot', first_name: 'Zorion' } });
    return json({ ok: true, result: true });
  }
  if (url.includes('api.resend.com')) return json({ id: 'email_1' });
  if (url.includes('places.googleapis.com')) return (init?.headers as Record<string, string>)['x-goog-api-key']?.startsWith('AIza') ? json({ places: [{ id: 'p1' }] }) : json({ error: { message: 'API key not valid.' } }, 400);
  if (url.includes('routes.googleapis.com')) return (init?.headers as Record<string, string>)['x-goog-api-key'] === GOOGLE_NO_ROUTES ? json({ error: { message: 'Routes API has not been used in project' } }, 403) : json({ routes: [{ duration: '300s' }] });
  if (url.includes('api.openrouteservice.org')) return (init?.headers as Record<string, string>).authorization === ORS_KEY ? json({ routes: [] }) : json({ error: { message: 'Access to this API has been disallowed' } }, 403);
  throw new Error(`unexpected ${url}`);
}) as unknown as typeof fetch;

function browser() {
  const jar = new Map<string, string>();
  return async (method: string, path: string, json?: unknown) => {
    const res = await app.request(`/admin/api${path}`, { method, headers: { 'content-type': 'application/json', 'x-zorion': '1', origin: env.SITE_ORIGIN, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: json === undefined ? undefined : JSON.stringify(json) });
    for (const line of res.headers.getSetCookie()) {
      const [k, v] = line.split(';')[0]!.split('=');
      if (v) jar.set(k!, v);
      else jar.delete(k!);
    }
    return { status: res.status, body: (await res.json()) as any };
  };
}
// A used code cannot be replayed, so each step-up in these tests starts from a clean slate.
const nextCode = async () => { await db.query('update admins set totp_last_step = 0'); await db.query('delete from throttles'); return totpAt(secret, totpStep(now)); };
let b: ReturnType<typeof browser>;

beforeAll(async () => {
  db = await testDb();
  app = createAdmin({ db, env, now: () => now, fetch: fakeFetch });
  await db.query('insert into admins (email, password_hash, totp_secret, totp_enabled, role) values ($1, $2, $3, true, $4)', ['root@example.com', await hashPassword('correct horse battery', env.PEPPER), await seal(secret, env.TOTP_KEY), 'super']);
  b = browser();
  await b('POST', '/sign-in', { email: 'root@example.com', password: 'correct horse battery' });
  await b('POST', '/two-step', { code: await totpAt(secret, totpStep(now) - 1) });
});

describe('keys set in the admin portal', () => {
  it('needs a fresh authenticator code, refuses a wrong key, and never sends the key back', async () => {
    expect((await b('PUT', '/payments/key', { secretKey: TEST_KEY })).status).toBe(422);
    expect((await b('PUT', '/payments/key', { secretKey: TEST_KEY, code: '000000' })).body.error).toBe('wrong_code');
    expect((await b('PUT', '/payments/key', { secretKey: WRONG_KEY, code: await nextCode() })).body.message).toContain('Invalid API Key');
    expect((await b('PUT', '/payments/key', { secretKey: TEST_KEY, code: await nextCode() })).body).toEqual({ ok: true });
    const status = (await b('GET', '/payments')).body;
    expect(status.key).toMatchObject({ set: true, from: 'portal', hint: 'stuv' });
    expect(status.mode).toBe('test');
    expect(JSON.stringify(status)).not.toContain(TEST_KEY.slice(0, 10));
    const raw = JSON.stringify(await db.query("select value from settings where key = 'env:STRIPE_SECRET_KEY'"));
    expect(raw).not.toContain(TEST_KEY.slice(0, 10)); // encrypted at rest
    expect((await loadSettings(db, env.TOTP_KEY)).STRIPE_SECRET_KEY).toBe(TEST_KEY);
  });

  it('connects the Stripe webhook itself, replacing an older one, and keeps its secret', async () => {
    expect((await b('POST', '/payments/webhook', { code: await nextCode() })).body).toEqual({ ok: true });
    expect(calls.some((c) => c.url.endsWith('webhook_endpoints/we_old'))).toBe(true);
    const made = calls.find((c) => c.url.endsWith('webhook_endpoints'))!;
    expect(made.body).toContain(encodeURIComponent('https://zorionapp.example/api/webhooks/stripe'));
    expect(made.body).toContain('customer.subscription.deleted');
    expect((await loadSettings(db, env.TOTP_KEY)).STRIPE_WEBHOOK_SECRET).toBe(['whsec', 'newsecret1234'].join('_'));
    expect((await b('POST', '/payments/check')).body.account).toMatchObject({ name: 'Midnight Poetry', charges: true });
  });

  it('connects Stripe in one step: the key and the webhook under one authenticator code', async () => {
    await db.query("delete from settings where key in ('env:STRIPE_SECRET_KEY', 'env:STRIPE_WEBHOOK_SECRET')");
    calls.length = 0;
    expect((await b('PUT', '/payments/key', { secretKey: TEST_KEY, code: await nextCode(), connect: true })).body).toEqual({ ok: true });
    expect(calls.some((c) => c.url.endsWith('webhook_endpoints') && c.body?.includes('customer.subscription.updated'))).toBe(true);
    const s = await loadSettings(db, env.TOTP_KEY);
    expect(s.STRIPE_SECRET_KEY).toBe(TEST_KEY);
    expect(s.STRIPE_WEBHOOK_SECRET).toBe(['whsec', 'newsecret1234'].join('_'));
  });

  it('connects map keys after one real check each, and says when Routes API is off', async () => {
    expect((await b('PUT', '/maps/google', { key: ['xxxx', 'notAGoogleKeyButLongEnoughToPassTheShape'].join(''), code: await nextCode() })).body.message).toContain('API key not valid');
    expect((await b('PUT', '/maps/google', { key: GOOGLE_NO_ROUTES, code: await nextCode() })).body).toEqual({ ok: true, routes: false });
    expect((await b('GET', '/maps')).body).toMatchObject({ google: { set: true, from: 'portal' }, status: { google: { places: true, routes: false } } });
    expect((await b('PUT', '/maps/google', { key: GOOGLE_KEY, code: await nextCode() })).body).toEqual({ ok: true, routes: true });
    expect((await loadSettings(db, env.TOTP_KEY)).GOOGLE_PLACES_KEY).toBe(GOOGLE_KEY);
    expect(JSON.stringify((await b('GET', '/maps')).body)).not.toContain(GOOGLE_KEY.slice(0, 12));
    expect((await b('PUT', '/maps/ors', { key: 'a'.repeat(40), code: await nextCode() })).body.message).toContain('openrouteservice');
    expect((await b('PUT', '/maps/ors', { key: ORS_KEY, code: await nextCode() })).body).toEqual({ ok: true });
    expect((await b('POST', '/maps/check')).body.status).toMatchObject({ google: { places: true, routes: true }, ors: { ok: true } });
    expect((await b('POST', '/maps/ors/remove', { code: await nextCode() })).body).toEqual({ ok: true });
    expect((await loadSettings(db, env.TOTP_KEY)).ORS_API_KEY).toBeUndefined();
  });

  it('connects a Telegram bot from its token alone', async () => {
    const r = await b('PUT', '/telegram', { token: '123456789:AAHsomeLongBotTokenValue_1234567890ab', code: await nextCode() });
    expect(r.body).toEqual({ ok: true, username: 'ZorionMeetBot' });
    const s = await loadSettings(db, env.TOTP_KEY);
    expect(s.TELEGRAM_BOT_USERNAME).toBe('ZorionMeetBot');
    expect(s.TELEGRAM_WEBHOOK_SECRET).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const hook = calls.find((c) => c.url.endsWith('/setWebhook'))!;
    expect(JSON.parse(hook.body)).toMatchObject({ url: 'https://zorionapp.example/api/webhooks/telegram', secret_token: s.TELEGRAM_WEBHOOK_SECRET });
  });

  it('saves the email sender and sends a test to the admin', async () => {
    expect((await b('PUT', '/email', { apiKey: ['re', 'abcdefghijklmnopqrstuvwx'].join('_'), from: 'Zorion <noreply@app.midnightpoetry.studio>', code: await nextCode() })).body).toEqual({ ok: true });
    expect((await b('GET', '/email')).body).toMatchObject({ from: 'Zorion <noreply@app.midnightpoetry.studio>', key: { set: true, hint: 'uvwx' }, last: null });
    await db.query("insert into settings (key, value) values ('email_status', $1)", [JSON.stringify({ ok: false, at: '2026-11-14T06:25:00Z', from: 'x', key: 'worker', reason: 'Resend 403: not verified' })]);
    expect((await b('GET', '/email')).body.last).toMatchObject({ ok: false, reason: 'Resend 403: not verified' });
    expect((await b('POST', '/email/test')).body).toEqual({ ok: true, to: 'root@example.com' });
  });
});

describe('plans and categories', () => {
  it('saves what each plan includes and the SGD prices', async () => {
    const plans = (await b('GET', '/plans')).body.plans;
    plans.free.goldTheme = true;
    plans.price = { monthly: 490, yearly: 4900 };
    expect((await b('PUT', '/plans', { ...plans, price: { monthly: 50, yearly: 0 } })).status).toBe(422);
    expect((await b('PUT', '/plans', plans)).body.plans).toMatchObject({ free: { goldTheme: true }, price: { currency: 'sgd', monthly: 490, yearly: 4900 } });
    const pub = await (await app.request('/api/public/config')).json() as any;
    expect(pub.plans.price.monthly).toBe(490);
  });

  it('adds, edits and removes a category, keeping at least two', async () => {
    const cat = { key: 'hotpot', name: 'Hotpot', icon: 'hotpot', active: true, position: 7, osm: ['["amenity"="restaurant"]["cuisine"~"hotpot"]'], google: { text: 'hotpot' } };
    expect((await b('POST', '/categories', cat)).body).toEqual({ ok: true });
    expect((await b('POST', '/categories', { ...cat, name: 'Steamboat' })).body).toEqual({ ok: true });
    expect((await db.query("select name from categories where key = 'hotpot'"))[0]!.name).toBe('Steamboat');
    expect((await b('DELETE', '/categories/hotpot')).body).toEqual({ ok: true });
    await db.query("update categories set active = false where key not in ('pizza', 'ramen')");
    expect((await b('DELETE', '/categories/pizza')).body.error).toBe('too_few');
  });
});

describe('admins and the ad frame', () => {
  it('invites an admin by link; the invitee sets a password and an authenticator', async () => {
    const { link } = (await b('POST', '/admins/invite', { email: 'Help@Example.com', role: 'support', code: await nextCode() })).body;
    const token = link.split('#')[1];
    const invitee = browser();
    const start = (await invitee('POST', '/join/start', { token })).body;
    expect(start).toMatchObject({ email: 'help@example.com', role: 'support' });
    expect((await invitee('POST', '/join', { token, password: 'short', code: '123456' })).status).toBe(422);
    expect((await invitee('POST', '/join', { token, password: 'a long enough password', code: await totpAt(start.secret, totpStep(now)) })).body).toEqual({ ok: true });
    expect((await invitee('POST', '/join/start', { token })).status).toBe(404); // one use
    expect((await db.query("select role from admins where email = 'help@example.com'"))[0]!.role).toBe('support');
  });

  it('serves the ad frame only to the app, and says "none" when no ad can show', async () => {
    const res = await app.request('/ad-frame?consent=yes');
    expect(res.headers.get('content-security-policy')).toContain('frame-ancestors https://zorionapp.example');
    const html = await res.text();
    expect(html).toContain("tell('none')");
    expect(html).not.toContain('adsbygoogle.js');
  });
});
