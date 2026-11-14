import { beforeAll, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import type { Deps, Env } from './core';
import { hmac } from './crypto';
import { cleanUp } from './extras';
import { createApp } from './index';

// Pro given by an admin: counts everywhere Pro counts, ends by itself, and Stripe never touches it.
const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'test-pepper', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef'), ENVIRONMENT: 'development', STRIPE_WEBHOOK_SECRET: 'whsec_test' };
let deps: Partial<Deps>;
let app: ReturnType<typeof createApp>;

function browser() {
  const jar = new Map<string, string>();
  return async (method: string, path: string, json?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-zorion': '1', origin: env.APP_ORIGIN, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: json === undefined ? undefined : JSON.stringify(json) });
    for (const line of res.headers.getSetCookie()) { const [k, v] = line.split(';')[0]!.split('='); if (v) jar.set(k!, v); else jar.delete(k!); }
    return { status: res.status, body: (await res.json()) as any };
  };
}
async function signIn(email: string) {
  const b = browser();
  await b('POST', '/api/auth/email-code', { email });
  await b('POST', '/api/auth/email-code/verify', { email, code: deps.outbox!.at(-1)!.text.match(/\d{6}/)![0] });
  return b;
}
async function stripeEvent(event: unknown) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  return app.request('/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${await hmac('whsec_test', `${t}.${payload}`)}` }, body: payload });
}

beforeAll(async () => {
  deps = { db: await testDb(), env, fetch: (async () => { throw new Error('no network'); }) as unknown as typeof fetch, now: () => new Date(), outbox: [] };
  app = createApp(deps);
  await deps.db!.query("insert into settings (key, value) values ('plans', $1)", [JSON.stringify({ free: { groupSize: 3, goldTheme: false }, price: { monthly: 490, yearly: 4900 } })]);
});

it('given Pro counts as Pro, shows its end date, and needs no subscription', async () => {
  const db = deps.db!;
  const b = await signIn('given@example.com');
  expect((await b('GET', '/api/auth/me')).body.user).toMatchObject({ plan: 'free', pro: { paid: false, givenUntil: null, givenForever: false } });
  await db.query("update users set pro_grant_until = now() + interval '30 days' where email = 'given@example.com'");
  const me = (await b('GET', '/api/auth/me')).body;
  expect(me.user.plan).toBe('pro');
  expect(me.user.pro.paid).toBe(false);
  expect(new Date(me.user.pro.givenUntil).getTime()).toBeGreaterThan(Date.now());
  expect(me.features.goldTheme).toBe(true);
  expect((await b('PATCH', '/api/account', { avatar: 'star' })).body.user).toMatchObject({ avatar: 'star', plan: 'pro' });
  expect((await b('POST', '/api/billing/checkout', { period: 'yearly' })).body.error).toBe('already_pro');
  expect((await b('POST', '/api/billing/portal')).body.error).toBe('no_billing');

  await db.query("update users set pro_grant_until = 'infinity' where email = 'given@example.com'");
  expect((await b('GET', '/api/auth/me')).body.user.pro).toMatchObject({ givenUntil: null, givenForever: true });
});

it('ends by itself, and housekeeping puts Pro-only pigs back', async () => {
  const db = deps.db!;
  const b = await signIn('given@example.com');
  await db.query("update users set pro_grant_until = now() - interval '1 minute' where email = 'given@example.com'");
  const me = (await b('GET', '/api/auth/me')).body;
  expect(me.user).toMatchObject({ plan: 'free', pro: { givenUntil: null, givenForever: false } });
  expect(me.features.goldTheme).toBe(false);
  await cleanUp(db);
  expect((await db.query("select avatar from users where email = 'given@example.com'"))[0]!.avatar).toBe('chef');
});

it('a Stripe cancellation leaves given Pro alone', async () => {
  const db = deps.db!;
  const b = await signIn('both@example.com');
  await db.query("update users set plan = 'pro', stripe_customer_id = 'cus_both', theme = 'pink', pro_grant_until = now() + interval '90 days' where email = 'both@example.com'");
  expect((await b('GET', '/api/auth/me')).body.user.pro).toMatchObject({ paid: true });
  expect((await stripeEvent({ id: 'evt_cancel', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_both', status: 'canceled' } } })).status).toBe(200);
  const user = (await b('GET', '/api/auth/me')).body.user;
  expect(user).toMatchObject({ plan: 'pro', theme: 'pink', pro: { paid: false } });
  expect(user.pro.givenUntil).toBeTruthy();
});
