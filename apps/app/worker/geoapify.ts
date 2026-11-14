// Geoapify (free plan: 3,000 credits a day, commercial use with attribution). Built on OpenStreetMap
// data, so its places carry the same tags as an Overpass search, and the category's own OpenStreetMap
// filters decide which of them count.
import type { Point, TravelMode } from '@zorion/core';
import { isRefusal, pause, take } from '@zorion/server/usage';
import type { Deps } from './core';
import type { CategoryQuery, FoundPlace } from './places';
import type { StartResult } from './geocode';

const BASE = 'https://api.geoapify.com';
const LIMIT = 60; // 1 credit, plus 1 for every 20 places past the first 20

async function call(deps: Deps, url: string, init?: RequestInit): Promise<unknown> {
  const res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    if (isRefusal(res.status)) await pause(deps.db, 'geoapify', deps.now());
    throw new Error(`Geoapify failed (${res.status})`);
  }
  return res.json();
}

/** One OpenStreetMap filter, e.g. ["cuisine"~"pizza|italian",i]. */
interface Filter { key: string; exact: boolean; value: string; i: boolean }
function parseFilters(q: string): Filter[] {
  const out: Filter[] = [];
  for (const m of q.matchAll(/\["([a-z:_]+)"(=|~)"([^"\]]+)"(,i)?\]/g)) out.push({ key: m[1]!, exact: m[2] === '=', value: m[3]!, i: !!m[4] });
  return out;
}
function matches(tags: Record<string, string>, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = tags[f.key];
    if (v === undefined) return false;
    if (f.exact) return f.i ? v.toLowerCase() === f.value.toLowerCase() : v === f.value;
    try { return new RegExp(f.value, f.i ? 'i' : '').test(v); } catch { return false; }
  });
}
// OpenStreetMap amenity → Geoapify category.
const AMENITY: Record<string, string> = { restaurant: 'catering.restaurant', fast_food: 'catering.fast_food', cafe: 'catering.cafe', bar: 'catering.bar', pub: 'catering.pub', biergarten: 'catering.biergarten', food_court: 'catering.food_court', ice_cream: 'catering.ice_cream' };

export async function geoapifyPlaces(deps: Deps, center: Point, radius: number, cat: CategoryQuery): Promise<FoundPlace[]> {
  const words = cat.name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().toLowerCase();
  const queries = cat.own ? [] : cat.osm.map(parseFilters).filter((f) => f.length);
  const amenities = new Set<string>();
  for (const fs of queries) for (const f of fs) if (f.key === 'amenity') for (const a of f.value.split('|')) if (AMENITY[a]) amenities.add(AMENITY[a]);
  const categories = amenities.size ? [...amenities].join(',') : 'catering';
  if (!(await take(deps.db, 'geoapify', Math.ceil(LIMIT / 20), deps.now()))) throw new Error('Geoapify allowance used');
  const url = `${BASE}/v2/places?categories=${categories}&filter=circle:${center.lng.toFixed(6)},${center.lat.toFixed(6)},${Math.round(radius)}&bias=proximity:${center.lng.toFixed(6)},${center.lat.toFixed(6)}&limit=${LIMIT}&apiKey=${encodeURIComponent(deps.env.GEOAPIFY_KEY!)}`;
  const data = (await call(deps, url)) as { features?: Array<{ properties?: { place_id?: string; name?: string; lat?: number; lon?: number; address_line2?: string; datasource?: { raw?: Record<string, string> } } }> };
  const out: FoundPlace[] = [];
  for (const f of data.features ?? []) {
    const p = f.properties;
    if (!p?.name || p.lat === undefined || p.lon === undefined) continue;
    const tags: Record<string, string> = { ...(p.datasource?.raw ?? {}), name: p.name };
    const ok = cat.own
      ? !!words && (p.name.toLowerCase().includes(words) || (tags.cuisine ?? '').toLowerCase().includes(words.replace(/ /g, '_')))
      : queries.length === 0 || queries.some((fs) => matches(tags, fs));
    if (ok) out.push({ ref: `geoapify/${p.place_id ?? `${p.lat},${p.lon}`}`, name: p.name.slice(0, 80), lat: p.lat, lng: p.lon, address: p.address_line2?.slice(0, 120) ?? null, rating: null, openNow: null });
  }
  return out;
}

export async function geoapifyLookup(deps: Deps, q: string, near: { country?: string; lat?: number; lng?: number }): Promise<StartResult[]> {
  if (!(await take(deps.db, 'geoapify', 1, deps.now()))) throw new Error('Geoapify allowance used');
  const params = new URLSearchParams({ text: q, limit: '5', format: 'json', apiKey: deps.env.GEOAPIFY_KEY! });
  if (near.country && /^[A-Za-z]{2}$/.test(near.country)) params.set('filter', `countrycode:${near.country.toLowerCase()}`);
  if (near.lat !== undefined && near.lng !== undefined) params.set('bias', `proximity:${near.lng},${near.lat}`);
  const data = (await call(deps, `${BASE}/v1/geocode/search?${params}`)) as { results?: Array<{ formatted?: string; lat?: number; lon?: number }> };
  return (data.results ?? []).filter((r) => r.formatted && r.lat !== undefined && r.lon !== undefined).slice(0, 5).map((r) => ({ label: r.formatted!.slice(0, 120), lat: r.lat!, lng: r.lon! }));
}

const MODE: Record<TravelMode, string> = { walk: 'walk', cycle: 'bicycle', transit: '' };
/** Credits for a route table, as Geoapify counts them. */
export const matrixCredits = (s: number, t: number) => Math.max(s, t) * Math.min(s, t, 10);

export async function geoapifyMatrix(deps: Deps, origins: readonly Point[], destinations: readonly Point[], mode: TravelMode): Promise<(number | null)[][]> {
  if (mode === 'transit') throw new Error('Geoapify has no transit');
  if (origins.length * destinations.length > 1000) throw new Error('too many pairs for Geoapify');
  if (!(await take(deps.db, 'geoapify', matrixCredits(origins.length, destinations.length), deps.now()))) throw new Error('Geoapify allowance used');
  const data = (await call(deps, `${BASE}/v1/routematrix?apiKey=${encodeURIComponent(deps.env.GEOAPIFY_KEY!)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: MODE[mode], sources: origins.map((p) => ({ location: [p.lng, p.lat] })), targets: destinations.map((p) => ({ location: [p.lng, p.lat] })) }),
  })) as { sources_to_targets?: Array<Array<{ time?: number | null } | null>> };
  if (!Array.isArray(data.sources_to_targets) || data.sources_to_targets.length !== origins.length) throw new Error('Geoapify sent an unexpected answer');
  return data.sources_to_targets.map((row) => destinations.map((_, d) => { const t = row?.[d]?.time; return typeof t === 'number' && Number.isFinite(t) ? Math.max(1, Math.round(t / 60)) : null; }));
}
