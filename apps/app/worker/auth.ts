import { Hono } from 'hono';
import { z } from 'zod';
import { AVATARS, LIMITS, PRO_AVATARS, cleanName } from '@zorion/core';
import * as schemas from '@zorion/core/schemas';
import { one } from '@zorion/db';
import { connectLink, telegramReady } from './telegram';
import { type App, type C, Fail, body, clearStrikes, clientKey, endSession, features, guardLock, requireUser, sendEmail, startSession, strike, toUser, upgrade, USER_COLUMNS } from './core';
import { hashPassword, hmac, newTotpSecret, otpauthUri, randomDigits, randomToken, safeEqual, seal, sha256, unseal, verifyPassword, verifyTotp } from './crypto';

/**
 * Own sign-in. One rule runs through all of it:
 *   first step  = email code, password or authenticator
 *   second step = only when two-step is on, and always a DIFFERENT proof from the first.
 */
export const auth = new Hono<App>();

const codeHash = (c: C, email: string, code: string) => hmac(c.get('deps').env.PEPPER, `email-code:${email}:${code}`);
const emailKey = async (c: C, email: string) => `signin:${await sha256(email)}`;

async function issueEmailCode(c: C, email: string): Promise<void> {
  const deps = c.get('deps');
  const key = `${await emailKey(c, email)}:send`;
  // Also per network, so one visitor cannot make Zorion send codes to a long list of addresses.
  const netKey = `signin-net:${await clientKey(c)}`;
  await guardLock(deps.db, key);
  await guardLock(deps.db, netKey);
  await strike(deps.db, key, 5, 15, LIMITS.signInLockMinutes); // at most 5 emails per 15 minutes
  await strike(deps.db, netKey, 20, 15, 15); // and 20 per network
  const code = randomDigits(6);
  await deps.db.query('update email_codes set consumed_at = now() where email = $1 and consumed_at is null', [email]);
  await deps.db.query('insert into email_codes (email, code_hash, expires_at) values ($1, $2, now() + make_interval(mins => $3::int))', [email, await codeHash(c, email, code), LIMITS.emailCodeMinutes]);
  await sendEmail(deps, email, `${code} is your Zorion code`, `Your Zorion sign-in code is ${code}.\n\nIt works once and expires in ${LIMITS.emailCodeMinutes} minutes. If you did not ask for it, you can ignore this email.`);
}

async function checkEmailCode(c: C, email: string, code: string): Promise<boolean> {
  const { db } = c.get('deps');
  const row = await one(db, 'select id, code_hash, attempts from email_codes where email = $1 and consumed_at is null and expires_at > now() order by created_at desc limit 1', [email]);
  if (!row) return false;
  if (row.attempts >= LIMITS.emailCodeTries) return false;
  const ok = safeEqual(row.code_hash, await codeHash(c, email, code));
  await db.query(ok ? 'update email_codes set consumed_at = now() where id = $1' : 'update email_codes set attempts = attempts + 1 where id = $1', [row.id]);
  return ok;
}

async function findUser(c: C, email: string) {
  return one(c.get('deps').db, 'select * from users where email = $1', [email]);
}

/** After a correct first step: either a full session, or a short pending one that waits for the second step. */
async function afterFirstStep(c: C, user: { id: string; totp_enabled: boolean; status: string }, first: 'email' | 'password' | 'totp', newAccount = false) {
  if (user.status !== 'active') throw new Fail(403, 'suspended', 'This account is suspended.');
  if (!user.totp_enabled) {
    await startSession(c, user.id, 'full');
    return c.json({ next: 'done', ...(newAccount ? { newAccount: true } : {}) });
  }
  await startSession(c, user.id, 'pending_2fa', first);
  return c.json({ next: 'two_step', accepts: first === 'totp' ? ['email_code', 'password'] : ['totp', 'recovery'] });
}

