import { describe, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import { take, usageReport } from '@zorion/server/usage';
import type { Deps, Env } from './core';
import { findStart } from './geocode';
import { matrixCredits } from './geoapify';
import { forgetOneMapToken } from './onemap';
import { findPlaces } from './places';
import { routeWithLadder, routingLadder } from './routing';
import { searchCountry } from './meetups';

const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'p', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef'), ENVIRONMENT: 'development', GEOAPIFY_KEY: 'geo-key', ONEMAP_EMAIL: 'ops@example.sg', ONEMAP_PASSWORD: 'pw', OSRM_FOOT_URL: 'https://osrm.example/foot' };
const now = new Date('2026-11-14T04:00:00Z');
const pizza = { key: 'pizza', name: 'Pizza', own: false, osm: ['["amenity"="restaurant"]["cuisine"~"pizza",i]'], google: { text: 'pizza' } };

interface Call { url: string; init?: RequestInit }
async function setup(overrides: Partial<Record<'geoapify' | 'onemap' | 'token', (url: string) => Response>> = {}) {
  forgetOneMapToken();
  const db = await testDb();
  const calls: Call[] = [];
  const fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('onemap.gov.sg/api/auth')) return overrides.token?.(url) ?? Response.json({ access_token: 'om-token', expiry_timestamp: String(now.getTime() / 1000 + 3 * 86400) });
    if (url.includes('onemap.gov.sg')) {
      if (overrides.onemap) return overrides.onemap(url);
      if (url.includes('/elastic/search')) return Response.json({ results: [{ SEARCHVAL: 'BUGIS MRT STATION', ADDRESS: '200 VICTORIA STREET', LATITUDE: '1.3009', LONGITUDE: '103.8559' }, { SEARCHVAL: 'X', LATITUDE: 'bad', LONGITUDE: '1' }] });
      const u = new URL(url);
      if (u.searchParams.get('routeType') === 'pt') return Response.json({ plan: { itineraries: [{ duration: 1500 }] } });
      return Response.json({ route_summary: { total_time: 600 } });
    }
    if (url.includes('api.geoapify.com')) {
      if (overrides.geoapify) return overrides.geoapify(url);
      if (url.includes('/v2/places')) return Response.json({ features: [
        ...Array.from({ length: 5 }, (_, i) => ({ properties: { place_id: `p${i}`, name: `Geo Pizza ${i}`, lat: 1.3, lon: 103.84 + i * 0.002, address_line2: 'Somewhere, Singapore', datasource: { raw: { amenity: 'restaurant', cuisine: 'Pizza' } } } })),
        { properties: { place_id: 'sushi', name: 'Geo Sushi', lat: 1.3, lon: 103.85, datasource: { raw: { amenity: 'restaurant', cuisine: 'sushi' } } } },
      ] });
      if (url.includes('/v1/geocode')) return Response.json({ results: [{ formatted: 'Bugis, Singapore', lat: 1.3, lon: 103.85 }] });
      if (url.includes('/v1/routematrix')) return Response.json({ sources_to_targets: [[{ time: 300 }, { time: null }]] });
    }
    if (url.includes('overpass')) return Response.json({ elements: Array.from({ length: 6 }, (_, i) => ({ type: 'node', id: i + 1, lat: 1.3, lon: 103.84 + i * 0.002, tags: { name: `OSM Pizza ${i + 1}` } })) });
    if (url.includes('nominatim')) return Response.json([{ lat: '1.3', lon: '103.85', display_name: 'Bugis (OSM), Singapore' }]);
    if (url.includes('osrm.example')) return Response.json({ code: 'Ok', durations: [[600, 900]] });
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof globalThis.fetch;
  const deps = { db, env, fetch, now: () => now, outbox: [] } as unknown as Deps;
  return { db, deps, calls };
}
const from = [{ lat: 1.3, lng: 103.85 }];
const to = [{ lat: 1.31, lng: 103.86 }, { lat: 1.32, lng: 103.87 }];

describe('Geoapify', () => {
  it("finds places with the category's own OpenStreetMap filters, and says it found them", async () => {
    const { db, deps, calls } = await setup();
    await db.query("insert into settings (key, value) values ('places_provider', '\"geoapify\"') on conflict (key) do update set value = excluded.value");
    const found = await findPlaces(deps, { lat: 1.3, lng: 103.85 }, pizza);
    expect(found.provider).toBe('geoapify');
    expect(found.places.map((p) => p.name)).toEqual(['Geo Pizza 0', 'Geo Pizza 1', 'Geo Pizza 2', 'Geo Pizza 3', 'Geo Pizza 4']); // the sushi bar is left out
    const sent = new URL(calls[0]!.url);
    expect(sent.searchParams.get('categories')).toBe('catering.restaurant');
    expect(sent.searchParams.get('filter')).toBe('circle:103.850000,1.300000,700'); // longitude first
    expect((await usageReport(db, now)).services.find((s) => s.key === 'geoapify')!.used).toBe(3); // 60 places = 3 credits
  });

  it('hands over to OpenStreetMap when the day\'s credits are used up, or Geoapify refuses', async () => {
    const { db, deps } = await setup();
    await db.query("insert into settings (key, value) values ('places_provider', '\"geoapify\"') on conflict (key) do update set value = excluded.value");
    await db.query("insert into usage_counters (key, count) values ('free:geoapify:2026-11-14', 2999)");
    expect((await findPlaces(deps, { lat: 1.3, lng: 103.85 }, pizza)).provider).toBe('osm');

    const refused = await setup({ geoapify: () => new Response('no', { status: 429 }) });
    await refused.db.query("insert into settings (key, value) values ('places_provider', '\"geoapify\"') on conflict (key) do update set value = excluded.value");
    expect((await findPlaces(refused.deps, { lat: 1.3, lng: 103.85 }, pizza)).provider).toBe('osm');
    expect((await usageReport(refused.db, now)).paused.geoapify).not.toBeNull(); // rested for an hour
  });

  it('counts route table credits the way Geoapify does', () => {
    expect(matrixCredits(2, 10)).toBe(20);
    expect(matrixCredits(6, 30)).toBe(180);
    expect(matrixCredits(30, 30)).toBe(300);
  });
});

