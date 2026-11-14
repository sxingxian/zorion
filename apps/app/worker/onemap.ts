// OneMap, by the Singapore Land Authority: free Singapore address search, and routing for walking,
// cycling and public transport. Routing needs an account; a token lasts three days and is kept in
// memory per Worker instance. OneMap routes one trip per request, so Zorion keeps the number small.
import type { Point, TravelMode } from '@zorion/core';
import { isRefusal, isPaused, pause } from '@zorion/server/usage';
import type { Deps } from './core';
import type { StartResult } from './geocode';

const BASE = 'https://www.onemap.gov.sg';
export const ONEMAP_MAX_PAIRS = 60; // per meetup: enough for 6 people by 10 places
/** Singapore, with a little sea around it. OneMap has no data outside. */
export const inSingaporeBounds = (p: Point) => p.lat >= 1.13 && p.lat <= 1.5 && p.lng >= 103.55 && p.lng <= 104.13;
const tokens = new Map<string, { token: string; expires: number }>();

async function token(deps: Deps): Promise<string> {
  const email = deps.env.ONEMAP_EMAIL!;
  const cached = tokens.get(email);
  if (cached && cached.expires > Date.now() + 10 * 60_000) return cached.token;
  const res = await deps.fetch(`${BASE}/api/auth/post/getToken`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: deps.env.ONEMAP_PASSWORD }), signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expiry_timestamp?: string | number; error?: string };
  if (!res.ok || !data.access_token) {
    if (isRefusal(res.status) || res.status === 400) await pause(deps.db, 'onemap', deps.now());
    throw new Error(`OneMap sign-in failed (${res.status})`);
  }
  tokens.set(email, { token: data.access_token, expires: Number(data.expiry_timestamp) * 1000 || Date.now() + 2 * 86_400_000 });
  return data.access_token;
}
export const forgetOneMapToken = () => tokens.clear();

export async function onemapLookup(deps: Deps, q: string): Promise<StartResult[]> {
  if (await isPaused(deps.db, 'onemap', deps.now())) throw new Error('OneMap paused');
  const params = new URLSearchParams({ searchVal: q, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: '1' });
  const res = await deps.fetch(`${BASE}/api/common/elastic/search?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    if (isRefusal(res.status)) await pause(deps.db, 'onemap', deps.now());
    throw new Error(`OneMap search failed (${res.status})`);
  }
  const data = (await res.json()) as { results?: Array<{ SEARCHVAL?: string; ADDRESS?: string; LATITUDE?: string; LONGITUDE?: string }> };
  const out: StartResult[] = [];
  for (const r of data.results ?? []) {
    const lat = Number(r.LATITUDE);
    const lng = Number(r.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label = [r.SEARCHVAL, r.ADDRESS && r.ADDRESS !== r.SEARCHVAL ? r.ADDRESS : null].filter(Boolean).join(', ');
    if (label) out.push({ label: label.slice(0, 120), lat, lng });
    if (out.length === 5) break;
  }
  return out;
}

const ROUTE: Record<TravelMode, string> = { walk: 'walk', cycle: 'cycle', transit: 'pt' };
/** "MM-DD-YYYY" and "HH:MM:SS" in Singapore time, as OneMap's public transport routing expects. */
function sgDateTime(at: Date): { date: string; time: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.month}-${p.day}-${p.year}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

export async function onemapMatrix(deps: Deps, origins: readonly Point[], destinations: readonly Point[], mode: TravelMode, at: Date | null): Promise<(number | null)[][]> {
  // Outside Singapore, hand over at once rather than asking OneMap for trips it can't route.
  if (![...origins, ...destinations].every(inSingaporeBounds)) throw new Error('outside Singapore');
  if (origins.length * destinations.length > ONEMAP_MAX_PAIRS) throw new Error('too many pairs for OneMap');
  if (await isPaused(deps.db, 'onemap', deps.now())) throw new Error('OneMap paused');
  const auth = await token(deps);
  const when = sgDateTime(at && at.getTime() > deps.now().getTime() ? at : deps.now());
  const pairs = origins.flatMap((o, i) => destinations.map((d, j) => ({ o, d, i, j })));
  const out: (number | null)[][] = origins.map(() => destinations.map(() => null));
  let failures = 0;
  // A few at a time, to stay friendly to a free public service.
  for (let k = 0; k < pairs.length; k += 6) {
    await Promise.all(pairs.slice(k, k + 6).map(async ({ o, d, i, j }) => {
      const params = new URLSearchParams({ start: `${o.lat},${o.lng}`, end: `${d.lat},${d.lng}`, routeType: ROUTE[mode] });
      if (mode === 'transit') { params.set('date', when.date); params.set('time', when.time); params.set('mode', 'TRANSIT'); params.set('maxWalkDistance', '1000'); params.set('numItineraries', '1'); }
      try {
        const res = await deps.fetch(`${BASE}/api/public/routingsvc/route?${params}`, { headers: { authorization: auth }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) {
          if (res.status === 401) forgetOneMapToken();
          if (isRefusal(res.status)) await pause(deps.db, 'onemap', deps.now());
          failures++;
          return;
        }
        const data = (await res.json()) as { route_summary?: { total_time?: number }; plan?: { itineraries?: Array<{ duration?: number }> } };
        const seconds = mode === 'transit' ? data.plan?.itineraries?.[0]?.duration : data.route_summary?.total_time;
        if (typeof seconds === 'number' && Number.isFinite(seconds)) out[i]![j] = Math.max(1, Math.round(seconds / 60));
      } catch { failures++; }
    }));
    if (failures > pairs.length / 2) throw new Error('OneMap routing failed');
  }
  if (failures > pairs.length / 2) throw new Error('OneMap routing failed');
  return out;
}

/** Google's encoded polyline (precision 5), as OneMap returns route shapes. Gives [lng, lat] pairs. */
export function decodePolyline(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < s.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i <= s.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

/** The shape of one trip, for the crew map. Null when OneMap can't route it. */
export async function onemapRouteLine(deps: Deps, from: Point, to: Point, mode: TravelMode): Promise<[number, number][] | null> {
  if (!deps.env.ONEMAP_EMAIL || !deps.env.ONEMAP_PASSWORD) return null;
  if (await isPaused(deps.db, 'onemap', deps.now())) return null;
  const auth = await token(deps);
  const params = new URLSearchParams({ start: `${from.lat},${from.lng}`, end: `${to.lat},${to.lng}`, routeType: ROUTE[mode] });
  if (mode === 'transit') {
    const when = sgDateTime(deps.now());
    params.set('date', when.date); params.set('time', when.time); params.set('mode', 'TRANSIT'); params.set('maxWalkDistance', '1000'); params.set('numItineraries', '1');
  }
  const res = await deps.fetch(`${BASE}/api/public/routingsvc/route?${params}`, { headers: { authorization: auth }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    if (res.status === 401) forgetOneMapToken();
    if (isRefusal(res.status)) await pause(deps.db, 'onemap', deps.now());
    return null;
  }
  const data = (await res.json()) as { route_geometry?: string; plan?: { itineraries?: Array<{ legs?: Array<{ legGeometry?: { points?: string } }> }> } };
  if (mode !== 'transit' && data.route_geometry) return decodePolyline(data.route_geometry);
  const legs = data.plan?.itineraries?.[0]?.legs ?? [];
  const line = legs.flatMap((l) => (l.legGeometry?.points ? decodePolyline(l.legGeometry.points) : []));
  return line.length >= 2 ? line : null;
}
