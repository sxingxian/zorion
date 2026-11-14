import { Hono } from 'hono';
import { z } from 'zod';
import { LIMITS, type Voter, cleanName, countedCategoryVotes, defaultRsvpAfterDateSet, fairMiddle, isBlockedName, leaders, maxCategoryVotes, maxShortlist, rankPlaces, scorePlaces, tally, travelMinutes, waitingForCategoryVotes } from '@zorion/core';
import * as schemas from '@zorion/core/schemas';
import { type Db, type Row, one } from '@zorion/db';
import { type App, type C, type Deps, Fail, body, clientKey, features, guardLock, requireUser, setting, strike, upgrade } from './core';
import { randomToken } from './crypto';
import { findStart } from './geocode';
import { later, tellGuests } from './mail';
import { findPlaces } from './places';
import { routeWithLadder, routingLadder } from './routing';

// ---------- loading a meetup with everything attached ----------
export interface Loaded {
  m: Row;
  cats: Row[];
  dates: Row[];
  people: Row[];
  places: Row[];
  /** Routed minutes, where a routing service supplied them. */
  times: Row[];
}

export async function load(db: Db, by: { id: string } | { token: string }): Promise<Loaded | null> {
  const m = 'id' in by ? await one(db, 'select * from meetups where id = $1', [by.id]) : await one(db, 'select * from meetups where link_token = $1', [by.token]);
  if (!m) return null;
  const [cats, dates, people, places, times] = await Promise.all([
    db.query('select key, name, icon, own from meetup_categories where meetup_id = $1 order by position', [m.id]),
    db.query('select id, starts_at from date_options where meetup_id = $1 order by starts_at', [m.id]),
    db.query(
      `select p.*,
         coalesce((select array_agg(dv.option_id::text) from date_votes dv where dv.participant_id = p.id), '{}') as dates,
         coalesce((select array_agg(cv.key) from category_votes cv where cv.participant_id = p.id), '{}') as categories,
         (select pv.place_id::text from place_votes pv where pv.participant_id = p.id) as place,
         coalesce((select array_agg(gd.device_hash) from guest_devices gd where gd.participant_id = p.id), '{}') as devices,
         coalesce(p.amend_until > now(), false) as can_amend
       from participants p where p.meetup_id = $1 order by p.is_host desc, p.created_at, p.name`,
      [m.id],
    ),
    db.query('select * from places where meetup_id = $1 order by position', [m.id]),
    db.query('select t.place_id, t.participant_id, t.minutes from place_times t join places p on p.id = t.place_id where p.meetup_id = $1', [m.id]),
  ]);
  return { m, cats, dates, people, places, times };
}

/** One person's trip to one place: the routed time when there is one, the estimate otherwise. */
export function tripMinutes(L: Loaded, person: Row, place: Row): number | null {
  if (person.lat === null) return null;
  const routed = L.times.find((t) => t.place_id === place.id && t.participant_id === person.id);
  return routed ? Number(routed.minutes) : travelMinutes({ lat: person.lat, lng: person.lng }, { lat: place.lat, lng: place.lng }, L.m.travel_mode);
}

/**
 * Typed starting place. Limited per network, because every lookup is a call to an outside service.
 * `cf` is Cloudflare's rough idea of where the caller is; it only puts nearby results first.
 */
export async function lookupStart(c: C, q: string, meetupZone: string) {
  const deps = c.get('deps');
  const key = `start-search:${await clientKey(c)}`;
  await guardLock(deps.db, key);
  await strike(deps.db, key, 15, 10, 10);
  const cf = (c.req.raw as { cf?: { country?: string; latitude?: string; longitude?: string } }).cf;
  const lat = Number(cf?.latitude);
  const lng = Number(cf?.longitude);
  try {
    return await findStart(deps, q, { country: searchCountry(meetupZone, cf?.country), ...(Number.isFinite(lat) && Number.isFinite(lng) && cf?.latitude ? { lat, lng } : {}) });
  } catch {
    throw new Fail(409, 'search_failed', "Place search isn't responding. Try again, or share your location.");
  }
}

