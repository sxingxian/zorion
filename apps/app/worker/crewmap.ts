// The crew map: where everyone starts, the middle, the places and a route line from each person.
//
// Privacy: a person's exact start goes to others only if they turned "Show me on the crew map" on.
// Otherwise others get an unnamed rough area about 1 km wide whose centre is moved by a fixed random
// offset (seeded per person, so it doesn't drift between loads and can't be averaged away), and their
// route starts at the edge of that area. The middle is only shown once three or more starts are in:
// with two, the middle and your own start would give away the other person's.
import { type Point, type TravelMode, fairMiddle, travelMinutes } from '@zorion/core';
import type { Row } from '@zorion/db';
import { isRefusal, pause, take } from '@zorion/server/usage';
import type { Deps } from './core';
import type { Loaded } from './meetups';
import { inSingaporeBounds } from './onemap';
import { routingLadder, type RoutingProvider } from './routing';

export const ROUGH_RADIUS_M = 500;
const MIN_FOR_MIDDLE = 3;
const MAX_NEW_ROUTES = 6; // per request, to keep the map quick; the rest are drawn straight until next time

type Kind = 'you' | 'shared' | 'rough';
export interface CrewPerson { id: string; kind: Kind; name: string | null; lat: number; lng: number; host: boolean }
export interface CrewRoute { id: string; kind: Kind; line: [number, number][]; source: string }

/** A point moved 250–450 m in a direction fixed by the seed. */
export function roughCentre(p: Point, seed: number): Point {
  const a = ((seed % 3600) / 3600) * Math.PI * 2;
  const d = 250 + ((Math.floor(seed / 3600) % 200) / 200) * 200;
  const dLat = (d * Math.cos(a)) / 111_320;
  const dLng = (d * Math.sin(a)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: Math.round((p.lat + dLat) * 1e4) / 1e4, lng: Math.round((p.lng + dLng) * 1e4) / 1e4 };
}

const metres = (a: Point, b: Point): number => {
  const x = ((b.lng - a.lng) * Math.PI) / 180 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.sqrt(x * x + y * y) * 6_371_000;
};

/** Drops the part of a line inside the rough area, so it starts at the area's edge. */
export function trimInside(line: [number, number][], centre: Point, radius = ROUGH_RADIUS_M): [number, number][] {
  const i = line.findIndex(([lng, lat]) => metres(centre, { lat, lng }) >= radius);
  return i <= 0 ? line : line.slice(i);
}

export function crewPeople(L: Loaded, me: Row | null): CrewPerson[] {
  const out: CrewPerson[] = [];
  for (const p of L.people) {
    if (p.lat === null || p.rsvp === 'no') continue;
    const at = { lat: Number(p.lat), lng: Number(p.lng) };
    if (me && p.id === me.id) out.push({ id: p.id, kind: 'you', name: p.name, ...at, host: !!p.is_host });
    else if (p.show_on_map) out.push({ id: p.id, kind: 'shared', name: p.name, ...at, host: !!p.is_host });
    else out.push({ id: p.id, kind: 'rough', name: null, ...roughCentre(at, Number(p.map_offset_seed)), host: !!p.is_host });
  }
  return out;
}

/** Where the routes go: the chosen place once confirmed, else the middle. */
export function destination(L: Loaded): { key: string; at: Point } | null {
  if (L.m.status === 'confirmed' && L.m.chosen_place) {
    const pl = L.places.find((p) => p.id === L.m.chosen_place);
    if (pl) return { key: `place:${pl.id}`, at: { lat: Number(pl.lat), lng: Number(pl.lng) } };
  }
  const mid = middleOf(L);
  return mid ? { key: 'middle', at: mid } : null;
}
export function middleOf(L: Loaded): Point | null {
  const starts = L.people.filter((p) => p.lat !== null && p.rsvp !== 'no');
  if (starts.length < MIN_FOR_MIDDLE) return null;
  if (L.m.middle_lat !== null) return { lat: Number(L.m.middle_lat), lng: Number(L.m.middle_lng) };
  return fairMiddle(starts.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })));
}

