/**
 * Cryptography helpers. Standard primitives only, all from Web Crypto:
 * PBKDF2-SHA256 for passwords, HMAC-SHA256 for codes and tokens,
 * AES-GCM for authenticator secrets, RFC 6238 for authenticator codes.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toHex = (buf: ArrayBuffer | Uint8Array): string => [...new Uint8Array(buf as ArrayBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex: string): Uint8Array => new Uint8Array((hex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
export const toB64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
/** URL-safe random token, 256 bits by default. */
export function randomToken(bytes = 32): string {
  return toB64Url(randomBytes(bytes));
}
/** Uniform random digits, without modulo bias. */
export function randomDigits(n: number): string {
  let out = '';
  while (out.length < n) {
    const b = randomBytes(1)[0]!;
    if (b < 250) out += String(b % 10);
  }
  return out;
}

export async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Compares without leaking where the strings differ. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------- passwords ----------
// Workers cap PBKDF2 at 100,000 rounds, so the password is first keyed with a server-side
// pepper (HMAC). A stolen database alone is then not enough to test guesses.
const ROUNDS = 100_000;

async function pbkdf2(secret: string, salt: Uint8Array, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: rounds }, key, 256));
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await pbkdf2(await hmac(pepper, password), salt, ROUNDS);
  return `pbkdf2-sha256$${ROUNDS}$${toHex(salt)}$${digest}`;
}

export async function verifyPassword(password: string, stored: string | null, pepper: string): Promise<boolean> {
  // Always do the work, even with no stored hash, so timing does not reveal whether an account exists.
  const [scheme, rounds, salt, digest] = (stored ?? `pbkdf2-sha256$${ROUNDS}$${'00'.repeat(16)}$${'00'.repeat(32)}`).split('$');
  if (scheme !== 'pbkdf2-sha256' || !rounds || !salt || !digest) return false;
  const candidate = await pbkdf2(await hmac(pepper, password), fromHex(salt), Number(rounds));
  return safeEqual(candidate, digest) && stored !== null;
}

// ---------- authenticator secrets at rest ----------
async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error('TOTP_KEY must be 32 random bytes, base64 encoded');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(plain: string, keyB64: string): Promise<string> {
  const iv = randomBytes(12);
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await aesKey(keyB64), enc.encode(plain));
  return `${toB64Url(iv)}.${toB64Url(new Uint8Array(out))}`;
}
export async function unseal(sealed: string, keyB64: string): Promise<string> {
  const [iv, data] = sealed.split('.');
  if (!iv || !data) throw new Error('bad sealed value');
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) as BufferSource }, await aesKey(keyB64), fromB64(data) as BufferSource);
  return dec.decode(out);
}

// ---------- authenticator codes (RFC 6238, SHA-1, 30 seconds, 6 digits) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Uint8Array): string {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return (bits.match(/.{1,5}/g) ?? []).map((c) => B32[parseInt(c.padEnd(5, '0'), 2)]).join('');
}
export function unbase32(text: string): Uint8Array {
  const bits = [...text.toUpperCase().replace(/[^A-Z2-7]/g, '')].map((c) => B32.indexOf(c).toString(2).padStart(5, '0')).join('');
  return new Uint8Array((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}
export function newTotpSecret(): string {
  return base32(randomBytes(20));
}
export async function totpAt(secret: string, step: number): Promise<string> {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const key = await crypto.subtle.importKey('raw', unbase32(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[19]! & 0xf;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}
export const totpStep = (at: Date): number => Math.floor(at.getTime() / 30_000);
/**
 * Returns the time step a code matched, or null. Accepts one step either side for clock drift
 * and refuses any step at or before `lastStep`, so a code cannot be used twice.
 */
export async function verifyTotp(secret: string, code: string, at: Date, lastStep: number): Promise<number | null> {
  const now = totpStep(at);
  let hit: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    if (safeEqual(await totpAt(secret, step), code) && step > lastStep) hit = step;
  }
  return hit;
}
export function otpauthUri(secret: string, account: string, issuer = 'Zorion'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