describe('OneMap', () => {
  it('looks up Singapore starting places first, and says so', async () => {
    const { deps, calls } = await setup();
    const found = await findStart(deps, 'Bugis MRT', { country: 'SG' });
    expect(found).toEqual({ source: 'onemap', results: [{ label: 'BUGIS MRT STATION, 200 VICTORIA STREET', lat: 1.3009, lng: 103.8559 }] });
    expect(calls).toHaveLength(1);
  });

  it('is skipped outside Singapore; Geoapify answers there', async () => {
    const { deps, calls } = await setup();
    expect((await findStart(deps, 'KLCC', { country: 'MY' })).source).toBe('geoapify');
    expect(calls.some((c) => c.url.includes('onemap'))).toBe(false);
    expect(new URL(calls[0]!.url).searchParams.get('filter')).toBe('countrycode:my');
  });

  it('gives public transport times, signing in once and sending only positions', async () => {
    const { db, deps, calls } = await setup();
    await db.query("insert into settings (key, value) values ('routing_provider', '\"onemap\"') on conflict (key) do update set value = excluded.value");
    expect(await routingLadder(deps, 'transit')).toEqual(['onemap']);
    const r = await routeWithLadder(deps, ['onemap'], from, to, 'transit', new Date('2026-12-01T12:00:00Z'));
    expect(r).toEqual({ matrix: [[25, 25]], source: 'onemap' });
    expect(calls.filter((c) => c.url.includes('getToken'))).toHaveLength(1);
    const route = new URL(calls.find((c) => c.url.includes('routingsvc'))!.url);
    expect(route.searchParams.get('routeType')).toBe('pt');
    expect(route.searchParams.get('date')).toBe('12-01-2026');
    expect(route.searchParams.get('time')).toBe('20:00:00'); // Singapore time
    expect(route.searchParams.get('start')).toBe('1.3,103.85');
    expect((calls.find((c) => c.url.includes('routingsvc'))!.init!.headers as Record<string, string>).authorization).toBe('om-token');
    await routeWithLadder(deps, ['onemap'], from, to, 'transit', null);
    expect(calls.filter((c) => c.url.includes('getToken'))).toHaveLength(1); // the token is kept
  });

  it('when the sign-in fails, walking times come from the next free service', async () => {
    const { db, deps } = await setup({ token: () => Response.json({ error: 'bad' }, { status: 401 }) });
    await db.query("insert into settings (key, value) values ('routing_provider', '\"onemap\"') on conflict (key) do update set value = excluded.value");
    const ladder = await routingLadder(deps, 'walk');
    expect(ladder).toEqual(['onemap', 'geoapify', 'osrm']);
    expect((await routeWithLadder(deps, ladder, from, to, 'walk', null)).source).toBe('geoapify');
    expect((await usageReport(db, now)).paused.onemap).not.toBeNull();
  });
});

describe('overseas', () => {
  it('the meetup decides which country to search, not where the person is', () => {
    expect(searchCountry('Asia/Singapore', 'MY')).toBe('SG'); // a guest in Malaysia joining a Singapore meetup still gets OneMap
    expect(searchCountry('Asia/Bangkok', 'SG')).toBeUndefined(); // someone in Singapore planning a Bangkok meetup isn't held to Singapore
    expect(searchCountry('Asia/Kuala_Lumpur', 'MY')).toBe('MY');
    expect(searchCountry('Europe/London', 'XX')).toBeUndefined();
  });

  it('a meetup outside Singapore never asks OneMap for trip times: the next service answers straight away', async () => {
    const { db, deps, calls } = await setup();
    await db.query("insert into settings (key, value) values ('routing_provider', '\"onemap\"') on conflict (key) do update set value = excluded.value");
    const kl = [{ lat: 3.139, lng: 101.687 }];
    const klPlaces = [{ lat: 3.15, lng: 101.71 }, { lat: 3.16, lng: 101.72 }];
    const r = await routeWithLadder(deps, await routingLadder(deps, 'walk'), kl, klPlaces, 'walk', null);
    expect(r.source).toBe('geoapify');
    expect(calls.some((c) => c.url.includes('onemap'))).toBe(false); // not even a sign-in
    await expect(routeWithLadder(deps, await routingLadder(deps, 'transit'), kl, klPlaces, 'transit', null)).rejects.toThrow(); // transit: Zorion's estimate
    expect(calls.some((c) => c.url.includes('onemap'))).toBe(false);
  });

  it('a lookup outside Singapore skips OneMap', async () => {
    const { deps, calls } = await setup();
    expect((await findStart(deps, 'Petronas Towers', { lat: 3.139, lng: 101.687 })).source).toBe('geoapify');
    expect(calls.some((c) => c.url.includes('onemap'))).toBe(false);
  });
});

describe('usage', () => {
  it('free services count by the day, and a new day starts fresh', async () => {
    const db = await testDb();
    await db.query("insert into usage_counters (key, count) values ('free:geoapify:2026-11-14', 2990)");
    expect(await take(db, 'geoapify', 10, now)).toBe(true);
    expect(await take(db, 'geoapify', 1, now)).toBe(false);
    expect(await take(db, 'geoapify', 1, new Date('2026-11-15T00:00:01Z'))).toBe(true);
  });
});
