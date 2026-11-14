// Google Maps Platform's free monthly allowance, and Zorion's own count of what it has used.
// Each billable service (SKU) has its own free amount each calendar month, Pacific time. An API key
// can't read the billing account, so Zorion counts its own calls and switches to the free services
// (OpenStreetMap places and lookups, OpenStreetMap routing or Zorion's estimate) before the free
// amount runs out, unless the admin chose to keep paying for Google.
import type { Db } from '@zorion/db';

/** What each service costs Zorion in Google's terms, and how much is free each month. */
export const GOOGLE_SERVICES = {
  // Place searches ask for rating and opening hours, which makes them Enterprise SKUs (1,000 free each).
  places_text: { label: 'Place searches', unit: 'searches', free: 1000 },
  places_nearby: { label: 'Nearby searches', unit: 'searches', free: 1000 },
  // Typed starting places ask for name, address and location only: a Pro SKU (5,000 free).
  lookup: { label: 'Starting place lookups', unit: 'lookups', free: 5000 },
  // Route matrices are billed per origin–destination pair: an Essentials SKU (10,000 free).
  routes: { label: 'Trip time pairs', unit: 'pairs', free: 10000 },
} as const;
export type GoogleService = keyof typeof GOOGLE_SERVICES;

/** "50" | "75" | "90" | "100": switch at that share of the free amount. "paid": keep using Google. */
export type GoogleBudget = '50' | '75' | '90' | '100' | 'paid';
export const GOOGLE_BUDGETS: GoogleBudget[] = ['50', '75', '90', '100', 'paid'];

/** Google's billing month runs on Pacific time. */
export function billingMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}
/** The first day of the next billing month, for "until 1 Dec". */
export function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
export const limitFor = (service: GoogleService, budget: GoogleBudget): number | null =>
  budget === 'paid' ? null : Math.floor((GOOGLE_SERVICES[service].free * Number(budget)) / 100);

const counterKey = (service: GoogleService, month: string) => `google:${service}:${month}`;
const PAUSE_KEY = 'google_paused_until';

async function budgetOf(db: Db): Promise<GoogleBudget> {
  const rows = await db.query("select value from settings where key = 'google_budget'");
  const v = rows[0]?.value;
  return GOOGLE_BUDGETS.includes(v as GoogleBudget) ? (v as GoogleBudget) : '90';
}

/**
 * Takes `units` from this month's allowance for one service. True: go ahead with Google.
 * False: use the free service instead. Safe when many requests arrive at once: the count is
 * raised in one statement, and given back if it went over.
 */
export async function takeGoogle(db: Db, service: GoogleService, units: number, now: Date): Promise<boolean> {
  if (units <= 0) return true;
  const paused = await db.query('select value from settings where key = $1', [PAUSE_KEY]);
  if (paused[0] && new Date(paused[0].value as string).getTime() > now.getTime()) return false;
  const limit = limitFor(service, await budgetOf(db));
  const key = counterKey(service, billingMonth(now));
  const rows = await db.query(
    'insert into usage_counters (key, count) values ($1, $2) on conflict (key) do update set count = usage_counters.count + excluded.count, updated_at = now() returning count',
    [key, units],
  );
  const count = Number(rows[0]!.count);
  if (limit !== null && count > limit) {
    await db.query('update usage_counters set count = count - $2 where key = $1', [key, units]);
    return false;
  }
  return true;
}

/** Google said no (quota, billing or key problem): use the free services for the next hour. */
export async function pauseGoogle(db: Db, now: Date, minutes = 60): Promise<void> {
  await db.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [PAUSE_KEY, JSON.stringify(new Date(now.getTime() + minutes * 60_000).toISOString())]);
}
/** True for answers that mean Google won't serve us for a while (rather than a one-off glitch). */
export const isGoogleRefusal = (status: number) => status === 429 || status === 403 || status === 402;

/** This month's use and limits, for the admin portal. */
export async function googleUsage(db: Db, now: Date) {
  const month = billingMonth(now);
  const budget = await budgetOf(db);
  const rows = await db.query('select key, count from usage_counters where key like $1', [`google:%:${month}`]);
  const used = new Map(rows.map((r) => [String(r.key).split(':')[1], Number(r.count)]));
  const paused = await db.query('select value from settings where key = $1', [PAUSE_KEY]);
  const pausedUntil = paused[0] && new Date(paused[0].value as string).getTime() > now.getTime() ? (paused[0].value as string) : null;
  return {
    month, resets: nextMonthStart(month), budget, pausedUntil,
    services: (Object.keys(GOOGLE_SERVICES) as GoogleService[]).map((s) => ({ key: s, ...GOOGLE_SERVICES[s], used: used.get(s) ?? 0, limit: limitFor(s, budget) })),
  };
}
