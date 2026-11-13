import { beforeAll, describe, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import type { Deps, Env } from './core';
import { createApp } from './index';

const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'test-pepper', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef'), ENVIRONMENT: 'development', GOOGLE_PLACES_KEY: 'test-key' };

function browser(app: ReturnType<typeof createApp>, ip = '198.51.100.1') {
  const jar = new Map<string, string>();
  return async (method: string, path: string, json?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-zorion': '1', origin: env.APP_ORIGIN, 'cf-connecting-ip': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [k, v] = pair!.split('=');
      if (v) jar.set(k!, v);
      else jar.delete(k!);
    }
    return { status: res.status, body: (await res.json()) as any };
  };
}

// Outside services, faked. `calls` records what Zorion sent them.
const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
let routesDown = false;
const fakeFetch = (async (input: string, init?: RequestInit) => {
  const url = String(input);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body;
  calls.push({ url, body, headers });
  if (url.includes('overpass')) {
    // Eight places heading east. By straight line, "Place 1" is nearest to everyone.
    return Response.json({ elements: Array.from({ length: 8 }, (_, i) => ({ type: 'node', id: i + 1, lat: 1.3, lon: 103.85 + i * 0.001, tags: { name: `Place ${i + 1}` } })) });
  }
  if (url.includes('nominatim')) {
    return Response.json([{ lat: '1.3009', lon: '103.8559', display_name: 'Bugis MRT Station, Singapore' }, { lat: 'oops', lon: '1', display_name: 'Broken row' }]);
  }
  if (url.includes('routes.googleapis.com')) {
    if (routesDown) return new Response('no', { status: 503 });
    // Routed, the order flips: the further east a place is, the quicker it is to reach. One pair has no route.
    const out = [];
    for (let o = 0; o < body.origins.length; o++) for (let d = 0; d < body.destinations.length; d++) {
      if (o === 0 && d === 0) out.push({ originIndex: o, destinationIndex: d, status: {}, condition: 'ROUTE_NOT_FOUND' });
      else out.push({ originIndex: o, destinationIndex: d, status: {}, condition: 'ROUTE_EXISTS', duration: `${(30 - d * 2 + o) * 60}s` });
    }
    return Response.json(out);
  }
  throw new Error(`unexpected fetch ${url}`);
}) as unknown as typeof fetch;

let deps: Partial<Deps>;
let app: ReturnType<typeof createApp>;
let h: ReturnType<typeof browser>;
let guest: ReturnType<typeof browser>;
let id = '';
let token = '';

async function newMeetup(name: string) {
  const made = await h('POST', '/api/meetups', { name, timeZone: 'Asia/Singapore', startsAt: '2026-12-01T12:00:00.000Z', invitees: ['Priya'], ballot: [{ key: 'pizza' }] });
  id = made.body.meetup.id;
  token = made.body.meetup.link.split('/j/')[1];
  await h('POST', `/api/meetups/${id}/share`, {});
  guest = browser(app, '198.51.100.2');
  const view = (await guest('GET', `/api/g/${token}`)).body.meetup;
  await guest('POST', `/api/g/${token}/join`, { participantId: view.people.find((x: any) => x.name === 'Priya').id });
  await guest('POST', `/api/g/${token}/rsvp`, { rsvp: 'going' });
}

beforeAll(async () => {
  deps = { db: await testDb(), env, fetch: fakeFetch, now: () => new Date('2026-11-13T04:00:00Z'), outbox: [] };
  app = createApp(deps);
  h = browser(app);
  await h('POST', '/api/auth/email-code', { email: 'maya@example.com' });
  await h('POST', '/api/auth/email-code/verify', { email: 'maya@example.com', code: deps.outbox!.at(-1)!.text.match(/\d{6}/)![0] });
});

describe('typing a starting place', () => {
  it('needs to know who is asking', async () => {
    await newMeetup('Typed start');
    expect((await browser(app)('POST', `/api/g/${token}/start-search`, { q: 'Bugis MRT' })).status).toBe(401);
    expect((await browser(app)('POST', `/api/meetups/${id}/start-search`, { q: 'Bugis MRT' })).status).toBe(401);
  });

  it('returns matches for a guest and for the host, and drops rows that are not places', async () => {
    const found = await guest('POST', `/api/g/${token}/start-search`, { q: '  Bugis   MRT ' });
    expect(found.body.results).toEqual([{ label: 'Bugis MRT Station, Singapore', lat: 1.3009, lng: 103.8559 }]);
    const sent = calls.at(-1)!;
    expect(new URL(sent.url).searchParams.get('q')).toBe('Bugis MRT');
    expect(sent.headers.cookie).toBeUndefined(); // nothing about the person goes along
    expect((await h('POST', `/api/meetups/${id}/start-search`, { q: 'Bugis MRT' })).body.results).toHaveLength(1);
    expect((await guest('POST', `/api/g/${token}/start-search`, { q: 'ab' })).status).toBe(422);
  });

  it('saves the chosen match as the start', async () => {
    const pick = (await guest('POST', `/api/g/${token}/start-search`, { q: 'Bugis MRT' })).body.results[0];
    const saved = await guest('POST', `/api/g/${token}/location`, { lat: pick.lat, lng: pick.lng });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain('103.8559'); // a start is never echoed back
  });

  it('pauses lookups from one network after 15 in ten minutes', async () => {
    await (deps.db as any).query('delete from throttles');
    const statuses = [];
    for (let i = 0; i < 16; i++) statuses.push((await guest('POST', `/api/g/${token}/start-search`, { q: 'Bugis MRT' })).status);
    expect(statuses.slice(0, 15).every((s) => s === 200)).toBe(true);
    expect(statuses[15]).toBe(429);
    await (deps.db as any).query('delete from throttles');
  });
});