const failSignIn = async (c: C, key: string, wrong = "That didn't match."): Promise<never> => {
  const locked = await strike(c.get('deps').db, key, LIMITS.emailCodeTries, 15, LIMITS.signInLockMinutes);
  throw new Fail(locked ? 429 : 401, locked ? 'locked' : 'wrong', locked ? 'Too many wrong tries. Try again in 15 minutes.' : wrong);
};
// The same words whether the password was wrong, the account has none yet, or there's no account,
// so the answer never tells anyone which emails have accounts.
const NO_PASSWORD_MATCH = 'Wrong password, or no password set yet. Sign in with a code instead.';

auth.post('/email-code', async (c) => {
  const { email } = await body(c, z.object({ email: schemas.email }));
  await issueEmailCode(c, email);
  return c.json({ ok: true }); // same answer whether or not the account exists
});

auth.post('/email-code/verify', async (c) => {
  const { email, code } = await body(c, z.object({ email: schemas.email, code: schemas.sixDigits }));
  const { db } = c.get('deps');
  const key = await emailKey(c, email);
  await guardLock(db, key);
  if (!(await checkEmailCode(c, email, code))) return failSignIn(c, key);
  await clearStrikes(db, key);
  let user = await findUser(c, email);
  let created = false;
  if (!user) {
    created = true;
    const name = cleanName(email.split('@')[0]!.replace(/[._-]+/g, ' ').replace(/^\w/, (m) => m.toUpperCase()), LIMITS.inviteeName) ?? 'Host';
    user = (await db.query('insert into users (email, display_name) values ($1, $2) returning *', [email, name]))[0]!;
  }
  return afterFirstStep(c, user as any, 'email', created);
});

auth.post('/password', async (c) => {
  const { email, password } = await body(c, z.object({ email: schemas.email, password: z.string().min(1).max(128) }));
  const { db, env } = c.get('deps');
  const key = await emailKey(c, email);
  await guardLock(db, key);
  const user = await findUser(c, email);
  if (!(await verifyPassword(password, user?.password_hash ?? null, env.PEPPER)) || !user) return failSignIn(c, key, NO_PASSWORD_MATCH);
  await clearStrikes(db, key);
  return afterFirstStep(c, user as any, 'password');
});

/** "Use my authenticator instead": the authenticator is the first step, so the second must be something else. */
auth.post('/authenticator', async (c) => {
  const { email, code } = await body(c, z.object({ email: schemas.email, code: schemas.sixDigits }));
  const { db, env, now } = c.get('deps');
  const key = await emailKey(c, email);
  await guardLock(db, key);
  const user = await findUser(c, email);
  const step = user?.totp_enabled && user.totp_secret ? await verifyTotp(await unseal(user.totp_secret, env.TOTP_KEY), code, now(), Number(user.totp_last_step)) : null;
  if (!user || step === null) return failSignIn(c, key);
  await db.query('update users set totp_last_step = $2 where id = $1', [user.id, step]);
  await clearStrikes(db, key);
  return afterFirstStep(c, user as any, 'totp');
});

auth.post('/two-step/email-code', async (c) => {
  const pending = c.get('pending');
  if (!pending || pending.first !== 'totp') throw new Fail(401, 'sign_in', 'Start signing in again.');
  const user = await one(c.get('deps').db, 'select email from users where id = $1', [pending.userId]);
  await issueEmailCode(c, user!.email);
  return c.json({ ok: true });
});

