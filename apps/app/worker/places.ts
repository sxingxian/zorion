import type { Point } from '@zorion/core';
import { isGoogleRefusal, pauseGoogle, takeGoogle } from '@zorion/server/usage';
import type { Deps } from './core';
import { geoapifyPlaces } from './geoapify';
import { setting } from './core';

export interface FoundPlace extends Point {
  ref: string;
  name: string;
  address: string | null;
  rating: number | null;
  openNow: boolean | null;
}

export interface CategoryQuery {
  name: string;
  own: boolean;
  osm: string[];
  google: { type?: string; text?: string };
}

export type Provider = 'google' | 'geoapify' | 'osm';
const ORDER: Provider[] = ['google', 'geoapify', 'osm'];
const ready = (deps: Deps, p: Provider) => (p === 'google' ? !!deps.env.GOOGLE_PLACES_KEY : p === 'geoapify' ? !!deps.env.GEOAPIFY_KEY : true);

/**
 * The services to try for place search, in order: the one the admin chose, then the free ones
 * (Geoapify, then OpenStreetMap). A paid service is only ever used when it was chosen.
 */
export async function placeLadder(deps: Deps): Promise<Provider[]> {
  const chosen = await setting<string>(deps.db, 'places_provider', deps.env.PLACES_PROVIDER ?? 'osm');
  const start = (ORDER as string[]).includes(chosen) ? (chosen as Provider) : 'osm';
  return [start, ...ORDER.filter((p) => p !== start && p !== 'google')].filter((p) => ready(deps, p));
}
export async function activeProvider(deps: Deps): Promise<Provider> {
  return (await placeLadder(deps))[0] ?? 'osm';
}

/** Letters, digits and spaces only, so a category name can never alter a query. */
const plainWords = (s: string): string => s.replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

async function searchOsm(deps: Deps, center: Point, radius: number, cat: CategoryQuery): Promise<FoundPlace[]> {
  const words = plainWords(cat.name);
  if (cat.own && !words) return [];
  const filters = cat.own ? [`["name"~"${words}",i]`, `["cuisine"~"${words.toLowerCase().replace(/ /g, '_')}",i]`] : cat.osm;
  const around = `(around:${Math.round(radius)},${center.lat.toFixed(6)},${center.lng.toFixed(6)})`;
  const query = `[out:json][timeout:8];(${filters.map((f) => `nwr${f}${around};`).join('')});out center 40;`;
  const res = await deps.fetch(deps.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Zorion/1.0 (zorion.midnightpoetry.studio)' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OpenStreetMap search failed (${res.status})`);
  const data = (await res.json()) as { elements?: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
  const out: FoundPlace[] = [];
  for (const el of data.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (lat === undefined || lng === undefined || !name) continue;
    const street = [el.tags?.['addr:housenumber'], el.tags?.['addr:street']].filter(Boolean).join(' ');
    out.push({ ref: `${el.type}/${el.id}`, name: name.slice(0, 80), lat, lng, address: street || null, rating: null, openNow: null });
  }
  return out;
}

async function searchGoogle(deps: Deps, center: Point, radius: number, cat: CategoryQuery): Promise<FoundPlace[]> {
  const circle = { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radius, 50000) } };
  const byType = !cat.own && cat.google.type;
  const url = `https://places.googleapis.com/v1/places:${byType ? 'searchNearby' : 'searchText'}`;
  const payload = byType
    ? { includedTypes: [cat.google.type], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: circle }
    : { textQuery: plainWords(cat.own ? cat.name : (cat.google.text ?? cat.name)), pageSize: 20, locationBias: circle };
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': deps.env.GOOGLE_PLACES_KEY!,
      'x-goog-fieldmask': 'places.id,places.displayName,places.location,places.shortFormattedAddress,places.rating,places.currentOpeningHours.openNow',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    if (isGoogleRefusal(res.status)) await pauseGoogle(deps.db, deps.now());
    throw new Error(`Google Places search failed (${res.status})`);
  }
  const data = (await res.json()) as { places?: Array<{ id: string; displayName?: { text?: string }; location?: { latitude: number; longitude: number }; shortFormattedAddress?: string; rating?: number; currentOpeningHours?: { openNow?: boolean } }> };
  return (data.places ?? [])
    .filter((p) => p.location && p.displayName?.text)
    .map((p) => ({ ref: p.id, name: p.displayName!.text!.slice(0, 80), lat: p.location!.latitude, lng: p.location!.longitude, address: p.shortFormattedAddress ?? null, rating: p.rating ?? null, openNow: p.currentOpeningHours?.openNow ?? null }));
}

/**
 * Finds places for a category near the middle. Each service in the ladder widens its search until
 * there are enough places, up to about a 40 minute walk. A service whose free allowance is used up,
 * that refuses or fails, or that finds nothing, hands over to the next. The answer says which one
 * found the places, so the app can credit it.
 */
export async function findPlaces(deps: Deps, center: Point, cat: CategoryQuery): Promise<{ provider: Provider; places: FoundPlace[] }> {
  const ladder = await placeLadder(deps);
  let lastError: unknown = null;
  for (const provider of ladder) {
    try {
      const places = await widen(deps, provider, center, cat);
      if (places.length) {
        const seen = new Set<string>();
        return { provider, places: places.filter((p) => (seen.has(p.ref) ? false : (seen.add(p.ref), true))) };
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return { provider: ladder.at(-1) ?? 'osm', places: [] };
}

async function widen(deps: Deps, provider: Provider, center: Point, cat: CategoryQuery): Promise<FoundPlace[]> {
  let places: FoundPlace[] = [];
  for (const radius of [700, 1500, 3000]) {
    if (provider === 'google') {
      if (!(await takeGoogle(deps.db, !cat.own && cat.google.type ? 'places_nearby' : 'places_text', 1, deps.now()))) throw new Error('Google allowance used');
      places = await searchGoogle(deps, center, radius, cat);
    } else if (provider === 'geoapify') places = await geoapifyPlaces(deps, center, radius, cat);
    else places = await searchOsm(deps, center, radius, cat);
    if (places.length >= 5) break;
  }
  return places;
}

/** Deep link that opens directions in the guest's own maps app. */
export function directionsUrl(to: Point, mode: 'walk' | 'transit' | 'cycle'): string {
  const travel = mode === 'walk' ? 'walking' : mode === 'cycle' ? 'bicycling' : 'transit';
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat.toFixed(6)},${to.lng.toFixed(6)}&travelmode=${travel}`;
}
