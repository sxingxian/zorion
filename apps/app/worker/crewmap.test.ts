import { describe, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import type { Deps, Env } from './core';
import { crewPeople, mapView, middleOf, roughCentre, trimInside } from './crewmap';
import type { Loaded } from './meetups';

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const x = ((b.lng - a.lng) * Math.PI) / 180 * Math.cos((a.lat * Math.PI) / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.sqrt(x * x + y * y) * 6_371_000;
};
const person = (id: string, name: string, lat: number | null, lng: number | null, extra: Record<string, unknown> = {}) => ({ id, name, lat, lng, rsvp: 'going', is_host: false, show_on_map: false, map_offset_seed: 123456 + id.length * 977, ...extra });
const loaded = (people: ReturnType<typeof person>[], m: Record<string, unknown> = {}): Loaded => ({
  m: { id: 'm1', status: 'voting', travel_mode: 'walk', middle_lat: null, middle_lng: null, chosen_place: null, ...m },
  cats: [], dates: [], people, places: [], times: [],
}) as unknown as Loaded;

describe('the crew map keeps starts private', () => {
  it('moves a rough area 250–450 m, the same way every time', () => {
    const home = { lat: 1.3, lng: 103.85 };
    for (const seed of [1, 99, 123456, 2_000_000_000]) {
      const a = roughCentre(home, seed);
      expect(roughCentre(home, seed)).toEqual(a); // fixed, so it can't be averaged away by reloading
      const d = metres(home, a);
      expect(d).toBeGreaterThan(230);
      expect(d).toBeLessThan(470);
    }
  });

  it("shows your own pin, a shared pin with its name, and everyone else as an unnamed rough area", () => {
    const L = loaded([person('a', 'You', 1.3, 103.85), person('b', 'Sam', 1.31, 103.86, { show_on_map: true }), person('c', 'Lee', 1.29, 103.84), person('d', 'Away', 1.29, 103.9, { rsvp: 'no' })]);
    const people = crewPeople(L, L.people[0]!);
    expect(people.map((p) => [p.kind, p.name])).toEqual([['you', 'You'], ['shared', 'Sam'], ['rough', null]]); // can't-go people are left off
    expect(people[2]!.lat).not.toBe(1.29);
  });

  it('hides the middle until three starts are in, so two people cannot work out each other', () => {
    expect(middleOf(loaded([person('a', 'A', 1.3, 103.85), person('b', 'B', 1.31, 103.86)]))).toBeNull();
    expect(middleOf(loaded([person('a', 'A', 1.3, 103.85), person('b', 'B', 1.31, 103.86), person('c', 'C', 1.32, 103.84)]))).not.toBeNull();
  });

  it('starts a private route at the edge of the rough area', () => {
    const centre = { lat: 1.3, lng: 103.85 };
    const line: [number, number][] = [[103.85, 1.3], [103.851, 1.3], [103.853, 1.3], [103.857, 1.3], [103.86, 1.3]];
    const trimmed = trimInside(line, centre, 500);
    expect(metres(centre, { lat: trimmed[0]![1], lng: trimmed[0]![0] })).toBeGreaterThanOrEqual(500);
  });

  it("with routing set to Zorion's estimate, draws straight lines and calls nothing", async () => {
    const db = await testDb();
    const calls: string[] = [];
    const deps = { db, env: { OSRM_FOOT_URL: 'https://osrm.example/foot' } as Env, fetch: (async (u: string) => { calls.push(u); return new Response('no', { status: 500 }); }) as unknown as typeof fetch, now: () => new Date(), outbox: [] } as unknown as Deps;
    const L = loaded([person('00000000-0000-0000-0000-00000000000a', 'You', 1.3, 103.85), person('00000000-0000-0000-0000-00000000000b', 'B', 1.31, 103.86), person('00000000-0000-0000-0000-00000000000c', 'C', 1.32, 103.84)]);
    const view = await mapView(deps, L, L.people[0]!, []);
    expect(view.routes).toHaveLength(3);
    expect(view.routes.every((r) => r.source === 'straight')).toBe(true);
    expect(calls).toHaveLength(0);
    expect(view.singapore).toBe(true);
    expect(JSON.stringify(view.people.filter((p) => p.kind === 'rough'))).not.toMatch(/1\.31,|103\.86[^0-9]/);
    expect(view.avatar).toBe('plain'); // a guest has no account, so their marker is the plain pig
    expect(view.icon).toBeNull();
  });

  it("the host's marker is their own pig, and the meeting place carries the winning food's icon", async () => {
    const db = await testDb();
    const host = (await db.query("insert into users (email, display_name, avatar) values ('h@example.com', 'H', 'crown') returning id"))[0]!.id;
    const deps = { db, env: {} as Env, fetch: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch, now: () => new Date(), outbox: [] } as unknown as Deps;
    const L = loaded([person('00000000-0000-0000-0000-00000000000a', 'H', 1.3, 103.85, { is_host: true })], { host_id: host, winning_category: 'pizza' });
    (L as any).cats = [{ key: 'pizza', icon: 'pizza' }];
    const view = await mapView(deps, L, L.people[0]!, []);
    expect(view.avatar).toBe('crown');
    expect(view.icon).toBe('pizza');
  });
});
