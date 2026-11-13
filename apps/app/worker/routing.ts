import type { Point, TravelMode } from '@zorion/core';
import type { Deps } from './core';
import { setting } from './core';

export type RoutingProvider = 'estimate' | 'google';

const routesKey = (deps: Deps): string | undefined => deps.env.GOOGLE_ROUTES_KEY || deps.env.GOOGLE_PLACES_KEY;

/**
 * "estimate" keeps every position inside Zorion. "google" sends starting points and places,
 * with no names attached, to Google's Routes API. The admin chooses; Google also needs a key.
 */
export async function activeRouting(deps: Deps): Promise<RoutingProvider> {
  const chosen = await setting<string>(deps.db, 'routing_provider', 'estimate');
  return chosen === 'google' && routesKey(deps) ? 'google' : 'estimate';
}

const GOOGLE_MODE: Record<TravelMode, string> = { walk: 'WALK', cycle: 'BICYCLE', transit: 'TRANSIT' };
const waypoint = (p: Point) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

/**
 * Travel minutes for every origin to every destination, as rows of origins.
 * A cell is null when no route exists. Throws when the service fails, so the caller can fall back.
 */
export async function routeMatrix(deps: Deps, origins: readonly Point[], destinations: readonly Point[], mode: TravelMode, arriveBy: Date | null): Promise<(number | null)[][]> {
  const out: (number | null)[][] = origins.map(() => destinations.map(() => null));
  if (origins.length === 0 || destinations.length === 0) return out;
  // Google allows 100 origin-destination pairs per request on transit and 625 otherwise.
  const perRequest = Math.max(1, Math.floor((mode === 'transit' ? 100 : 625) / destinations.length));
  const future = arriveBy && arriveBy.getTime() > deps.now().getTime() + 5 * 60_000 ? arriveBy : null;
  for (let start = 0; start < origins.length; start += perRequest) {
    const chunk = origins.slice(start, start + perRequest);
    const res = await deps.fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': routesKey(deps)!,
        'x-goog-fieldmask': 'originIndex,destinationIndex,status,condition,duration',
      },
      body: JSON.stringify({
        origins: chunk.map(waypoint),
        destinations: destinations.map(waypoint),
        travelMode: GOOGLE_MODE[mode],
        // Transit depends on the timetable, so ask for arrival at the meetup time when it is still ahead.
        ...(mode === 'transit' && future ? { arrivalTime: future.toISOString() } : {}),
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Google Routes failed (${res.status})`);
    const rows = (await res.json()) as Array<{ originIndex?: number; destinationIndex?: number; status?: { code?: number }; condition?: string; duration?: string }>;
    if (!Array.isArray(rows)) throw new Error('Google Routes sent an unexpected answer');
    for (const el of rows) {
      const o = start + (el.originIndex ?? 0);
      const d = el.destinationIndex ?? 0;
      const seconds = typeof el.duration === 'string' ? Number.parseFloat(el.duration) : Number.NaN;
      if (out[o] === undefined || d >= destinations.length) continue;
      if ((el.status?.code ?? 0) !== 0 || el.condition !== 'ROUTE_EXISTS' || !Number.isFinite(seconds)) continue;
      out[o]![d] = Math.max(1, Math.round(seconds / 60));
    }
  }
  return out;
}
