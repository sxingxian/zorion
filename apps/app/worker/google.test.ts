import { describe, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import { billingMonth, googleUsage, takeGoogle } from '@zorion/server/google';
import type { Deps, Env } from './core';
import { findStart } from './geocode';
import { findPlaces } from './places';
import { routeMatrix } from './routing';

const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'p', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef'), ENVIRONMENT: 'development', GOOGLE_PLACES_KEY: ['AIza', 'SyTestTestTestTestTestTestTestTest'].join(''), OSRM_FOOT_URL: 'https://osrm.example/foot' };
const now = new Date('2026-11-14T04:00:00Z');
const cat = { key: 'pizza', name: 'Pizza', own: false, osm: ['["amenity"="restaurant"]["cuisine"~"pizza"]'], google: { text: 'pizza' } };

async function setup(google: (url: string) => Response) {
  const db = await testDb();
  const calls: string[] = [];
  const fetch = (async (input: string) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('googleapis.com')) return google(url);
    if (url.includes('overpass')) return Response.json({ elements: Array.from({ length: 6 }, (_, i) => ({ type: 'node', id: i + 1, lat: 1.3, lon: 103.84 + i * 0.002, tags: { name: `OSM Pizza ${i + 1}` } })) });
    if (url.includes('nominatim')) return Response.json([{ lat: '1.3', lon: '103.85', display_name: 'Bugis, Singapore' }]);
    if (url.includes('osrm.example')) return Response.json({ code: 'Ok', durations: [[600, 900]] });
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof globalThis.fetch;
  const deps = { db, env, fetch, now: () => now, outbox: [] } as unknown as Deps;
  await db.query("insert into settings (key, value) values ('places_provider', '\"google\"'), ('routing_provider', '\"google\"') on conflict (key) do update set value = excluded.value");
  return { db, deps, calls };
}
const googlePlaces = () => Response.json({ places: Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, displayName: { text: `Google Pizza ${i}` }, location: { latitude: 1.3, longitude: 103.84 + i * 0.002 } })) });

describe("Google's free allowance", () => {
  it('counts each call and stops at 90% of the free amount by default; the month runs on Pacific time', async () => {
    const db = await testDb();
    expect(billingMonth(new Date('2026-12-01T05:00:00Z'))).toBe('2026-11'); // still 30 Nov in California
    await db.query("insert into usage_counters (key, count) values ('google:places_text:2026-11', 899)");
    expect(await takeGoogle(db, 'places_text', 1, now)).toBe(true); // 900th
    expect(await takeGoogle(db, 'places_text', 1, now)).toBe(false); // would be 901st
    expect((await googleUsage(db, now)).services.find((s) => s.key === 'places_text')).toMatchObject({ used: 900, limit: 900 });
    expect(await takeGoogle(db, 'places_text', 1, new Date('2026-12-02T00:00:00Z'))).toBe(true); // a new month starts fresh
    await db.query("update settings set value = '\"paid\"' where key = 'google_budget'");
    expect(await takeGoogle(db, 'places_text', 1, now)).toBe(true); // the admin chose to keep paying
  });

  it('switches place searches to OpenStreetMap when the allowance is used up', async () => {
    const { db, deps } = await setup(googlePlaces);
    expect((await findPlaces(deps, { lat: 1.3, lng: 103.85 }, cat)).provider).toBe('google');
    await db.query("update usage_counters set count = 900 where key = 'google:places_text:2026-11'");
    const found = await findPlaces(deps, { lat: 1.3, lng: 103.85 }, cat);
    expect(found.provider).toBe('osm');
    expect(found.places[0]!.name).toContain('OSM Pizza');
  });

  it('when Google refuses, uses the free services for an hour instead of failing', async () => {
    const { db, deps, calls } = await setup(() => Response.json({ error: { message: 'quota exceeded' } }, { status: 429 }));
    expect((await findPlaces(deps, { lat: 1.3, lng: 103.85 }, cat)).provider).toBe('osm');
    expect((await googleUsage(db, now)).pausedUntil).not.toBeNull();
    const before = calls.filter((u) => u.includes('googleapis')).length;
    expect((await findStart(deps, 'Bugis MRT', {}))[0]!.label).toBe('Bugis, Singapore'); // free lookup, Google not even asked
    expect(calls.filter((u) => u.includes('googleapis')).length).toBe(before);
  });

  it('switches trip times to OpenStreetMap routing when the allowance is used up, counting origin–destination pairs', async () => {
    const { db, deps, calls } = await setup(() => Response.json([{ originIndex: 0, destinationIndex: 0, status: {}, condition: 'ROUTE_EXISTS', duration: '300s' }, { originIndex: 0, destinationIndex: 1, status: {}, condition: 'ROUTE_EXISTS', duration: '420s' }]));
    const from = [{ lat: 1.3, lng: 103.85 }];
    const to = [{ lat: 1.31, lng: 103.86 }, { lat: 1.32, lng: 103.87 }];
    expect(await routeMatrix(deps, 'google', from, to, 'walk', null)).toEqual([[5, 7]]);
    expect((await googleUsage(db, now)).services.find((s) => s.key === 'routes')!.used).toBe(2);
    await db.query("update usage_counters set count = 9000 where key = 'google:routes:2026-11'");
    expect(await routeMatrix(deps, 'google', from, to, 'walk', null)).toEqual([[10, 15]]);
    expect(calls.at(-1)).toContain('osrm.example');
    await expect(routeMatrix(deps, 'google', from, to, 'transit', null)).rejects.toThrow(); // no free transit: the caller uses the estimate
  });
});