/** Route lines for everyone, from the cache or freshly drawn. Each person is routed from where others may see them start. */
export async function crewRoutes(deps: Deps, L: Loaded, people: CrewPerson[], dest: { key: string; at: Point } | null): Promise<CrewRoute[]> {
  if (!dest) return [];
  const real = new Map(L.people.map((p) => [p.id, p]));
  const cached = await deps.db.query('select participant_id, start_key, line, source from route_lines where dest = $1 and participant_id = any($2::uuid[])', [dest.key, people.map((p) => p.id)]);
  const byId = new Map(cached.map((r) => [r.participant_id as string, r]));
  const ladder = (await routingLadder(deps, L.m.travel_mode)).filter((p) => p !== 'google');
  const out: CrewRoute[] = [];
  let fresh = 0;
  for (const person of people) {
    const p = real.get(person.id)!;
    // Routed from the exact start only for the person themselves or someone who shares their pin.
    const from = person.kind === 'rough' ? { lat: person.lat, lng: person.lng } : { lat: Number(p.lat), lng: Number(p.lng) };
    const startKey = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${dest.at.lat.toFixed(5)},${dest.at.lng.toFixed(5)}`;
    const hit = byId.get(person.id);
    let line: [number, number][] | null = hit && hit.start_key === startKey ? (hit.line as [number, number][]) : null;
    let source = hit && line ? String(hit.source) : 'straight';
    if (!line && ladder.length && fresh < MAX_NEW_ROUTES) {
      fresh++;
      const drawn = await drawRoute(deps, ladder, from, dest.at, L.m.travel_mode);
      if (drawn) {
        ({ line, source } = drawn);
        await deps.db.query(
          `insert into route_lines (participant_id, dest, start_key, line, source) values ($1, $2, $3, $4, $5)
           on conflict (participant_id, dest) do update set start_key = excluded.start_key, line = excluded.line, source = excluded.source, created_at = now()`,
          [person.id, dest.key, startKey, JSON.stringify(line), source],
        );
      }
    }
    if (!line) line = [[from.lng, from.lat], [dest.at.lng, dest.at.lat]];
    if (person.kind === 'rough') line = trimInside(line, from);
    out.push({ id: person.id, kind: person.kind, line, source });
  }
  return out;
}

/** One route line from the first service that answers. Null: draw it straight. */
export async function drawRoute(deps: Deps, ladder: readonly RoutingProvider[], from: Point, to: Point, mode: TravelMode): Promise<{ line: [number, number][]; source: string } | null> {
  for (const provider of ladder) {
    try {
      const line = await routeLine(deps, provider, from, to, mode);
      if (line && line.length >= 2) return { line: simplify(line), source: provider };
    } catch {
      // next service
    }
  }
  return null;
}

/** Keeps the line light: at most about 120 points, rounded to about a metre. */
function simplify(line: [number, number][]): [number, number][] {
  const step = Math.max(1, Math.ceil(line.length / 120));
  const kept = line.filter((_, i) => i % step === 0 || i === line.length - 1);
  return kept.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
}

const UA = { 'user-agent': 'Zorion/1.0 (zorion.midnightpoetry.studio)' };
async function routeLine(deps: Deps, provider: RoutingProvider, from: Point, to: Point, mode: TravelMode): Promise<[number, number][] | null> {
  const env = deps.env;
  const timeout = AbortSignal.timeout(8000);
  if (provider === 'osrm') {
    if (mode === 'transit') return null;
    const base = (mode === 'walk' ? env.OSRM_FOOT_URL : env.OSRM_BIKE_URL)?.replace(/\/+$/, '');
    if (!base) return null;
    if (new URL(base).hostname.endsWith('openstreetmap.de')) {
      const ok = await deps.db.query(`insert into throttles (key, count, window_start) values ('osrm-gate', 1, now()) on conflict (key) do update set window_start = now() where throttles.window_start < now() - interval '1 second' returning key`);
      if (ok.length === 0) return null;
    }
    const res = await deps.fetch(`${base}/route/v1/driving/${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}?overview=simplified&geometries=geojson`, { headers: UA, signal: timeout });
    if (!res.ok) return null;
    const data = (await res.json()) as { routes?: Array<{ geometry?: { coordinates?: [number, number][] } }> };
    return data.routes?.[0]?.geometry?.coordinates ?? null;
  }
  if (provider === 'ors') {
    if (mode === 'transit' || !env.ORS_API_KEY) return null;
    if (!(await take(deps.db, 'ors_directions', 1, deps.now()))) return null;
    const res = await deps.fetch(`https://api.openrouteservice.org/v2/directions/${mode === 'walk' ? 'foot-walking' : 'cycling-regular'}/geojson`, {
      method: 'POST', headers: { authorization: env.ORS_API_KEY, 'content-type': 'application/json' }, signal: timeout,
      body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
    });
    if (!res.ok) { if (isRefusal(res.status)) await pause(deps.db, 'ors', deps.now()); return null; }
    const data = (await res.json()) as { features?: Array<{ geometry?: { coordinates?: [number, number][] } }> };
    return data.features?.[0]?.geometry?.coordinates ?? null;
  }
  if (provider === 'geoapify') {
    if (mode === 'transit' || !env.GEOAPIFY_KEY) return null;
    if (!(await take(deps.db, 'geoapify', 1, deps.now()))) return null;
    const res = await deps.fetch(`https://api.geoapify.com/v1/routing?waypoints=${from.lat},${from.lng}|${to.lat},${to.lng}&mode=${mode === 'walk' ? 'walk' : 'bicycle'}&apiKey=${encodeURIComponent(env.GEOAPIFY_KEY)}`, { signal: timeout });
    if (!res.ok) { if (isRefusal(res.status)) await pause(deps.db, 'geoapify', deps.now()); return null; }
    const data = (await res.json()) as { features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }> };
    const g = data.features?.[0]?.geometry;
    if (!g) return null;
    return (g.type === 'MultiLineString' ? (g.coordinates as [number, number][][]).flat() : (g.coordinates as [number, number][])) ?? null;
  }
  if (provider === 'onemap') {
    if (!inSingaporeBounds(from) || !inSingaporeBounds(to)) return null;
    const { onemapRouteLine } = await import('./onemap');
    return onemapRouteLine(deps, from, to, mode);
  }
  return null;
}