auth.post('/two-step', async (c) => {
  const input = await body(c, z.object({ code: schemas.sixDigits.optional(), recovery: z.string().min(8).max(24).optional(), emailCode: schemas.sixDigits.optional(), password: z.string().min(1).max(128).optional() }));
  const pending = c.get('pending');
  if (!pending) throw new Fail(401, 'sign_in', 'Start signing in again.');
  const { db, env, now } = c.get('deps');
  const user = (await one(db, 'select * from users where id = $1', [pending.userId]))!;
  const key = `twostep:${user.id}`;
  await guardLock(db, key);
  let ok = false;
  if (pending.first === 'totp') {
    // The authenticator was used first, so only a different proof counts here.
    if (input.emailCode) ok = await checkEmailCode(c, user.email, input.emailCode);
    else if (input.password) ok = await verifyPassword(input.password, user.password_hash, env.PEPPER);
  } else if (input.code && user.totp_secret) {
    const step = await verifyTotp(await unseal(user.totp_secret, env.TOTP_KEY), input.code, now(), Number(user.totp_last_step));
    if (step !== null) {
      await db.query('update users set totp_last_step = $2 where id = $1', [user.id, step]);
      ok = true;
    }
  } else if (input.recovery) {
    const hash = await hmac(env.PEPPER, `recovery:${user.id}:${input.recovery.replace(/[^a-z0-9]/gi, '').toLowerCase()}`);
    const used = await db.query('update recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning id', [user.id, hash]);
    ok = used.length === 1;
  }
  if (!ok) {
    const locked = await strike(db, key, LIMITS.emailCodeTries, 15, LIMITS.signInLockMinutes);
    if (locked) await endSession(c);
    throw new Fail(locked ? 429 : 401, locked ? 'locked' : 'wrong', locked ? 'Too many wrong tries. Try again in 15 minutes.' : 'Wrong code.');
  }
  await clearStrikes(db, key);
  await startSession(c, user.id, 'full');
  return c.json({ next: 'done' });
});