/**
 * Which country to look in. The meetup decides, not where the person happens to be: a guest flying in
 * to a Singapore meetup still searches Singapore (and gets OneMap), and someone in Singapore planning a
 * meetup elsewhere isn't held to Singapore. Otherwise the person's own country, as Cloudflare sees it.
 */
export function searchCountry(meetupZone: string, callerCountry: string | undefined): string | undefined {
  if (meetupZone === 'Asia/Singapore') return 'SG';
  const caller = callerCountry && /^[A-Za-z]{2}$/.test(callerCountry) ? callerCountry.toUpperCase() : undefined;
  return caller === 'SG' || caller === 'XX' || caller === 'T1' ? undefined : caller; // XX: unknown, T1: Tor
}

const voters = (L: Loaded): Voter[] =>
  L.people.map((p) => ({ id: p.id, rsvp: p.rsvp, isHost: p.is_host, skipped: p.skipped, dates: p.dates, categories: p.categories, place: p.place }));

/** Numbers both the host view and the guest view are built from. */
export function summarise(L: Loaded) {
  const setDate: string | null = L.m.date_mode === 'vote' ? L.m.set_date_option : null;
  const keys = L.cats.map((c) => c.key as string);
  const all = voters(L);
  // While the date is still open nobody can be "counted out", so every vote shows in the running tally.
  const counted = L.m.date_mode === 'vote' && !setDate ? all.flatMap((v) => [...v.categories]) : countedCategoryVotes(all, setDate);
  const categoryTally = tally(keys, counted);
  const waiting = keys.length < 2 || (L.m.date_mode === 'vote' && !setDate) ? [] : waitingForCategoryVotes(all, setDate);
  const dateTally = tally(L.dates.map((d) => d.id as string), L.people.flatMap((p) => (p.is_host ? L.dates.map((d) => d.id) : p.dates)));
  const short = L.places.filter((p) => p.shortlisted);
  const placeTally = tally(short.map((p) => p.id as string), L.people.map((p) => p.place).filter((x): x is string => !!x));
  return {
    setDate,
    maxVotes: maxCategoryVotes(keys.length),
    categoryTally,
    categoryLeaders: leaders(categoryTally),
    waiting,
    dateTally,
    dateAnswered: L.people.filter((p) => p.is_host || p.dates.length > 0 || p.no_date_works).length,
    placeTally,
    placeLeaders: leaders(placeTally),
    going: L.people.filter((p) => p.rsvp === 'going').length,
    maybe: L.people.filter((p) => p.rsvp === 'maybe').length,
    noReply: L.people.filter((p) => p.rsvp === 'none').length,
  };
}

const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);

export function hostView(L: Loaded, deps: Deps, unseenChanges: number) {
  const s = summarise(L);
  const host = L.people.find((p) => p.is_host)!;
  const middle = L.m.middle_lat === null ? null : { lat: L.m.middle_lat as number, lng: L.m.middle_lng as number };
  return {
    id: L.m.id,
    name: L.m.name,
    status: L.m.status,
    link: `${deps.env.APP_ORIGIN}/j/${L.m.link_token}`,
    timeZone: L.m.time_zone,
    startsAt: iso(L.m.starts_at),
    dateMode: L.m.date_mode,
    setDateOption: L.m.set_date_option,
    guestTheme: L.m.guest_theme,
    travelMode: L.m.travel_mode,
    ballot: L.cats,
    maxVotes: s.maxVotes,
    myCategories: host.categories as string[],
    myPlace: host.place as string | null,
    hasLocation: host.lat !== null,
    dates: L.dates.map((d) => ({ id: d.id, startsAt: iso(d.starts_at), votes: s.dateTally.find((t) => t.key === d.id)?.votes ?? 0, names: L.people.filter((p) => p.is_host || p.dates.includes(d.id)).map((p) => p.name) })),
    dateAnswered: s.dateAnswered,
    people: L.people.map((p) => ({
      id: p.id, name: p.name, isHost: p.is_host, claimed: p.claimed, rsvp: p.rsvp, rsvpIsDefault: p.rsvp_is_default, voted: p.categories.length > 0, votedPlace: !!p.place,
      skipped: p.skipped, hasLocation: p.lat !== null, joinedLate: p.joined_late, noDateWorks: p.no_date_works,
      minutes: middle && p.lat !== null ? travelMinutes({ lat: p.lat, lng: p.lng }, middle, L.m.travel_mode) : null,
    })),
    counts: { going: s.going, maybe: s.maybe, noReply: s.noReply },
    categoryTally: s.categoryTally,
    categoryLeaders: s.categoryLeaders,
    waiting: s.waiting,
    winner: L.m.winning_category,
    middle,
    places: L.places.map((p) => ({ id: p.id, name: p.name, address: p.address, rating: p.rating, openNow: p.open_now, longest: p.longest_min, routed: p.routed, source: p.provider, routedBy: p.routed ? p.routed_by : null, shortlisted: p.shortlisted, lat: p.lat, lng: p.lng, votes: s.placeTally.find((t) => t.key === p.id)?.votes ?? 0 })),
    maxShortlist: L.places.length ? maxShortlist(L.places.length) : 0,
    placeLeaders: s.placeLeaders,
    chosenPlace: L.m.chosen_place,
    unseenChanges,
  };
}

