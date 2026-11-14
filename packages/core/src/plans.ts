// What Free and Pro include, and what Pro costs. Set in the admin portal (settings key "plans");
// these defaults apply until an admin saves. The API enforces them; screens only reflect them.

import type { TravelMode } from './rules';

export type PlanName = 'free' | 'pro';
export const TRAVEL_MODES: TravelMode[] = ['walk', 'cycle', 'transit'];

export interface PlanFeatures {
  /** Sees ads (Google ads, falling back to sponsored slots). */
  ads: boolean;
  /** People in one meetup, host included. */
  groupSize: number;
  /** Meetups that have not ended, at one time. 0 means no limit. */
  activeMeetups: number;
  /** Ways the host can choose for trip times. Walking is always included. */
  travel: TravelMode[];
  /** Own food options with an icon. */
  ownCategories: boolean;
  /** Gold theme for the host's own app. */
  goldTheme: boolean;
  /** Gold theme for guests opening the host's link. */
  guestTheme: boolean;
}

export interface Plans {
  free: PlanFeatures;
  pro: PlanFeatures;
  /** Pro prices in cents of `currency`. 0 means not on sale. */
  price: { currency: 'sgd'; monthly: number; yearly: number };
}

export const DEFAULT_PLANS: Plans = {
  free: { ads: true, groupSize: 8, activeMeetups: 0, travel: ['walk'], ownCategories: false, goldTheme: false, guestTheme: false },
  pro: { ads: false, groupSize: 30, activeMeetups: 0, travel: ['walk', 'cycle', 'transit'], ownCategories: true, goldTheme: true, guestTheme: true },
  price: { currency: 'sgd', monthly: 0, yearly: 0 },
};

const int = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
};
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function features(raw: unknown, base: PlanFeatures): PlanFeatures {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const travel = Array.isArray(r.travel) ? TRAVEL_MODES.filter((m) => (r.travel as unknown[]).includes(m)) : base.travel;
  return {
    ads: bool(r.ads, base.ads),
    groupSize: int(r.groupSize, 2, 200, base.groupSize),
    activeMeetups: int(r.activeMeetups, 0, 100, base.activeMeetups),
    travel: travel.includes('walk') ? travel : ['walk', ...travel],
    ownCategories: bool(r.ownCategories, base.ownCategories),
    goldTheme: bool(r.goldTheme, base.goldTheme),
    guestTheme: bool(r.guestTheme, base.guestTheme),
  };
}

/** Reads a stored "plans" value safely. Older settings (group_size) fill in what "plans" lacks. */
export function normalizePlans(raw: unknown, legacy: { groupSize?: { free?: number; pro?: number } } = {}): Plans {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const free = { ...DEFAULT_PLANS.free, ...(legacy.groupSize?.free ? { groupSize: legacy.groupSize.free } : {}) };
  const pro = { ...DEFAULT_PLANS.pro, ...(legacy.groupSize?.pro ? { groupSize: legacy.groupSize.pro } : {}) };
  const price = (r.price && typeof r.price === 'object' ? r.price : {}) as Record<string, unknown>;
  return {
    free: features(r.free, free),
    pro: features(r.pro, pro),
    price: { currency: 'sgd', monthly: int(price.monthly, 0, 100_000, 0), yearly: int(price.yearly, 0, 1_000_000, 0) },
  };
}

/** "S$4.90" */
export const formatPrice = (cents: number): string => `S$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export const TRAVEL_LABEL: Record<TravelMode, string> = { walk: 'Walking', cycle: 'Cycling', transit: 'Transit' };
