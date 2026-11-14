import { beforeAll, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import { hashPassword, newTotpSecret, seal, totpAt, totpStep } from '@zorion/server/crypto';
import { type Env, createAdmin } from './index';

// Giving Pro from the admin portal: an approval action, kept apart from paid Pro.
const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'pep', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef') };
const now = new Date();
let db: Awaited<ReturnType<typeof testDb>>;
let app: ReturnType<typeof createAdmin>;
const secrets: Record<string, string> = {};
let step = 0;

function browser() {
  const jar = new Map<string, string>();
  return async (method: string, path: string, json?: unknown) => {
    const res = await app.request(`/admin/api${path}`, { method, headers: { 'content-type': 'application/json', 'x-zorion': '1', origin: env.SITE_ORIGIN, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: json === undefined ? undefined : JSON.stringify(json) });
    for (const line of res.headers.getSetCookie()) { const [k, v] = line.split(';')[0]!.split('='); if (v) jar.set(k!, v); else jar.delete(k!); }
    return { status: res.status, body: (await res.json()) as any };
  };
}
async function addAdmin(email: string, role: string) {
  secrets[email] = newTotpSecret();
  await db.query('insert into admins (email, password_hash, totp_secret, totp_enabled, role) values ($1, $2, $3, true, $4)', [email, await hashPassword('correct horse battery', env.PEPPER), await seal(secrets[email]!, env.TOTP_KEY), role]);
}
async function signIn(email: string) {
  const b = browser();
  await db.query('update admins set totp_last_step = 0');
  await b('POST', '/sign-in', { email, password: 'correct horse battery' });
  await b('POST', '/two-step', { code: await totpAt(secrets[email]!, totpStep(now) + step++ % 2) });
  return b;
}
const sgDate = (days: number) => new Date(Date.now() + 8 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
const grant = (userId: string) => db.query('select plan, pro_grant_until, pro_grant_note from users where id = $1', [userId]).then((r) => r[0]!);

let userId: string;
beforeAll(async () => {
  db = await testDb();
  app = createAdmin({ db, env, now: () => now });
  await addAdmin('root@example.com', 'super');
  await db.query("insert into users (email, display_name) values ('host@example.com', 'Host')");
  userId = (await db.query('select id from users'))[0]!.id;
});

it('a lone super admin gives Pro until a date; it ends at the close of that day in Singapore', async () => {
  const b = await signIn('root@example.com');
  const endsOn = sgDate(30);
  expect((await b('POST', '/propose', { action: 'user.pro', payload: { userId, grant: true, endsOn, note: 'Beta tester' } })).body.status).toBe('done');
  const g = await grant(userId);
  expect(g.plan).toBe('free'); // paid plan untouched
  expect(g.pro_grant_note).toBe('Beta tester');
  expect(new Date(g.pro_grant_until).toISOString()).toBe(new Date(new Date(`${endsOn}T00:00:00+08:00`).getTime() + 86_400_000).toISOString()); // midnight after the last day, Singapore time
  const list = (await b('GET', '/users?plan=pro')).body;
  expect(list.total).toBe(1);
  expect(list.users[0]).toMatchObject({ plan: 'pro', paid: false, given_forever: false, given_note: 'Beta tester' });
  expect((await b('GET', '/overview')).body.users).toMatchObject({ pro: 1, pro_given: 1 });
  expect((await b('GET', '/access')).body.audit[0]).toMatchObject({ action: 'user.pro' });
});

it('refuses dates in the past or more than five years ahead', async () => {
  const b = await signIn('root@example.com');
  expect((await b('POST', '/propose', { action: 'user.pro', payload: { userId, grant: true, endsOn: sgDate(0) } })).status).toBe(422);
  expect((await b('POST', '/propose', { action: 'user.pro', payload: { userId, grant: true, endsOn: sgDate(5 * 366 + 2) } })).status).toBe(422);
});

it('no end date, then removal; with two admins it waits for the other one', async () => {
  let b = await signIn('root@example.com');
  await b('POST', '/propose', { action: 'user.pro', payload: { userId, grant: true, endsOn: null } });
  expect((await b('GET', '/users')).body.users[0]).toMatchObject({ plan: 'pro', given_forever: true, given_until: null });

  await addAdmin('two@example.com', 'super');
  expect((await b('POST', '/propose', { action: 'user.pro', payload: { userId, grant: false } })).body.status).toBe('pending');
  expect((await b('GET', '/users')).body.users[0].plan).toBe('pro'); // not yet
  const id = (await b('GET', '/approvals')).body.approvals[0].id;
  b = await signIn('two@example.com');
  expect((await b('POST', `/approvals/${id}`, { approve: true })).status).toBe(200);
  expect((await b('GET', '/users')).body.users[0]).toMatchObject({ plan: 'free', given_forever: false });
  expect((await b('GET', '/users?plan=pro')).body.total).toBe(0);
});
