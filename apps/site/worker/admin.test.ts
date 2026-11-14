import { beforeAll, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import { hashPassword, newTotpSecret, seal, totpAt, totpStep } from '@zorion/server/crypto';
import { type Env, createAdmin } from './index';

const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'pep', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef') };
const now = new Date('2026-11-13T04:00:00Z');
let db: Awaited<ReturnType<typeof testDb>>;
let app: ReturnType<typeof createAdmin>;
const secrets: Record<string, string> = {};

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
async function addAdmin(email: string, role: string) {
  secrets[email] = newTotpSecret();
  await db.query('insert into admins (email, password_hash, totp_secret, totp_enabled, role) values ($1, $2, $3, true, $4)', [email, await hashPassword('correct horse battery', env.PEPPER), await seal(secrets[email]!, env.TOTP_KEY), role]);
}
async function signIn(email: string, step = 0) {
  const b = browser();
  await db.query('update admins set totp_last_step = 0'); // test helper: a used code cannot be replayed, so reset between sign-ins
  await b('POST', '/sign-in', { email, password: 'correct horse battery' });
  await b('POST', '/two-step', { code: await totpAt(secrets[email]!, totpStep(now) + step) });
  return b;
}

beforeAll(async () => {
  db = await testDb();
  app = createAdmin({ db, env, now: () => now });
  await addAdmin('root@example.com', 'super');
});

it('needs password and authenticator, and nothing works signed out', async () => {
  const b = browser();
  expect((await b('GET', '/overview')).status).toBe(401);
  expect((await b('POST', '/sign-in', { email: 'root@example.com', password: 'nope' })).status).toBe(401);
  expect((await b('POST', '/sign-in', { email: 'root@example.com', password: 'correct horse battery' })).body.next).toBe('two_step');
  expect((await b('GET', '/overview')).status).toBe(401); // password alone is not enough
  expect((await b('POST', '/two-step', { code: await totpAt(secrets['root@example.com']!, totpStep(now)) })).body.next).toBe('done');
  expect((await b('GET', '/overview')).body).toMatchObject({ days: 7, users: { hosts: 0 }, pendingApprovals: 0 });
  expect((await b('GET', '/overview?days=30')).body.perDay).toHaveLength(30);
  expect((await b('GET', '/activity')).body).toMatchObject({ page: 1, pageSize: 25 });
});

it('a lone super admin can act alone, and the log says so', async () => {
  const b = await signIn('root@example.com', 1);
  expect((await b('POST', '/propose', { action: 'ads.placement', payload: { key: 'shortlist', enabled: false } })).body.status).toBe('done');
  expect((await db.query("select enabled from ad_placements where key = 'shortlist'"))[0]!.enabled).toBe(false);
  expect((await b('GET', '/access')).body.audit[0].detail.approval).toContain('self-approved');
});

it('with two admins, sensitive actions wait for the other one', async () => {
  await addAdmin('support@example.com', 'support');
  await db.query("insert into users (email, display_name) values ('host@example.com', 'Host')");
  const userId = (await db.query('select id from users'))[0]!.id;
  const support = await signIn('support@example.com');
  expect((await support('GET', '/users')).body.users[0].email).toBe('h•••@example.com'); // masked for support admins
  expect((await support('PUT', '/settings', { places_provider: 'google' })).status).toBe(403);
  expect((await support('POST', '/propose', { action: 'user.suspend', payload: { userId, suspend: true } })).body.status).toBe('pending');
  const id = (await support('GET', '/approvals')).body.approvals[0].id;
  expect((await support('POST', `/approvals/${id}`, { approve: true })).status).toBe(403); // not your own request
  const root = await signIn('root@example.com', 1);
  expect((await root('POST', `/approvals/${id}`, { approve: true })).status).toBe(200);
  expect((await db.query('select status from users'))[0]!.status).toBe('suspended');
  expect((await root('PUT', '/settings', { places_provider: 'google', blocked_words: ['spam'] })).status).toBe(200);
});