async function unseen(db: Db, meetupId: string): Promise<number> {
  return Number((await one(db, 'select count(*)::int as n from changes where meetup_id = $1 and not seen', [meetupId]))?.n ?? 0);
}

// ---------- host routes ----------
export const meetups = new Hono<App>();

async function owned(c: C): Promise<Loaded> {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!schemas.uuid.safeParse(id).success) throw new Fail(404, 'not_found', 'Meetup not found.');
  const L = await load(c.get('deps').db, { id });
  if (!L || L.m.host_id !== user.id) throw new Fail(404, 'not_found', 'Meetup not found.'); // same answer for "not yours"
  return L;
}
const respond = async (c: C, id: string) => {
  const deps = c.get('deps');
  const L = (await load(deps.db, { id }))!;
  return c.json({ meetup: hostView(L, deps, await unseen(deps.db, id)) });
};
const need = (ok: boolean, message: string, code = 'not_now'): void => {
  if (!ok) throw new Fail(409, code, message);
};

meetups.get('/', async (c) => {
  const user = requireUser(c);
  const rows = await c.get('deps').db.query(
    `select m.id, m.name, m.status, m.starts_at, m.date_mode, m.time_zone,
       (select count(*)::int from participants p where p.meetup_id = m.id) as people,
       (select count(*)::int from participants p where p.meetup_id = m.id and p.rsvp = 'going') as going,
       (select count(*)::int from meetup_categories mc where mc.meetup_id = m.id) as ballot
     from meetups m where m.host_id = $1 order by m.created_at desc limit 50`,
    [user.id],
  );
  return c.json({ meetups: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, startsAt: iso(r.starts_at), dateMode: r.date_mode, timeZone: r.time_zone, people: r.people, going: r.going, ballot: r.ballot })) });
});

