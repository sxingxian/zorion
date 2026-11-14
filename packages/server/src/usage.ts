// How much of each map service's free allowance Zorion has used, so it can move to the next service
// before an allowance runs out. No API key can read a provider's billing, so Zorion counts its own calls.
//  - Google bills per service (SKU) per calendar month, Pacific time. Zorion switches at a share of the
//    free amount the admin picks (default 90%), or never if the admin chose to keep paying.
//  - Geoapify's free plan is 3,000 credits a day; openrouteservice's is 500 matrix requests a day.
//    These refuse, rather than bill, past the limit, so Zorion simply moves on at the limit.
// If a service refuses anyway (quota, billing, rate limit), Zorion pauses it for an hour.
import type { Db } from '@zorion/db';

type Period = 'month' | 'day';
interface Service { label: string; unit: string; free: number; period: Period; provider: Provider; billed: boolean }
export type Provider = 'google' | 'geoapify' | 'ors' | 'onemap';

export const SERVICES = {
  // Place searches ask for rating and opening hours, which makes them Enterprise SKUs (1,000 free each).
  places_text: { label: 'Place searches', unit: 'searches', free: 1000, period: 'month', provider: 'google', billed: true },
  places_nearby: { label: 'Nearby searches', unit: 'searches', free: 1000, period: 'month', provider: 'google', billed: true },
  // Typed starting places ask for name, address and location only: a Pro SKU (5,000 free).
  lookup: { label: 'Starting place lookups', unit: 'lookups', free: 5000, period: 'month', provider: 'google', billed: true },
  // Route matrices are billed per origin–destination pair: an Essentials SKU (10,000 free).
  routes: { label: 'Trip time pairs', unit: 'pairs', free: 10000, period: 'month', provider: 'google', billed: true },
  // Geoapify: one pool of credits for places, lookups and route tables.
  geoapify: { label: 'Geoapify credits', unit: 'credits', free: 3000, period: 'day', provider: 'geoapify', billed: false },
  // openrouteservice: matrix requests (each is one table of trip times).
  ors_matrix: { label: 'openrouteservice tables', unit: 'tables', free: 500, period: 'day', provider: 'ors', billed: false },
} as const satisfies Record<string, Service>;
export type ServiceKey = keyof typeof SERVICES;
/** Kept for the Google-only callers and the portal. */
export const GOOGLE_SERVICES = { places_text: SERVICES.places_text, places_nearby: SERVICES.places_nearby, lookup: SERVICES.lookup, routes: SERVICES.routes };
export type GoogleService = keyof typeof GOOGLE_SERVICES;

/** "50" | "75" | "90" | "100": switch from Google at that share of its free amount. "paid": keep using Google. */
export type GoogleBudget = '50' | '75' | '90' | '100' | 'paid';
export const GOOGLE_BUDGETS: GoogleBudget[] = ['50', '75', '90', '100', 'paid'];

/** Google's billing month runs on Pacific time. */
export function billingMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);
/** The first day of the next billing month, for "until 1 Dec". */
export function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
const periodKey = (s: ServiceKey, now: Date) => (SERVICES[s].period === 'month' ? billingMonth(now) : utcDay(now));
const counterKey = (s: ServiceKey, now: Date) => `${SERVICES[s].provider === 'google' ? 'google' : 'free'}:${s}:${periodKey(s, now)}`;

export function limitFor(s: ServiceKey, budget: GoogleBudget): number | null {
  const svc = SERVICES[s];
  if (!svc.billed) return svc.free; // refused past the limit anyway: use it all
  return budget === 'paid' ? null : Math.floor((svc.free * Number(budget)) / 100);
}

async function budgetOf(db: Db): Promise<GoogleBudget> {
  const rows = await db.query("select value from settings where key = 'google_budget'");
  const v = rows[0]?.value;
  return GOOGLE_BUDGETS.includes(v as GoogleBudget) ? (v as GoogleBudget) : '90';
}
const pauseKey = (p: Provider) => (p === 'google' ? 'google_paused_until' : `paused_until:${p}`);

/** Whether a provider is paused after refusing a request. */
export async function isPaused(db: Db, p: Provider, now: Date): Promise<boolean> {
  const rows = await db.query('select value from settings where key = $1', [pauseKey(p)]);
  return !!rows[0] && new Date(rows[0].value as string).getTime() > now.getTime();
}

/**
 * Takes `units` from this period's allowance for one service. True: go ahead. False: move on to the
 * next service. Safe when many requests arrive at once: the count is raised in one statement, and
 * given back if it went over.
 */
export async function take(db: Db, s: ServiceKey, units: number, now: Date): Promise<boolean> {
  if (await isPaused(db, SERVICES[s].provider, now)) return false;
  if (units <= 0) return true;
  const limit = limitFor(s, SERVICES[s].billed ? await budgetOf(db) : '100');
  const key = counterKey(s, now);
  const rows = await db.query(
    'insert into usage_counters (key, count) values ($1, $2) on conflict (key) do update set count = usage_counters.count + excluded.count, updated_at = now() returning count',
    [key, units],
  );
  if (limit !== null && Number(rows[0]!.count) > limit) {
    await db.query('update usage_counters set count = count - $2 where key = $1', [key, units]);
    return false;
  }
  return true;
}
/** Kept for Google callers. */
export const takeGoogle = (db: Db, s: GoogleService, units: number, now: Date) => take(db, s, units, now);

/** A provider said no (quota, billing, rate limit or key problem): skip it for the next hour. */
export async function pause(db: Db, p: Provider, now: Date, minutes = 60): Promise<void> {
  await db.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [pauseKey(p), JSON.stringify(new Date(now.getTime() + minutes * 60_000).toISOString())]);
}
export const pauseGoogle = (db: Db, now: Date, minutes = 60) => pause(db, 'google', now, minutes);
/** True for answers that mean a provider won't serve us for a while, rather than a one-off glitch. */
export const isRefusal = (status: number) => status === 429 || status === 403 || status === 402 || status === 401;
export const isGoogleRefusal = isRefusal;

/** This period's use and limits for every service, for the admin portal. */
export async function usageReport(db: Db, now: Date) {
  const budget = await budgetOf(db);
  const month = billingMonth(now);
  const day = utcDay(now);
  const rows = await db.query('select key, count from usage_counters where key like $1 or key like $2', [`google:%:${month}`, `free:%:${day}`]);
  const used = new Map(rows.map((r) => [String(r.key).split(':')[1], Number(r.count)]));
  const paused: Record<string, string | null> = {};
  for (const p of ['google', 'geoapify', 'ors', 'onemap'] as Provider[]) {
    const r = await db.query('select value from settings where key = $1', [pauseKey(p)]);
    paused[p] = r[0] && new Date(r[0].value as string).getTime() > now.getTime() ? (r[0].value as string) : null;
  }
  return {
    month, resets: nextMonthStart(month), day, budget, paused, pausedUntil: paused.google,
    services: (Object.keys(SERVICES) as ServiceKey[]).map((s) => ({ key: s, ...SERVICES[s], used: used.get(s) ?? 0, limit: limitFor(s, budget) })),
  };
}
/** The Google part of the report, as the portal's Google box shows it. */
export async function googleUsage(db: Db, now: Date) {
  const r = await usageReport(db, now);
  return { ...r, services: r.services.filter((s) => s.provider === 'google') };
}
