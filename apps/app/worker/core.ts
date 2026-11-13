import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { z } from 'zod';
import { type Db, type Row, one } from '@zorion/db';
import { hmac, randomToken, sha256 } from './crypto';

export interface Env {
  DATABASE_URL: string;
  APP_ORIGIN: string; // https://zorionapp.midnightpoetry.studio
  SITE_ORIGIN: string; // https://zorion.midnightpoetry.studio
  PEPPER: string; // long random secret for HMACs
  TOTP_KEY: string; // 32 random bytes, base64
  ENVIRONMENT?: string; // "production" or "development"
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  PLACES_PROVIDER?: string; // "osm" or "google"; the admin setting wins
  GOOGLE_PLACES_KEY?: string;
  GOOGLE_ROUTES_KEY?: string; // optional; falls back to GOOGLE_PLACES_KEY
  OVERPASS_URL?: string; // your own Overpass server, if you run one
  NOMINATIM_URL?: string; // your own Nominatim server, if you run one
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  ASSETS?: { fetch(req: Request): Promise<Response> };
}

/** Everything a handler needs from outside. Tests swap these for fakes. */
export interface Deps {
  db: Db;
  env: Env;
  fetch: typeof fetch;
  now(): Date;
  /** Emails sent in tests and development, newest last. */
  outbox: Array<{ to: string; subject: string; text: string }>;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  plan: 'free' | 'pro';
  theme: 'gold' | 'pink';
  status: 'active' | 'suspended';
  totp_enabled: boolean;
  has_password: boolean;
}

export type Vars = { deps: Deps; user: User | null; sessionId: string | null; pending: { userId: string; first: string } | null };
export type App = { Bindings: Env; Variables: Vars };
export type C = Context<App>;

