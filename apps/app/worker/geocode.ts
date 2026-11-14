import type { Point } from '@zorion/core';
import type { Deps } from './core';
import { isGoogleRefusal, pauseGoogle, takeGoogle } from '@zorion/server/google';
import { activeProvider } from './places';

export interface StartResult extends Point {
  label: string;
}

/** What the caller's own network says about where they are. Used only to put nearby results first. */
export interface Near {
  country?: string; // two-letter code
  lat?: number;
  lng?: number;
}

const tidy = (q: string): string => q.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

async function searchNominatim(deps: Deps, q: string, near: Near): Promise<StartResult[]> {
  const url = new URL(deps.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('q', q);
  if (near.country && /^[A-Za-z]{2}$/.test(near.country)) url.searchParams.set('countrycodes', near.country.toLowerCase());
  const res = await deps.fetch(url.toString(), {
    headers: { 'user-agent': 'Zorion/1.0 (zorion.midnightpoetry.studio)', 'accept-language': 'en' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OpenStreetMap lookup failed (${res.status})`);
  const rows = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  const out: StartResult[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !r.display_name) continue;
    out.push({ label: r.display_name.slice(0, 120), lat, lng });
  }
  return out;
}

async function searchGoogleText(deps: Deps, q: string, near: Near): Promise<StartResult[]> {
  const bias = near.lat !== undefined && near.lng !== undefined ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } } } : {};
  const res = await deps.fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': deps.env.GOOGLE_PLACES_KEY!,
      'x-goog-fieldmask': 'places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({ textQuery: q, pageSize: 5, ...(near.country ? { regionCode: near.country.toUpperCase() } : {}), ...bias }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    if (isGoogleRefusal(res.status)) await pauseGoogle(deps.db, deps.now());
    throw new Error(`Google lookup failed (${res.status})`);
  }
  const data = (await res.json()) as { places?: Array<{ displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number } }> };
  return (data.places ?? [])
    .filter((p) => p.location && (p.displayName?.text || p.formattedAddress))
    .slice(0, 5)
    .map((p) => ({ label: [p.displayName?.text, p.formattedAddress].filter(Boolean).join(', ').slice(0, 120), lat: p.location!.latitude, lng: p.location!.longitude }));
}

/**
 * Turns typed words ("Bugis MRT", a street, a postcode) into up to five places to start from.
 * The words go to the lookup service from Zorion's server, never from the person's browser,
 * so the service does not learn who asked.
 */
export async function findStart(deps: Deps, raw: string, near: Near): Promise<StartResult[]> {
  const q = tidy(raw);
  if (q.length < 3) return [];
  // Google while the month's free allowance lasts; the free OpenStreetMap lookup otherwise, or if Google fails.
  if ((await activeProvider(deps)) === 'google' && (await takeGoogle(deps.db, 'lookup', 1, deps.now()))) {
    try { return await searchGoogleText(deps, q, near); } catch { /* fall through to the free lookup */ }
  }
  return searchNominatim(deps, q, near);
}