meetups.post('/', async (c) => {
  const user = requireUser(c);
  const input = await body(c, schemas.createMeetup);
  const { db } = c.get('deps');
  const name = cleanName(input.name, LIMITS.meetupName);
  if (!name || isBlockedName(name)) throw new Fail(422, 'invalid', 'Choose another meetup name.');
  const blocked = await setting<string[]>(db, 'blocked_words', []);
  const f = await features(db, user.plan);
  if (f.activeMeetups > 0) {
    const open = await one(db, "select count(*)::int as n from meetups where host_id = $1 and status <> 'ended'", [user.id]);
    if (Number(open?.n ?? 0) >= f.activeMeetups) throw upgrade(`Your plan allows ${f.activeMeetups} meetup${f.activeMeetups === 1 ? '' : 's'} at a time.`, { limit: f.activeMeetups });
  }
  if (!f.travel.includes(input.travelMode)) throw upgrade(`${input.travelMode === 'transit' ? 'Transit' : 'Cycling'} times come with Pro.`);
  const active = await db.query('select key, name, icon from categories where active order by position');
  const ballot: Array<{ key: string; name: string; icon: string; own: boolean }> = [];
  const saveOwn: Array<[string, string]> = [];
  for (const item of input.ballot) {
    if ('key' in item) {
      const cat = active.find((a) => a.key === item.key);
      if (!cat) throw new Fail(422, 'invalid', 'One of those options is no longer available.');
      ballot.push({ key: cat.key, name: cat.name, icon: cat.icon, own: false });
    } else {
      if (!f.ownCategories) throw upgrade('Your own food options come with Pro.');
      const own = cleanName(item.own.name, LIMITS.categoryName);
      if (!own || isBlockedName(own, blocked)) throw new Fail(422, 'invalid', 'Choose another name.');
      ballot.push({ key: `own_${ballot.length}`, name: own, icon: item.own.icon, own: true });
      if (item.own.save) saveOwn.push([own, item.own.icon]);
    }
  }
  if (new Set(ballot.map((b) => b.name.toLowerCase())).size !== ballot.length) throw new Fail(422, 'invalid', 'Each option can only be added once.');
  const names: string[] = [];
  for (const raw of input.invitees) {
    const n = cleanName(raw, LIMITS.inviteeName);
    if (!n || isBlockedName(n, blocked)) throw new Fail(422, 'invalid', "One of those names can't be used.");
    if (n.toLowerCase() === user.display_name.toLowerCase() || names.some((x) => x.toLowerCase() === n.toLowerCase())) throw new Fail(422, 'invalid', `"${n}" is on the list twice.`);
    names.push(n);
  }
  if (names.length + 1 > f.groupSize) throw upgrade(`Your plan covers groups of up to ${f.groupSize}.`, { limit: f.groupSize });
  const dates = [...new Set(input.dateOptions)];
  const id = crypto.randomUUID();
  await db.batch([
    ['insert into meetups (id, host_id, link_token, name, time_zone, starts_at, date_mode, travel_mode) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, user.id, randomToken(16), name, input.timeZone, input.startsAt, input.startsAt ? 'fixed' : 'vote', input.travelMode]],
    ...ballot.map((b, i): [string, unknown[]] => ['insert into meetup_categories (meetup_id, key, name, icon, own, position) values ($1, $2, $3, $4, $5, $6)', [id, b.key, b.name, b.icon, b.own, i]]),
    ...dates.map((d): [string, unknown[]] => ['insert into date_options (meetup_id, starts_at) values ($1, $2)', [id, d]]),
    ['insert into participants (meetup_id, name, is_host, user_id, claimed, rsvp) values ($1, $2, true, $3, true, $4)', [id, user.display_name, user.id, 'going']],
    ...names.map((n): [string, unknown[]] => ['insert into participants (meetup_id, name) values ($1, $2)', [id, n]]),
    ...saveOwn.map(([n, icon]): [string, unknown[]] => ['insert into own_categories (user_id, name, icon) values ($1, $2, $3) on conflict (user_id, name) do update set icon = excluded.icon', [user.id, n, icon]]),
  ]);
  return respond(c, id);
});

meetups.get('/:id', async (c) => respond(c, (await owned(c)).m.id));

meetups.delete('/:id', async (c) => {
  const L = await owned(c);
  await c.get('deps').db.query('delete from meetups where id = $1', [L.m.id]);
  return c.json({ ok: true });
});

meetups.post('/:id/people', async (c) => {
  const L = await owned(c);
  const user = requireUser(c);
  const { db } = c.get('deps');
  const input = await body(c, z.object({ name: z.string().max(40) }));
  need(['draft', 'date_vote', 'voting'].includes(L.m.status), 'People can be added until the place is being picked.');
  const n = cleanName(input.name, LIMITS.inviteeName);
  if (!n || isBlockedName(n, await setting<string[]>(db, 'blocked_words', []))) throw new Fail(422, 'invalid', 'Enter another name.');
  if (L.people.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new Fail(422, 'invalid', `"${n}" is already on the list.`);
  const { groupSize } = await features(db, user.plan);
  if (L.people.length + 1 > groupSize) throw upgrade(`Your plan covers groups of up to ${groupSize}.`, { limit: groupSize });
  await db.query('insert into participants (meetup_id, name) values ($1, $2)', [L.m.id, n]);
  return respond(c, L.m.id);
});

meetups.delete('/:id/people/:pid', async (c) => {
  const L = await owned(c);
  const p = L.people.find((x) => x.id === c.req.param('pid'));
  if (!p || p.is_host) throw new Fail(404, 'not_found', 'That person is not on the list.');
  await c.get('deps').db.query('delete from participants where id = $1', [p.id]);
  return respond(c, L.m.id);
});

/** The host asked for a new code for a guest: the name becomes free to claim again. */
meetups.post('/:id/people/:pid/reset-code', async (c) => {
  const L = await owned(c);
  const p = L.people.find((x) => x.id === c.req.param('pid'));
  if (!p || p.is_host) throw new Fail(404, 'not_found', 'That person is not on the list.');
  await c.get('deps').db.batch([
    ['update participants set claimed = false, code_hash = null, amend_until = null where id = $1', [p.id]],
    ['delete from guest_devices where participant_id = $1', [p.id]],
  ]);
  return respond(c, L.m.id);
});

meetups.post('/:id/people/:pid/skip', async (c) => {
  const L = await owned(c);
  const p = L.people.find((x) => x.id === c.req.param('pid'));
  if (!p || p.is_host) throw new Fail(404, 'not_found', 'That person is not on the list.');
  await c.get('deps').db.query('update participants set skipped = true where id = $1', [p.id]);
  return respond(c, L.m.id);
});

meetups.post('/:id/location', async (c) => {
  const L = await owned(c);
  const at = await body(c, schemas.point);
  const host = L.people.find((p) => p.is_host)!;
  await c.get('deps').db.batch([
    ['update participants set lat = $2, lng = $3 where id = $1', [host.id, at.lat, at.lng]],
    ['delete from place_times where participant_id = $1', [host.id]], // routed from the old start, so no longer true
  ]);
  return respond(c, L.m.id);
});

/** Type a starting place instead of sharing GPS. Returns up to five matches to choose from. */
meetups.post('/:id/start-search', async (c) => {
  const L = await owned(c);
  const { q } = await body(c, schemas.startSearch);
  return c.json(await lookupStart(c, q, L.m.time_zone)); // { results, source }
});

/** The host votes first, before the link goes out. */
meetups.post('/:id/vote', async (c) => {
  const L = await owned(c);
  const { keys } = await body(c, schemas.keyList);
  need(['draft', 'date_vote', 'voting'].includes(L.m.status), 'The category vote is closed.');
  const max = maxCategoryVotes(L.cats.length);
  const picked = [...new Set(keys)].filter((k) => L.cats.some((cat) => cat.key === k));
  if (max > 0 && (picked.length < 1 || picked.length > max)) throw new Fail(422, 'invalid', `Pick 1 to ${max}.`);
  const host = L.people.find((p) => p.is_host)!;
  await c.get('deps').db.batch([
    ['delete from category_votes where participant_id = $1', [host.id]],
    ...picked.map((k): [string, unknown[]] => ['insert into category_votes (participant_id, meetup_id, key) values ($1, $2, $3)', [host.id, L.m.id, k]]),
  ]);
  return respond(c, L.m.id);
});

meetups.post('/:id/share', async (c) => {
  const L = await owned(c);
  const user = requireUser(c);
  const { guestTheme } = await body(c, z.object({ guestTheme: schemas.guestTheme.default('pink') }));
  need(L.m.status === 'draft', 'The link is already out.');
  const host = L.people.find((p) => p.is_host)!;
  need(maxCategoryVotes(L.cats.length) === 0 || host.categories.length > 0, 'Cast your own vote first.', 'vote_first');
  if (guestTheme === 'gold' && !(await features(c.get('deps').db, user.plan)).guestTheme) throw upgrade('The gold guest theme comes with Pro.');
  await c.get('deps').db.query('update meetups set status = $2, guest_theme = $3, updated_at = now() where id = $1', [L.m.id, L.m.date_mode === 'vote' ? 'date_vote' : 'voting', guestTheme]);
  return respond(c, L.m.id);
});

/** The top date is the default, but the host may set any of the offered dates. */
meetups.post('/:id/date', async (c) => {
  const L = await owned(c);
  const { id } = await body(c, schemas.oneId);
  need(L.m.status === 'date_vote', 'The date is already set.');
  const option = L.dates.find((d) => d.id === id);
  if (!option) throw new Fail(422, 'invalid', 'Pick one of the dates you offered.');
  const statements: Array<[string, unknown[]]> = [['update meetups set starts_at = $2, set_date_option = $3, status = $4, updated_at = now() where id = $1', [L.m.id, option.starts_at, id, 'voting']]];
  for (const p of L.people) {
    if (p.is_host || p.rsvp !== 'none') continue;
    if (defaultRsvpAfterDateSet(p.dates, id) === 'going') statements.push(['update participants set rsvp = $2, rsvp_is_default = true where id = $1', [p.id, 'going']]);
  }
  await c.get('deps').db.batch(statements);
  await later(c, tellGuests(c.get('deps'), L.m.id, 'date_set'));
  return respond(c, L.m.id);
});

/** Closes the category vote, works out the fair middle and finds the closest places. */
meetups.post('/:id/middle', async (c) => {
  const L = await owned(c);
  const deps = c.get('deps');
  const { key, override } = await body(c, z.object({ key: z.string().max(40).optional(), override: z.boolean().default(false) }));
  need(L.m.status === 'voting' || (override && L.m.status === 'places'), 'Set the date and collect the votes first.');
  const s = summarise(L);
  need(s.waiting.length === 0, 'Wait for everyone going or maybe to vote, or skip them.', 'waiting');
  let winner = s.categoryLeaders[0]!;
  if (override && key && L.cats.some((cat) => cat.key === key)) winner = key;
  else if (s.categoryLeaders.length > 1) {
    if (!key || !s.categoryLeaders.includes(key)) throw new Fail(409, 'tie', "It's a tie. Pick one.", { leaders: s.categoryLeaders });
    winner = key;
  }
  const host = L.people.find((p) => p.is_host)!;
  need(host.lat !== null, 'Share where you are starting from first.', 'need_location');
  const coming = L.people.filter((p) => p.lat !== null && p.rsvp !== 'no' && (p.is_host || p.rsvp !== 'none' || (s.setDate && p.dates.includes(s.setDate))));
  const middle = fairMiddle(coming.map((p) => ({ lat: p.lat, lng: p.lng })));
  const cat = L.cats.find((x) => x.key === winner)!;
  const def = cat.own ? null : await one(deps.db, 'select osm, google from categories where key = $1', [cat.key]);
  let found;
  try {
    // A category an admin removed mid-meetup is searched by its name, like an own option.
    found = await findPlaces(deps, middle, { name: cat.name, own: cat.own || !def, osm: (def?.osm as string[]) ?? [], google: (def?.google as object) ?? {} });
  } catch {
    throw new Fail(409, 'search_failed', "Place search isn't responding. Try again.");
  }
  if (found.places.length === 0) throw new Fail(409, 'no_places', `No places for ${cat.name} near the middle. Pick another category.`, { tally: s.categoryTally });
  const people = coming.map((p) => ({ id: p.id as string, lat: p.lat as number, lng: p.lng as number }));
  const candidates = found.places.map((p) => ({ ...p, id: p.ref }));
  let ranked = rankPlaces(candidates, people, L.m.travel_mode);
  let routed = false;
  let routedBy: string | null = null;
  const ladder = await routingLadder(deps, L.m.travel_mode);
  if (ladder.length) {
    // Route only the best ten by estimate: enough to reorder the list, few enough to stay cheap.
    const top = scorePlaces(candidates, people, L.m.travel_mode).slice(0, 10).map((r) => r.place);
    try {
      const { matrix, source } = await routeWithLadder(deps, ladder, people, top, L.m.travel_mode, L.m.starts_at ? new Date(L.m.starts_at) : null);
      const known = (personId: string, placeId: string) => matrix[people.findIndex((p) => p.id === personId)]?.[top.findIndex((t) => t.id === placeId)];
      ranked = rankPlaces(top, people, L.m.travel_mode, undefined, known);
      routed = true;
      routedBy = source;
      for (const r of ranked) for (const p of people) if (known(p.id, r.place.id) == null) delete r.minutes[p.id]; // keep only routed cells
    } catch {
      routed = false; // the estimate is always there to fall back on
    }
  }
  const ids = ranked.map(() => crypto.randomUUID());
  await deps.db.batch([
    ['delete from places where meetup_id = $1', [L.m.id]],
    ...ranked.map((r, i): [string, unknown[]] => [
      'insert into places (id, meetup_id, provider, provider_ref, name, address, lat, lng, rating, open_now, longest_min, position, routed, routed_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
      [ids[i], L.m.id, found.provider, r.place.ref, r.place.name, r.place.address, r.place.lat, r.place.lng, r.place.rating, r.place.openNow, r.longest, i, routed, routed ? routedBy : null],
    ]),
    ...(routed ? ranked.flatMap((r, i) => Object.entries(r.minutes).map(([personId, minutes]): [string, unknown[]] => ['insert into place_times (place_id, participant_id, minutes) values ($1, $2, $3)', [ids[i], personId, minutes]])) : []),
    ['update meetups set winning_category = $2, middle_lat = $3, middle_lng = $4, status = $5, chosen_place = null, updated_at = now() where id = $1', [L.m.id, winner, middle.lat, middle.lng, 'places']],
  ]);
  return respond(c, L.m.id);
});

/** One place: straight to confirmed, no vote. More: the host votes first and the guests vote for one. */
meetups.post('/:id/shortlist', async (c) => {
  const L = await owned(c);
  const { ids, hostPick } = await body(c, z.object({ ids: z.array(schemas.uuid).min(1).max(4), hostPick: schemas.uuid.optional() }));
  need(L.m.status === 'places', 'Find the middle first.');
  const picked = [...new Set(ids)];
  if (picked.some((id) => !L.places.some((p) => p.id === id)) || picked.length > maxShortlist(L.places.length)) throw new Fail(422, 'invalid', `Pick 1 to ${maxShortlist(L.places.length)} places.`);
  const { db } = c.get('deps');
  if (picked.length === 1) {
    await db.batch([
      ['update places set shortlisted = (id = $2) where meetup_id = $1', [L.m.id, picked[0]]],
      ['update meetups set chosen_place = $2, status = $3, confirmed_at = now(), updated_at = now() where id = $1', [L.m.id, picked[0], 'confirmed']],
    ]);
    await later(c, tellGuests(c.get('deps'), L.m.id, 'confirmed'));
    return respond(c, L.m.id);
  }
  if (!hostPick || !picked.includes(hostPick)) throw new Fail(409, 'vote_first', 'Vote for one of the places first.');
  const host = L.people.find((p) => p.is_host)!;
  await db.batch([
    ['update places set shortlisted = (id = any($2::uuid[])) where meetup_id = $1', [L.m.id, picked]],
    ['delete from place_votes where participant_id in (select id from participants where meetup_id = $1)', [L.m.id]],
    ['insert into place_votes (participant_id, place_id) values ($1, $2)', [host.id, hostPick]],
    ['update meetups set status = $2, updated_at = now() where id = $1', [L.m.id, 'place_vote']],
  ]);
  await later(c, tellGuests(c.get('deps'), L.m.id, 'place_vote'));
  return respond(c, L.m.id);
});

meetups.post('/:id/lock', async (c) => {
  const L = await owned(c);
  const { id } = await body(c, z.object({ id: schemas.uuid.optional() }));
  need(L.m.status === 'place_vote', 'There is no place vote to close.');
  const s = summarise(L);
  const short = L.places.filter((p) => p.shortlisted).map((p) => p.id as string);
  const chosen = id && short.includes(id) ? id : s.placeLeaders.length === 1 ? s.placeLeaders[0]! : null;
  if (!chosen) throw new Fail(409, 'tie', "It's a tie. Pick the place.", { leaders: s.placeLeaders });
  await c.get('deps').db.query('update meetups set chosen_place = $2, status = $3, confirmed_at = now(), updated_at = now() where id = $1', [L.m.id, chosen, 'confirmed']);
  await later(c, tellGuests(c.get('deps'), L.m.id, 'confirmed'));
  return respond(c, L.m.id);
});

/** Amending. A new date keeps every reply unless the host chooses to clear them. */
meetups.patch('/:id', async (c) => {
  const L = await owned(c);
  const user = requireUser(c);
  const input = await body(c, schemas.updateMeetup);
  const statements: Array<[string, unknown[]]> = [];
  if (input.name !== undefined) {
    const n = cleanName(input.name, LIMITS.meetupName);
    if (!n || isBlockedName(n)) throw new Fail(422, 'invalid', 'Choose another meetup name.');
    statements.push(['update meetups set name = $2, updated_at = now() where id = $1', [L.m.id, n]]);
  }
  if (input.guestTheme) {
    if (input.guestTheme === 'gold' && !(await features(c.get('deps').db, user.plan)).guestTheme) throw upgrade('The gold guest theme comes with Pro.');
    statements.push(['update meetups set guest_theme = $2, updated_at = now() where id = $1', [L.m.id, input.guestTheme]]);
  }
  if (input.startsAt) {
    need(L.m.status !== 'date_vote' && L.m.status !== 'draft' ? true : L.m.date_mode === 'fixed', 'Set the date from the vote first.');
    statements.push(['update meetups set starts_at = $2, updated_at = now() where id = $1', [L.m.id, input.startsAt]]);
    statements.push(['insert into changes (meetup_id, kind, detail, seen) values ($1, $2, $3, true)', [L.m.id, 'date_changed', input.clearReplies ? 'cleared' : 'kept']]);
    if (input.clearReplies) statements.push(["update participants set rsvp = 'none', rsvp_is_default = false where meetup_id = $1 and not is_host", [L.m.id]]);
  }
  if (statements.length) await c.get('deps').db.batch(statements);
  if (input.startsAt && new Date(input.startsAt).getTime() !== (L.m.starts_at ? new Date(L.m.starts_at).getTime() : 0)) {
    await later(c, tellGuests(c.get('deps'), L.m.id, input.clearReplies ? 'date_moved_cleared' : 'date_moved'));
  }
  return respond(c, L.m.id);
});

meetups.get('/:id/changes', async (c) => {
  const L = await owned(c);
  const rows = await c.get('deps').db.query(
    `select ch.id, ch.kind, ch.detail, ch.seen, ch.created_at, p.name from changes ch left join participants p on p.id = ch.participant_id
     where ch.meetup_id = $1 and ch.participant_id is not null order by ch.created_at desc limit 50`,
    [L.m.id],
  );
  return c.json({ changes: rows.map((r) => ({ id: r.id, kind: r.kind, detail: r.detail, seen: r.seen, at: iso(r.created_at), name: r.name })) });
});

meetups.post('/:id/changes/seen', async (c) => {
  const L = await owned(c);
  await c.get('deps').db.query('update changes set seen = true where meetup_id = $1', [L.m.id]);
  return respond(c, L.m.id);
});

// ---------- categories ----------
export const catalog = new Hono<App>();

catalog.get('/categories', async (c) => {
  const { db } = c.get('deps');
  const user = c.get('user');
  const rows = await db.query('select key, name, icon from categories where active order by position');
  const own = user ? await db.query('select id, name, icon from own_categories where user_id = $1 order by created_at', [user.id]) : [];
  return c.json({ categories: rows, own, ownAllowed: !!user && (await features(db, user.plan)).ownCategories });
});

catalog.delete('/own-categories/:cid', async (c) => {
  const user = requireUser(c);
  const cid = c.req.param('cid');
  if (!schemas.uuid.safeParse(cid).success) throw new Fail(404, 'not_found', 'That category does not exist.');
  await c.get('deps').db.query('delete from own_categories where id = $1 and user_id = $2', [cid, user.id]);
  return c.json({ ok: true });
});
