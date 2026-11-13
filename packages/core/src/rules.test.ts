import { describe, expect, it } from 'vitest';
import {
  cleanName, countedCategoryVotes, defaultRsvpAfterDateSet, fairMiddle, halfRoundedUp, haversine, isBlockedName, leaders, makeGuestCode,
  maxCategoryVotes, maxShortlist, normaliseGuestCode, rankPlaces, rsvpAfterPlaceVote, tally, travelMinutes, waitingForCategoryVotes, type Voter,
} from './index';

const voter = (id: string, over: Partial<Voter> = {}): Voter => ({ id, rsvp: 'going', isHost: false, skipped: false, dates: [], categories: [], place: null, ...over });

describe('vote limits', () => {
  it('rounds half up', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(halfRoundedUp)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('gives guests up to half the ballot, and no vote on a ballot of one', () => {
    expect(maxCategoryVotes(6)).toBe(3);
    expect(maxCategoryVotes(5)).toBe(3);
    expect(maxCategoryVotes(4)).toBe(2);
    expect(maxCategoryVotes(1)).toBe(0);
    expect(() => maxCategoryVotes(7)).toThrow();
  });
  it('lets the host shortlist up to half the places shown', () => {
    expect(maxShortlist(8)).toBe(4);
    expect(maxShortlist(5)).toBe(3);
    expect(maxShortlist(1)).toBe(1);
  });
});

describe('tallies', () => {
  it('orders by votes and reports ties for the host to break', () => {
    const rows = tally(['pizza', 'ramen', 'tacos'], ['ramen', 'pizza', 'ramen', 'pizza', 'nope' as never]);
    expect(rows).toEqual([{ key: 'pizza', votes: 2 }, { key: 'ramen', votes: 2 }, { key: 'tacos', votes: 0 }]);
    expect(leaders(rows)).toEqual(['pizza', 'ramen']);
  });
});

describe('whose votes count', () => {
  const people = [
    voter('host', { isHost: true, categories: ['pizza'] }),
    voter('a', { rsvp: 'going', categories: ['pizza', 'ramen'] }),
    voter('b', { rsvp: 'maybe', categories: ['tacos'] }),
    voter('c', { rsvp: 'no', categories: ['bar'] }),
    voter('d', { rsvp: 'maybe' }),
  ];
  it('fixed date: going and maybe count, cannot-go does not', () => {
    expect(countedCategoryVotes(people, null).sort()).toEqual(['pizza', 'pizza', 'ramen', 'tacos']);
  });
  it('waits for everyone going or maybe, unless skipped', () => {
    expect(waitingForCategoryVotes(people, null)).toEqual(['d']);
    expect(waitingForCategoryVotes(people.map((p) => (p.id === 'd' ? { ...p, skipped: true } : p)), null)).toEqual([]);
  });
  it('date vote: only people who can make the set date count', () => {
    const dated = [voter('host', { isHost: true, categories: ['pizza'] }), voter('a', { dates: ['d1'], categories: ['ramen'] }), voter('b', { dates: ['d2'], categories: ['tacos'] })];
    expect(countedCategoryVotes(dated, 'd1').sort()).toEqual(['pizza', 'ramen']);
  });
});

describe('replies', () => {
  it('defaults to going only for people who picked the set date', () => {
    expect(defaultRsvpAfterDateSet(['d1', 'd2'], 'd2')).toBe('going');
    expect(defaultRsvpAfterDateSet(['d1'], 'd2')).toBeNull();
  });
  it('turns a maybe into going when they vote for a place', () => {
    expect(rsvpAfterPlaceVote('maybe')).toBe('going');
    expect(rsvpAfterPlaceVote('no')).toBe('no');
  });
});

describe('names and codes', () => {
  it('cleans and limits names', () => {
    expect(cleanName('  Midnight   poetry party <b> ', 25)).toBe('Midnight poetry party b');
    expect(cleanName('Alexandria the Great', 10)).toBe('Alexandria');
    expect(cleanName('   ', 10)).toBeNull();
  });
  it('blocks obvious abuse in names guests will see', () => {
    expect(isBlockedName('Hotpot')).toBe(false);
    expect(isBlockedName('f.u.c.k this')).toBe(true);
    expect(isBlockedName('Spam Hut', ['spam'])).toBe(true);
  });
  it('makes unambiguous 4-character codes and normalises what guests type', () => {
    const code = makeGuestCode();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);
    expect(normaliseGuestCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(normaliseGuestCode('12')).toBeNull();
  });
});

describe('the fair middle', () => {
  const a = { lat: 1.3, lng: 103.8 };
  const b = { lat: 1.3, lng: 103.9 };
  const c = { lat: 1.38, lng: 103.85 };
  it('sits between two people', () => {
    const m = fairMiddle([a, b]);
    expect(m.lng).toBeCloseTo(103.85, 2);
    expect(Math.abs(haversine(m, a) - haversine(m, b))).toBeLessThan(150);
  });
  it('keeps the longest trip as short as it can', () => {
    const m = fairMiddle([a, b, c]);
    const longest = Math.max(...[a, b, c].map((p) => haversine(m, p)));
    for (const p of [a, b, c]) expect(longest).toBeLessThanOrEqual(Math.max(...[a, b, c].map((q) => haversine(p, q))));
  });
  it('ranks places by the longest trip and shows at most eight', () => {
    const people = [{ id: 'a', ...a }, { id: 'b', ...b }];
    const places = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, lat: 1.3, lng: 103.8 + i * 0.01, rating: 4 }));
    const ranked = rankPlaces(places, people);
    expect(ranked).toHaveLength(8);
    expect(ranked[0]!.place.id).toBe('p5');
    expect(ranked[0]!.longest).toBe(travelMinutes(a, places[5]!));
  });
});
