// Keys and addresses an admin sets in the portal instead of the Cloudflare dashboard.
// Secrets are encrypted with a key derived from TOTP_KEY before they reach the database, are never
// sent back to a browser (only their last four characters), and win over the same Worker variable.
import { type Db, one } from '@zorion/db';
import { seal, unseal } from './crypto';

export const SECRET_SETTINGS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'RESEND_API_KEY'] as const;
export const PLAIN_SETTINGS = ['TELEGRAM_BOT_USERNAME', 'EMAIL_FROM'] as const;
export type SettingName = (typeof SECRET_SETTINGS)[number] | (typeof PLAIN_SETTINGS)[number];
export const isSettingName = (n: string): n is SettingName => (SECRET_SETTINGS as readonly string[]).includes(n) || (PLAIN_SETTINGS as readonly string[]).includes(n);
const isSecret = (n: SettingName) => (SECRET_SETTINGS as readonly string[]).includes(n);

/** The sender used when no address has been set. The domain must be verified in Resend. */
export const DEFAULT_EMAIL_FROM = 'Zorion <noreply@app.midnightpoetry.studio>';

// A separate key from the one that protects authenticator secrets, derived from the same Worker secret.
const settingsKey = (totpKey: string) => `${totpKey}|zorion-settings-v1`;
const rowKey = (name: SettingName) => `env:${name}`;

// Saved values change rarely, so each Worker instance re-reads them at most every 30 seconds.
const cache = new WeakMap<object, { at: number; value: Partial<Record<SettingName, string>> }>();
export async function cachedSettings(db: Db, totpKey: string, maxAgeMs = 30_000): Promise<Partial<Record<SettingName, string>>> {
  const hit = cache.get(db);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  const value = await loadSettings(db, totpKey);
  cache.set(db, { at: Date.now(), value });
  return value;
}
export const forgetCachedSettings = (db: Db): void => { cache.delete(db); };

export async function saveSetting(db: Db, totpKey: string, name: SettingName, value: string | null): Promise<void> {
  cache.delete(db);
  if (value === null || value === '') {
    await db.query('delete from settings where key = $1', [rowKey(name)]);
    return;
  }
  const stored = isSecret(name) ? { sealed: await seal(value, settingsKey(totpKey)), hint: value.slice(-4) } : { value };
  await db.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [rowKey(name), JSON.stringify(stored)]);
}

/** Every saved value, decrypted, for merging over the Worker's variables. */
export async function loadSettings(db: Db, totpKey: string): Promise<Partial<Record<SettingName, string>>> {
  const rows = await db.query("select key, value from settings where key like 'env:%'");
  const out: Partial<Record<SettingName, string>> = {};
  for (const r of rows) {
    const name = String(r.key).slice(4);
    if (!isSettingName(name)) continue;
    const v = r.value as { sealed?: string; value?: string };
    try {
      if (v.sealed) out[name] = await unseal(v.sealed, settingsKey(totpKey));
      else if (typeof v.value === 'string') out[name] = v.value;
    } catch {
      // TOTP_KEY changed since this was saved: treat it as not set rather than failing every request.
    }
  }
  return out;
}

/** What the portal may show: whether each is set, where from, and the last four characters of secrets. */
export async function settingsStatus(db: Db, env: Record<string, unknown>): Promise<Record<SettingName, { set: boolean; from: 'portal' | 'worker' | null; hint: string; updatedAt: string | null }>> {
  const rows = await db.query("select key, value, updated_at from settings where key like 'env:%'");
  const saved = new Map(rows.map((r) => [String(r.key).slice(4), r]));
  const out = {} as Record<SettingName, { set: boolean; from: 'portal' | 'worker' | null; hint: string; updatedAt: string | null }>;
  for (const name of [...SECRET_SETTINGS, ...PLAIN_SETTINGS]) {
    const r = saved.get(name);
    const v = r?.value as { hint?: string; value?: string } | undefined;
    const fromEnv = typeof env[name] === 'string' && (env[name] as string).length > 0 ? (env[name] as string) : null;
    out[name] = r
      ? { set: true, from: 'portal', hint: isSecret(name) ? v?.hint ?? '' : v?.value ?? '', updatedAt: new Date(r.updated_at as string).toISOString() }
      : { set: !!fromEnv, from: fromEnv ? 'worker' : null, hint: fromEnv ? (isSecret(name) ? fromEnv.slice(-4) : fromEnv) : '', updatedAt: null };
  }
  return out;
}

export async function readJson<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await one(db, 'select value from settings where key = $1', [key]);
  return row ? (row.value as T) : fallback;
}