/** A refusal the client can show. Anything else becomes a plain 500 with no detail. */
export class Fail extends Error {
  constructor(public status: 400 | 401 | 402 | 403 | 404 | 409 | 410 | 422 | 429, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function body<S extends z.ZodType>(c: C, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new Fail(400, 'bad_json', 'The request could not be read.');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Fail(422, 'invalid', parsed.error.issues[0]?.message ?? 'That does not look right.');
  return parsed.data;
}

export const isProd = (env: Env): boolean => env.ENVIRONMENT === 'production';
const secure = (env: Env): boolean => env.APP_ORIGIN.startsWith('https://');
const cookieName = (env: Env, name: string): string => (secure(env) ? `__Host-${name}` : name);

export function putCookie(c: C, name: string, value: string, maxAgeSeconds: number): void {
  const env = c.get('deps').env;
  setCookie(c, cookieName(env, name), value, { httpOnly: true, secure: secure(env), sameSite: 'Lax', path: '/', maxAge: maxAgeSeconds });
}
export function readCookie(c: C, name: string): string | undefined {
  return getCookie(c, cookieName(c.get('deps').env, name));
}
export function dropCookie(c: C, name: string): void {
  const env = c.get('deps').env;
  deleteCookie(c, cookieName(env, name), { path: '/', secure: secure(env) });
}

/** A stable, non-reversible stand-in for the caller's network address. */
export async function clientKey(c: C): Promise<string> {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  return (await hmac(c.get('deps').env.PEPPER, `ip:${ip}`)).slice(0, 32);
}

// ---------- attempt limits ----------
export async function isLocked(db: Db, key: string): Promise<Date | null> {
  const row = await one(db, 'select locked_until from throttles where key = $1 and locked_until > now()', [key]);
  return row ? new Date(row.locked_until) : null;
}
/** Counts one attempt. Locks the key for `lockMinutes` once `max` attempts land inside `windowMinutes`. */
export async function strike(db: Db, key: string, max: number, windowMinutes: number, lockMinutes: number): Promise<boolean> {
  const rows = await db.query(
    `insert into throttles (key, count, window_start) values ($1, 1, now())
     on conflict (key) do update set
       count = case when throttles.window_start < now() - make_interval(mins => $2::int) then 1 else throttles.count + 1 end,
       window_start = case when throttles.window_start < now() - make_interval(mins => $2::int) then now() else throttles.window_start end
     returning count`,
    [key, windowMinutes],
  );
  const locked = Number(rows[0]?.count ?? 0) >= max;
  if (locked) await db.query('update throttles set locked_until = now() + make_interval(mins => $2::int), count = 0 where key = $1', [key, lockMinutes]);
  return locked;
}
export async function clearStrikes(db: Db, key: string): Promise<void> {
  await db.query('delete from throttles where key = $1', [key]);
}
export async function guardLock(db: Db, key: string): Promise<void> {
  const until = await isLocked(db, key);
  if (until) throw new Fail(429, 'locked', 'Too many tries. Please wait a few minutes and try again.', { retryAt: until.toISOString() });
}

// ---------- sessions ----------
const SESSION_DAYS = 30;
const PENDING_MINUTES = 10;

export async function startSession(c: C, userId: string, kind: 'full' | 'pending_2fa', first?: string): Promise<void> {
  const { db } = c.get('deps');
  const token = randomToken();
  const seconds = kind === 'full' ? SESSION_DAYS * 86400 : PENDING_MINUTES * 60;
  await db.query('delete from sessions where user_id = $1 and kind = $2', [userId, 'pending_2fa']);
  await db.query('insert into sessions (user_id, token_hash, kind, first_factor, expires_at) values ($1, $2, $3, $4, now() + make_interval(secs => $5::int))', [
    userId,
    await sha256(token),
    kind,
    first ?? null,
    seconds,
  ]);
  if (kind === 'full') await db.query('update users set last_sign_in_at = now() where id = $1', [userId]);
  putCookie(c, 'zorion', token, seconds);
}

const USER_COLUMNS = `u.id, u.email, u.display_name, u.plan, u.theme, u.status, u.totp_enabled, (u.password_hash is not null) as has_password`;

export async function loadSession(c: C): Promise<void> {
  c.set('user', null);
  c.set('sessionId', null);
  c.set('pending', null);
  const token = readCookie(c, 'zorion');
  if (!token) return;
  const row = await one(
    c.get('deps').db,
    `select s.id as session_id, s.kind, s.first_factor, ${USER_COLUMNS} from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [await sha256(token)],
  );
  if (!row || row.status !== 'active') return;
  if (row.kind === 'pending_2fa') {
    c.set('pending', { userId: row.id, first: row.first_factor });
    return;
  }
  c.set('sessionId', row.session_id);
  c.set('user', toUser(row));
}
export function toUser(row: Row): User {
  return { id: row.id, email: row.email, display_name: row.display_name, plan: row.plan, theme: row.theme, status: row.status, totp_enabled: row.totp_enabled, has_password: row.has_password };
}
export function requireUser(c: C): User {
  const user = c.get('user');
  if (!user) throw new Fail(401, 'sign_in', 'Please sign in.');
  return user;
}
export async function endSession(c: C): Promise<void> {
  const token = readCookie(c, 'zorion');
  if (token) await c.get('deps').db.query('delete from sessions where token_hash = $1', [await sha256(token)]);
  dropCookie(c, 'zorion');
}

// ---------- email ----------
export async function sendEmail(deps: Deps, to: string, subject: string, text: string): Promise<void> {
  deps.outbox.push({ to, subject, text });
  if (deps.outbox.length > 20) deps.outbox.shift();
  const { RESEND_API_KEY, EMAIL_FROM } = deps.env;
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    if (isProd(deps.env)) throw new Error('Email is not configured: set RESEND_API_KEY and EMAIL_FROM');
    return; // development: the code stays in the outbox, nothing leaves the machine
  }
  const res = await deps.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Resend refused the email (${res.status})`);
}

export async function setting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await one(db, 'select value from settings where key = $1', [key]);
  return row ? (row.value as T) : fallback;
}
