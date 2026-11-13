import { beforeAll, describe, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import { totpAt, totpStep } from '@zorion/server/crypto';
import { type Env, createAdmin } from './index';

const TOKEN = 'a-long-setup-token-from-the-owner';
const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'pep', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef'), ADMIN_SETUP_TOKEN: TOKEN };
const now = new Date('2026-11-13T04:00:00Z');
let db: Awaited<ReturnType<typeof testDb>>;

function browser(app: ReturnType<typeof createAdmin>) {
  const jar = new Map<string, string>();
  return async (method: string, path: string, json?: unknown) => {
    const res = await app.request(`/admin/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-zorion': '1', origin: env.SITE_ORIGIN, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    for (const line of res.headers.getSetCookie()) {
      const [k, v] = line.split(';')[0]!.split('=');
      if (v) jar.set(k!, v);
      else jar.delete(k!);
    }
    return { status: res.status, body: (await res.json()) as any };
  };
}

beforeAll(async () => {
  db = await testDb();
});

describe('first admin from the browser', () => {
  it('is closed when the Worker has no setup token, or a short one', async () => {
    for (const t of [undefined, 'short']) {
      const b = browser(createAdmin({ db, env: { ...env, ADMIN_SETUP_TOKEN: t }, now: () => now }));
      expect((await b('GET', '/setup')).body).toEqual({ open: false });
      expect((await b('POST', '/setup/key', { token: 'short' })).status).toBe(404);
    }
  });

  it('refuses a wrong token, and pauses after five', async () => {
    const b = browser(createAdmin({ db, env, now: () => now }));
    expect((await b('GET', '/setup')).body).toEqual({ open: true });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await b('POST', '/setup/key', { token: `wrong-${i}` })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect((await b('POST', '/setup/key', { token: TOKEN })).status).toBe(429); // even the right one, while paused
    await db.query('delete from throttles');
  });

  it('creates a super admin only after a working authenticator code, and signs them in', async () => {
    const b = browser(createAdmin({ db, env, now: () => now }));
    const { secret, uri } = (await b('POST', '/setup/key', { token: TOKEN })).body;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(uri).toContain('otpauth://totp/');
    expect(await db.query('select count(*)::int as n from admins')).toEqual([{ n: 0 }]); // nothing stored yet

    const form = { token: TOKEN, email: 'Owner@Example.com', password: 'a strong password', secret };
    expect((await b('POST', '/setup', { ...form, code: '000000' })).body.error).toBe('wrong_code');
    expect((await b('POST', '/setup', { ...form, password: 'short', code: await totpAt(secret, totpStep(now)) })).status).toBe(422);
    const made = await b('POST', '/setup', { ...form, code: await totpAt(secret, totpStep(now)) });
    expect(made.body).toEqual({ next: 'done' });
    expect((await b('GET', '/me')).body.admin).toMatchObject({ email: 'owner@example.com', role: 'super' });
    expect(await db.query("select action from audit_log where action = 'setup.first_admin'")).toEqual([{ action: 'setup.first_admin' }]);
    expect(await db.query("select count(*)::int as n from audit_log where action = 'setup.failed'")).toEqual([{ n: 5 }]); // the wrong tokens earlier are on record
  });

  it('closes for good once an admin exists, even with the right token', async () => {
    const b = browser(createAdmin({ db, env, now: () => now }));
    expect((await b('GET', '/setup')).body).toEqual({ open: false });
    expect((await b('POST', '/setup/key', { token: TOKEN })).status).toBe(404);
    expect((await b('POST', '/setup', { token: TOKEN, email: 'x@example.com', password: 'a strong password', secret: 'A'.repeat(32), code: '123456' })).status).toBe(404);
    expect(await db.query('select count(*)::int as n from admins')).toEqual([{ n: 1 }]);
  });

  it('lets the new admin sign in the usual way afterwards', async () => {
    const b = browser(createAdmin({ db, env, now: () => new Date(now.getTime() + 60_000) }));
    expect((await b('POST', '/sign-in', { email: 'owner@example.com', password: 'a strong password' })).body).toEqual({ next: 'two_step' });
  });
});

describe('ads.txt', () => {
  it('is made from the saved publisher ID, and missing until there is one', async () => {
    const app = createAdmin({ db, env, now: () => now });
    expect((await app.request('/ads.txt')).status).toBe(404);
    await db.query("insert into settings (key, value) values ('adsense', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ publisherId: 'ca-pub-1234567890123456', consent: true })]);
    const res = await app.request('/ads.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });
});
