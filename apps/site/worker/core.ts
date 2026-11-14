import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { type Db, one } from '@zorion/db';
import { randomToken, sha256, unseal, verifyTotp } from '@zorion/server/crypto';

export interface Env {
  DATABASE_URL: string;
  APP_ORIGIN: string;
  SITE_ORIGIN: string;
  PEPPER: string;
  TOTP_KEY: string;
  ENVIRONMENT?: string;
  CONTACT_EMAIL?: string; // shown on the privacy and terms pages
  ADMIN_SETUP_TOKEN?: string; // lets the owner create the first admin in the browser, only while there are none
}
export interface Deps { db: Db; env: Env; now(): Date; fetch: typeof fetch }
export interface Admin { id: string; email: string; role: 'super' | 'support' }
export type App = { Bindings: Env; Variables: { deps: Deps; admin: Admin | null; pending: string | null } };
export type C = Context<App>;

export class Fail extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 422 | 429, public code: string, message: string) {
    super(message);
  }
}
export const IDLE_MINUTES = 30;
export const secure = (env: Env) => env.SITE_ORIGIN.startsWith('https://');
export const cookie = (env: Env) => (secure(env) ? '__Host-zadmin' : 'zadmin');
export const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

export async function body<S extends z.ZodType>(c: C, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new Fail(422, 'invalid', parsed.error.issues[0]?.message ?? 'That does not look right.');
  return parsed.data;
}
export async function audit(c: C, action: string, target: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await c.get('deps').db.query('insert into audit_log (admin_id, action, target, detail) values ($1, $2, $3, $4)', [c.get('admin')?.id ?? null, action, target, JSON.stringify(detail)]);
}
export function need(c: C, role?: 'super'): Admin {
  const admin = c.get('admin');
  if (!admin) throw new Fail(401, 'sign_in', 'Please sign in.');
  if (role && admin.role !== role) throw new Fail(403, 'forbidden', 'Only a super admin can do that.');
  return admin;
}
export async function session(c: C, adminId: string, kind: 'full' | 'pending_2fa'): Promise<void> {
  const { db, env } = c.get('deps');
  const token = randomToken();
  const minutes = kind === 'full' ? IDLE_MINUTES : 5;
  await db.query('delete from admin_sessions where admin_id = $1 and (kind = $2 or expires_at < now())', [adminId, 'pending_2fa']);
  await db.query('insert into admin_sessions (admin_id, token_hash, kind, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4::int))', [adminId, await sha256(token), kind, minutes]);
  setCookie(c, cookie(env), token, { httpOnly: true, secure: secure(env), sameSite: 'Strict', path: '/', maxAge: minutes * 60 });
}
export const lockKey = async (email: string) => `admin:${await sha256(email)}`;
export async function locked(db: Db, key: string): Promise<boolean> {
  return !!(await one(db, 'select 1 from throttles where key = $1 and locked_until > now()', [key]));
}
export async function strike(db: Db, key: string): Promise<void> {
  const row = await one(db, `insert into throttles (key, count, window_start) values ($1, 1, now()) on conflict (key) do update set
    count = case when throttles.window_start < now() - interval '15 minutes' then 1 else throttles.count + 1 end,
    window_start = case when throttles.window_start < now() - interval '15 minutes' then now() else throttles.window_start end returning count`, [key]);
  if (Number(row?.count ?? 0) >= 5) await db.query("update throttles set locked_until = now() + interval '30 minutes', count = 0 where key = $1", [key]);
}
export const mask = (email: string) => email.replace(/^(.).*(@.*)$/, '$1•••$2');


/** A fresh authenticator code, asked again before keys and payment settings change. */
export async function stepUp(c: C, code: string | undefined): Promise<void> {
  const admin = need(c, 'super');
  const { db, env, now } = c.get('deps');
  if (!code || !/^\d{6}$/.test(code)) throw new Fail(422, 'code_needed', 'Enter the 6-digit code from your authenticator.');
  const key = await lockKey(admin.email);
  if (await locked(db, key)) throw new Fail(429, 'locked', 'Too many tries. Paused for 30 minutes.');
  const row = (await one(db, 'select totp_secret, totp_last_step from admins where id = $1', [admin.id]))!;
  const step = await verifyTotp(await unseal(row.totp_secret, env.TOTP_KEY), code, now(), Number(row.totp_last_step));
  if (step === null) {
    await strike(db, key);
    throw new Fail(401, 'wrong_code', 'That code did not match.');
  }
  await db.query('update admins set totp_last_step = $2 where id = $1', [admin.id, step]);
}
