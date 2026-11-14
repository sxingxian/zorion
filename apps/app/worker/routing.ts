import type { Point, TravelMode } from '@zorion/core';
import { isGoogleRefusal, pauseGoogle, takeGoogle } from '@zorion/server/google';
import type { Deps } from './core';
import { setting } from './core';

export type RoutingProvider = 'estimate' | 'osrm' | 'ors' | 'google';

const routesKey = (deps: Deps): string | undefined => deps.env.GOOGLE_ROUTES_KEY || deps.env.GOOGLE_PLACES_KEY;

/**
 * Where trip times come from. The admin chooses; a choice whose key or server is missing falls back to the estimate.
 * - "estimate": worked out inside Zorion from distance. Nothing leaves Zorion.
 * - "osrm": an OSRM server on OpenStreetMap data. Free, no key. Walking and cycling.
 * - "ors": openrouteservice. Free plan with a key. Walking and cycling.
 * - "google": Google's Routes API. Paid. Walking, cycling and transit.
 * Every routed option sends starting points and places, with no names attached, to that service.
 */
export async function activeRouting(deps: Deps): Promise<RoutingProvider> {
  const chosen = await setting<string>(deps.db, 'routing_provider', 'estimate');
  if (chosen === 'google' && routesKey(deps)) return 'google';
  if (chosen === 'ors' && deps.env.ORS_API_KEY) return 'ors';
  if (chosen === 'osrm' && (deps.env.OSRM_FOOT_URL || deps.env.OSRM_BIKE_URL)) return 'osrm';
  return 'estimate';
}

/** Whether a provider can route this way of travelling at all. Only Google has timetables. */
export function canRoute(deps: Deps, provider: RoutingProvider, mode: TravelMode): boolean {
  if (provider === 'google') return true;
  if (provider === 'ors') return mode !== 'transit';
  if (provider === 'osrm') return mode === 'walk' ? !!deps.env.OSRM_FOOT_URL : mode === 'cycle' ? !!deps.env.OSRM_BIKE_URL : false;
  return false;
}

/** Travel minutes for every origin to every destination, as rows of origins. A cell is null when there is no route. Throws on failure. */
export async function routeMatrix(deps: Deps, provider: RoutingProvider, origins: readonly Point[], destinations: readonly Point[], mode: TravelMode, arriveBy: Date | null): Promise<(number | null)[][]> {
  if (!canRoute(deps, provider, mode)) throw new Error(`${provider} cannot route ${mode}`);
  if (origins.length === 0 || destinations.length === 0) return origins.map(() => destinations.map(() => null));
  if (provider === 'osrm') return osrmMatrix(deps, origins, destinations, mode);
  if (provider === 'ors') return orsMatrix(deps, origins, destinations, mode);
  // Google while the month's free allowance lasts (billed per origin–destination pair). When it runs
  // out or Google refuses, the free OpenStreetMap routing takes over where it can; otherwise this
  // throws and the caller uses Zorion's estimate.
  try {
    if (!(await takeGoogle(deps.db, 'routes', origins.length * destinations.length, deps.now()))) throw new Error('free allowance used');
    return await googleMatrix(deps, origins, destinations, mode, arriveBy);
  } catch (err) {
    if (canRoute(deps, 'osrm', mode)) return osrmMatrix(deps, origins, destinations, mode);
    throw err;
  }
}

const toMinutes = (seconds: unknown): number | null => (typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(1, Math.round(seconds / 60)) : null);
const lngLat = (p: Point): string => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

/**
 * OSRM's table service. The public servers run by FOSSGIS allow one request a second, so calls to them
 * pass through a shared gate; a call that would break the limit is skipped and the estimate is used.
 */
async function osrmMatrix(deps: Deps, origins: readonly Point[], destinations: readonly Point[], mode: TravelMode): Promise<(number | null)[][]> {
  const base = (mode === 'walk' ? deps.env.OSRM_FOOT_URL : deps.env.OSRM_BIKE_URL)!.replace(/\/+$/, '');
  if (new URL(base).hostname.endsWith('openstreetmap.de')) {
    const ok = await deps.db.query(
      `insert into throttles (key, count, window_start) values ('osrm-gate', 1, now())
       on conflict (key) do update set window_start = now() where throttles.window_start < now() - interval '1 second' returning key`,
    );
    if (ok.length === 0) throw new Error('OSRM is busy');
  }
  const all = [...origins, ...destinations];
  const sources = origins.map((_, i) => i).join(';');
  const targets = destinations.map((_, i) => origins.length + i).join(';');
  const res = await deps.fetch(`${base}/table/v1/driving/${all.map(lngLat).join(';')}?sources=${sources}&destinations=${targets}&annotations=duration`, {
    headers: { 'user-agent': 'Zorion/1.0 (zorion.midnightpoetry.studio)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OSRM failed (${res.status})`);
  const data = (await res.json()) as { code?: string; durations?: unknown[][] };
  if (data.code !== 'Ok' || !Array.isArray(data.durations) || data.durations.length !== origins.length) throw new Error('OSRM sent an unexpected answer');
  return data.durations.map((row) => destinations.map((_, d) => toMinutes(Array.isArray(row) ? row[d] : null)));
}

const ORS_PROFILE: Record<TravelMode, string> = { walk: 'foot-walking', cycle: 'cycling-regular', transit: '' };

/** openrouteservice's matrix service. One request covers a whole meetup: at most 30 people by 10 places. */
async function orsMatrix(deps: Deps, origins: readonly Point[], destinations: readonly Point[], mode: TravelMode): Promise<(number | null)[][]> {
  const res = await deps.fetch(`https://api.openrouteservice.org/v2/matrix/${ORS_PROFILE[mode]}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: deps.env.ORS_API_KEY! },
    body: JSON.stringify({
      locations: [...origins, ...destinations].map((p) => [p.lng, p.lat]),
      sources: origins.map((_, i) => i),
      destinations: destinations.map((_, i) => origins.length + i),
      metrics: ['duration'],
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`openrouteservice failed (${res.status})`);
  const data = (await res.json()) as { durations?: unknown[][] };
  if (!Array.isArray(data.durations) || data.durations.length !== origins.length) throw new Error('openrouteservice sent an unexpected answer');
  return data.durations.map((row) => destinations.map((_, d) => toMinutes(Array.isArray(row) ? row[d] : null)));
}

const GOOGLE_MODE: Record<TravelMode, string> = { walk: 'WALK', cycle: 'BICYCLE', transit: 'TRANSIT' };
const waypoint = (p: Point) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

/** Google's Routes API. */
async function googleMatrix(deps: Deps, origins: readonly Point[], destinations: readonly Point[], mode: TravelMode, arriveBy: Date | null): Promise<(number | null)[][]> {
  const out: (number | null)[][] = origins.map(() => destinations.map(() => null));
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
    if (!res.ok) {
      if (isGoogleRefusal(res.status)) await pauseGoogle(deps.db, deps.now());
      throw new Error(`Google Routes failed (${res.status})`);
    }
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