auth.post('/sign-out', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

auth.get('/me', async (c) => {
  const user = c.get('user');
  return c.json({ user, features: user ? await features(c.get('deps').db, user.plan) : null, pending: c.get('pending') ? { first: c.get('pending')!.first } : null, telegram: telegramReady(c.get('deps')) });
});

// ---------- account ----------
export const account = new Hono<App>();

account.patch('/', async (c) => {
  const user = requireUser(c);
  const input = await body(c, z.object({ theme: z.enum(['gold', 'pink']).optional(), displayName: z.string().max(40).optional(), notify: z.boolean().optional(), avatar: z.enum(AVATARS).optional() }));
  if (input.theme === 'gold' && !(await features(c.get('deps').db, user.plan)).goldTheme) throw upgrade('The gold theme comes with Pro.');
  if (input.avatar && PRO_AVATARS.includes(input.avatar) && !(await features(c.get('deps').db, user.plan)).goldTheme) throw upgrade('Star shades come with Pro.');
  const name = input.displayName === undefined ? undefined : cleanName(input.displayName, LIMITS.inviteeName);
  if (input.displayName !== undefined && !name) throw new Fail(422, 'invalid', 'Enter a name.');
  const row = await one(c.get('deps').db, `update users u set theme = coalesce($2, theme), display_name = coalesce($3, display_name), notify = coalesce($4, notify), avatar = coalesce($5, avatar) where id = $1
     returning ${USER_COLUMNS}`, [user.id, input.theme ?? null, name ?? null, input.notify ?? null, input.avatar ?? null]);
  return c.json({ user: toUser(row!) });
});

account.post('/password', async (c) => {
  const user = requireUser(c);
  const input = await body(c, z.object({ current: z.string().max(128).optional(), next: schemas.password }));
  const { db, env } = c.get('deps');
  const row = (await one(db, 'select password_hash from users where id = $1', [user.id]))!;
  if (row.password_hash && !(await verifyPassword(input.current ?? '', row.password_hash, env.PEPPER))) throw new Fail(401, 'wrong', "Current password didn't match.");
  await db.query('update users set password_hash = $2 where id = $1', [user.id, await hashPassword(input.next, env.PEPPER)]);
  await db.query('delete from sessions where user_id = $1 and id <> $2', [user.id, c.get('sessionId')]); // sign out everywhere else
  return c.json({ ok: true });
});

account.post('/two-step/setup', async (c) => {
  const user = requireUser(c);
  if (user.totp_enabled) throw new Fail(409, 'already_on', 'Two-step verification is already on.');
  const { db, env } = c.get('deps');
  const secret = newTotpSecret();
  await db.query('update users set totp_secret = $2, totp_last_step = 0 where id = $1', [user.id, await seal(secret, env.TOTP_KEY)]);
  return c.json({ secret, uri: otpauthUri(secret, user.email) });
});

account.post('/two-step/enable', async (c) => {
  const user = requireUser(c);
  const { code } = await body(c, z.object({ code: schemas.sixDigits }));
  const { db, env, now } = c.get('deps');
  const row = (await one(db, 'select totp_secret, totp_last_step from users where id = $1', [user.id]))!;
  const step = row.totp_secret ? await verifyTotp(await unseal(row.totp_secret, env.TOTP_KEY), code, now(), Number(row.totp_last_step)) : null;
  if (step === null) throw new Fail(401, 'wrong', "Wrong code. Check your phone's clock is right.");
  const recovery = Array.from({ length: 8 }, () => randomToken(6).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase().padEnd(8, 'x'));
  const hashes = await Promise.all(recovery.map((r) => hmac(env.PEPPER, `recovery:${user.id}:${r}`)));
  await db.batch([
    ['update users set totp_enabled = true, totp_last_step = $2 where id = $1', [user.id, step]],
    ['delete from recovery_codes where user_id = $1', [user.id]],
    ...hashes.map((h): [string, unknown[]] => ['insert into recovery_codes (user_id, code_hash) values ($1, $2)', [user.id, h]]),
  ]);
  return c.json({ recovery }); // shown once
});

account.post('/two-step/disable', async (c) => {
  const user = requireUser(c);
  const { code } = await body(c, z.object({ code: schemas.sixDigits }));
  const { db, env, now } = c.get('deps');
  const row = (await one(db, 'select totp_secret, totp_last_step from users where id = $1', [user.id]))!;
  const step = row.totp_secret ? await verifyTotp(await unseal(row.totp_secret, env.TOTP_KEY), code, now(), Number(row.totp_last_step)) : null;
  if (step === null) throw new Fail(401, 'wrong', 'Wrong code.');
  await db.batch([
    ['update users set totp_enabled = false, totp_secret = null, totp_last_step = 0 where id = $1', [user.id]],
    ['delete from recovery_codes where user_id = $1', [user.id]],
  ]);
  return c.json({ ok: true });
});

/** A one-time link that opens Zorion's bot in Telegram. Pressing Start there connects the chat. */
account.post('/telegram', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  if (!telegramReady(deps)) throw new Fail(409, 'off', 'Telegram is not set up yet.');
  const key = `telegram-link:${user.id}`;
  await guardLock(deps.db, key);
  await strike(deps.db, key, 10, 60, 60);
  return c.json({ url: await connectLink(deps, { userId: user.id }) });
});
account.post('/telegram/stop', async (c) => {
  const user = requireUser(c);
  await c.get('deps').db.batch([
    ['update users set telegram_chat_id = null where id = $1', [user.id]],
    ['delete from telegram_links where user_id = $1', [user.id]],
  ]);
  return c.json({ ok: true });
});

account.get('/export', async (c) => {
  const user = requireUser(c);
  const { db } = c.get('deps');
  const meetups = await db.query('select id, name, status, starts_at, created_at from meetups where host_id = $1 order by created_at', [user.id]);
  const own = await db.query('select name, icon from own_categories where user_id = $1', [user.id]);
  return c.json({ account: { email: user.email, name: user.display_name, plan: user.plan, emailsAboutMeetups: user.notify, telegramConnected: user.telegram }, meetups, ownCategories: own });
});

account.post('/delete', async (c) => {
  const user = requireUser(c);
  const { email } = await body(c, z.object({ email: schemas.email }));
  if (email !== user.email) throw new Fail(422, 'invalid', 'Type your own email to confirm.');
  await c.get('deps').db.query('delete from users where id = $1', [user.id]); // meetups, guests and votes go with it
  await endSession(c);
  return c.json({ ok: true });
});

export { clientKey };