describe('routed travel times', () => {
  it('uses the estimate, and calls no routing service, unless an admin switches routing on', async () => {
    await h('POST', `/api/meetups/${id}/location`, { lat: 1.3, lng: 103.84 });
    calls.length = 0;
    const r = await h('POST', `/api/meetups/${id}/middle`, {});
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.url.includes('routes.googleapis.com'))).toBe(false);
    expect(r.body.meetup.places.every((p: any) => p.routed === false)).toBe(true);
    expect(r.body.meetup.places[0].name).toBe('Place 1');
  });

  it('reorders places by routed time when routing is on', async () => {
    await (deps.db as any).query(`update settings set value = '"google"' where key = 'routing_provider'`);
    await newMeetup('Routed');
    await guest('POST', `/api/g/${token}/location`, { lat: 1.3, lng: 103.86 });
    await h('POST', `/api/meetups/${id}/location`, { lat: 1.3, lng: 103.84 });
    calls.length = 0;
    const r = await h('POST', `/api/meetups/${id}/middle`, {});
    expect(r.status).toBe(200);
    const sent = calls.find((c) => c.url.includes('routes.googleapis.com'))!;
    expect(sent.body.travelMode).toBe('WALK');
    expect(sent.body.origins).toHaveLength(2);
    expect(sent.body.destinations).toHaveLength(8);
    expect(sent.headers['x-goog-api-key']).toBe('test-key');
    expect(JSON.stringify(sent.body)).not.toMatch(/Priya|maya/); // positions only, no names
    const places = r.body.meetup.places;
    expect(places.every((p: any) => p.routed)).toBe(true);
    expect(places[0].name).toBe('Place 8'); // quickest by route, though furthest by straight line
    expect(places[0].longest).toBe(17); // 30 - 7*2 + 1, the slower of the two people
    // Guests see places once the host has chosen. One pick confirms it straight away.
    await h('POST', `/api/meetups/${id}/shortlist`, { ids: [places[0].id] });
    const mine = (await guest('GET', `/api/g/${token}`)).body.meetup.places;
    expect(mine).toHaveLength(1);
    expect(mine[0].myMinutes).toBe(17);
    expect(mine[0].routed).toBe(true);
  });

  it('falls back to the estimate for one person once they change their start', async () => {
    await (deps.db as any).query('update participants set amend_until = now() + interval \'10 minutes\'');
    await guest('POST', `/api/g/${token}/location`, { lat: 1.3, lng: 103.857 });
    const mine = (await guest('GET', `/api/g/${token}`)).body.meetup.places;
    expect(mine[0].myMinutes).toBeLessThan(5); // Place 8 is now about 20 metres away by straight line
    expect(await (deps.db as any).query('select count(*)::int as n from place_times')).toEqual([{ n: 7 }]); // the host's routed times remain (one pair had no route)
  });

  it('falls back to the estimate for everyone when the routing service is down', async () => {
    routesDown = true;
    await newMeetup('Routes down');
    await guest('POST', `/api/g/${token}/location`, { lat: 1.3, lng: 103.86 });
    await h('POST', `/api/meetups/${id}/location`, { lat: 1.3, lng: 103.84 });
    const r = await h('POST', `/api/meetups/${id}/middle`, {});
    expect(r.status).toBe(200);
    expect(r.body.meetup.places.every((p: any) => p.routed === false)).toBe(true);
    routesDown = false;
  });

  it('asks for transit by arrival time, in requests of at most 100 pairs', async () => {
    const { routeMatrix } = await import('./routing');
    calls.length = 0;
    const full = { db: deps.db!, env, fetch: fakeFetch, now: deps.now!, outbox: [] } as Deps;
    const origins = Array.from({ length: 25 }, (_, i) => ({ lat: 1.3 + i * 0.001, lng: 103.8 }));
    const destinations = Array.from({ length: 10 }, (_, i) => ({ lat: 1.31, lng: 103.8 + i * 0.001 }));
    const matrix = await routeMatrix(full, origins, destinations, 'transit', new Date('2026-12-01T12:00:00Z'));
    expect(calls).toHaveLength(3); // 10 + 10 + 5 origins
    expect(calls.every((c) => c.body.origins.length * c.body.destinations.length <= 100)).toBe(true);
    expect(calls[0]!.body.travelMode).toBe('TRANSIT');
    expect(calls[0]!.body.arrivalTime).toBe('2026-12-01T12:00:00.000Z');
    expect(matrix).toHaveLength(25);
    expect(matrix[0]![0]).toBeNull(); // the pair with no route
    expect(matrix[24]![9]).toBe(30 - 18 + 4); // origin index restarts in each request: 24 is the 5th of the last one
  });
});
