import { LIMITS, type TravelMode } from './rules';

export interface Point {
  lat: number;
  lng: number;
}

const EARTH_M = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Straight-line distance in metres. */
export function haversine(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Metres per minute, and how much longer a real route is than a straight line. */
const SPEED: Record<TravelMode, { mPerMin: number; detour: number }> = {
  walk: { mPerMin: 80, detour: 1.3 },
  cycle: { mPerMin: 250, detour: 1.3 },
  transit: { mPerMin: 330, detour: 1.6 },
};

/** Estimated travel time in whole minutes. An estimate, not a routed time. */
export function travelMinutes(from: Point, to: Point, mode: TravelMode = 'walk'): number {
  const s = SPEED[mode];
  return Math.max(1, Math.round((haversine(from, to) * s.detour) / s.mPerMin));
}

/**
 * The fair middle: the point that keeps the longest trip as short as possible
 * (smallest enclosing circle, Badoiu-Clarkson iteration on a local flat projection).
 */
export function fairMiddle(points: readonly Point[]): Point {
  if (points.length === 0) throw new RangeError('at least one starting point is needed');
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const kx = Math.cos(rad(lat0));
  const flat = points.map((p) => ({ x: p.lng * kx, y: p.lat }));
  let cx = flat.reduce((s, p) => s + p.x, 0) / flat.length;
  let cy = flat.reduce((s, p) => s + p.y, 0) / flat.length;
  for (let i = 1; i <= 400; i++) {
    let far = flat[0]!;
    let best = -1;
    for (const p of flat) {
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d > best) {
        best = d;
        far = p;
      }
    }
    cx += (far.x - cx) / (i + 1);
    cy += (far.y - cy) / (i + 1);
  }
  return { lat: cy, lng: cx / kx };
}

export interface Candidate extends Point {
  id: string;
  rating?: number | null;
}
export interface RankedPlace<C extends Candidate> {
  place: C;
  longest: number;
  average: number;
  minutes: Record<string, number>;
}

/**
 * Places closest to everyone: shortest longest-trip first, then shortest average,
 * then best rating. Returns 5 to 8 when that many exist.
 */
export function rankPlaces<C extends Candidate>(
  candidates: readonly C[],
  people: ReadonlyArray<Point & { id: string }>,
  mode: TravelMode = 'walk',
  shown: number = LIMITS.placesShownMax,
): RankedPlace<C>[] {
  const cap = Math.min(Math.max(shown, LIMITS.placesShownMin), LIMITS.placesShownMax);
  return candidates
    .map((place) => {
      const minutes: Record<string, number> = {};
      for (const p of people) minutes[p.id] = travelMinutes(p, place, mode);
      const all = Object.values(minutes);
      const longest = all.length ? Math.max(...all) : 0;
      const average = all.length ? all.reduce((s, m) => s + m, 0) / all.length : 0;
      return { place, longest, average, minutes };
    })
    .sort((a, b) => a.longest - b.longest || a.average - b.average || (b.place.rating ?? 0) - (a.place.rating ?? 0))
    .slice(0, cap);
}

export function isValidPoint(p: Point): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