/** Trip minutes from you to each place, by estimate when nothing better is known. */
export const estimateMinutes = (from: Point, to: Point, mode: TravelMode) => travelMinutes(from, to, mode);

/** Everything the map needs, for one viewer. `places` is what this viewer may see. */
export async function mapView(deps: Deps, L: Loaded, me: Row | null, places: Row[]) {
  const people = crewPeople(L, me);
  const dest = destination(L);
  const routes = await crewRoutes(deps, L, people, dest);
  const centre = dest?.at ?? (me && me.lat !== null ? { lat: Number(me.lat), lng: Number(me.lng) } : people[0] ? { lat: people[0].lat, lng: people[0].lng } : null);
  // Your own marker is your pig: the host's chosen pig, or the plain pig for a guest (guests have no account).
  const avatar = me?.is_host ? String((await deps.db.query('select avatar from users where id = $1', [L.m.host_id]))[0]?.avatar ?? 'chef') : 'plain';
  const icon = L.m.winning_category ? (L.cats.find((cat) => cat.key === L.m.winning_category)?.icon as string | undefined) ?? null : null;
  return {
    avatar,
    icon, // the winning food option's icon, shown on the pin where you're meeting
    people: people.map(({ id, kind, name, lat, lng, host }) => ({ id, kind, name, lat, lng, host })),
    middle: middleOf(L),
    places: places.map((p, i) => ({ id: p.id, n: i + 1, name: p.name, lat: Number(p.lat), lng: Number(p.lng), chosen: p.id === L.m.chosen_place })),
    dest: dest ? { kind: dest.key === 'middle' ? 'middle' : 'place', ...dest.at } : null,
    routes,
    centre,
    roughRadius: ROUGH_RADIUS_M,
    singapore: centre ? inSingaporeBounds(centre) : false,
  };
}
