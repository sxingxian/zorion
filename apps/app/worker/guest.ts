import { Hono } from 'hono';
import { z } from 'zod';
import { LIMITS, cleanName, isBlockedName, makeGuestCode, maxCategoryVotes, normaliseGuestCode, rsvpAfterPlaceVote } from '@zorion/core';
import * as schemas from '@zorion/core/schemas';
import type { Row } from '@zorion/db';
import { type App, type C, Fail, body, clearStrikes, clientKey, features, guardLock, putCookie, readCookie, setting, strike } from './core';
import { hmac, randomToken, sha256 } from './crypto';
import { guestForToken, later, sendConfirmation, tellHost } from './mail';
import { connectLink, telegramReady } from './telegram';
import { type Loaded, load, lookupStart, summarise, tripMinutes } from './meetups';
import { directionsUrl } from './places';

/**
 * Guests have no account. They are known by a device cookie set when they join,
 * or by the short code they were shown, which works on any browser.
 * Changing a choice that was already made always needs the code again.
 */
export const guest = new Hono<App>();

const cookieFor = (L: Loaded) => `zg_${String(L.m.id).slice(0, 8)}`;
const codeHash = (c: C, L: Loaded, code: string) => hmac(c.get('deps').env.PEPPER, `guest-code:${L.m.id}:${code}`);

async function open(c: C): Promise<Loaded> {
  const token = c.req.param('token') ?? '';
  const L = /^[A-Za-z0-9_-]{16,40}$/.test(token) ? await load(c.get('deps').db, { token }) : null;
  if (!L || L.m.status === 'draft') throw new Fail(404, 'not_found', "This link doesn't work. Ask the host for a new one.");
  if (L.m.status === 'ended') throw new Fail(410, 'ended', 'This meetup has ended.');
  return L;
}

async function whoAmI(c: C, L: Loaded): Promise<Row | null> {
  const device = readCookie(c, cookieFor(L));
  if (device) {
    const hash = await sha256(device);
    const p = L.people.find((x) => (x.devices as string[]).includes(hash) && !x.is_host);
    if (p) return p;
  }
  const user = c.get('user');
  return user ? (L.people.find((x) => x.user_id === user.id && !x.is_host) ?? null) : null;
}
async function me(c: C, L: Loaded): Promise<Row> {
  const p = await whoAmI(c, L);
  if (!p) throw new Fail(401, 'who', 'Pick your name first.');
  return p;
}

async function rememberDevice(c: C, L: Loaded, participantId: string): Promise<void> {
  const device = randomToken();
  await c.get('deps').db.query('insert into guest_devices (device_hash, participant_id) values ($1, $2)', [await sha256(device), participantId]);
  putCookie(c, cookieFor(L), device, 60 * 86400);
}

/** A choice that already exists can only be changed with a fresh code check. */
/** Once the plan is confirmed, a guest can change only their reply. Date, place and starting point are fixed. */
function replyOnly(L: Loaded): void {
  if (L.m.status === 'confirmed') throw new Fail(409, 'confirmed', 'The plan is set. Only your reply can change.');
}

function needAmend(_c: C, p: Row, alreadySet: boolean): void {
  if (!alreadySet) return;
  if (!p.can_amend) throw new Fail(403, 'code_required', 'Enter your code to change this.');
}
async function noteChange(c: C, L: Loaded, p: Row, kind: string, detail: string): Promise<void> {
  if (L.m.status !== 'confirmed') return; // before confirmation the host sees changes live in the lobby
  await c.get('deps').db.query('insert into changes (meetup_id, participant_id, kind, detail) values ($1, $2, $3, $4)', [L.m.id, p.id, kind, detail.slice(0, 120)]);
  await later(c, tellHost(c.get('deps'), L.m.id, 'change', `${p.name}: ${detail.slice(0, 120)}`));
}

const maskEmail = (e: string): string => e.replace(/^(.).*(@.*)$/, '$1•••$2');

async function guestView(c: C, L: Loaded, who: Row | null, dateChange: { replies: string; at: string } | null = null) {
  const s = summarise(L);
  const host = L.people.find((p) => p.is_host)!;
  const user = c.get('user');
  const visible = L.m.status === 'confirmed' ? L.places.filter((p) => p.id === L.m.chosen_place) : L.m.status === 'place_vote' ? L.places.filter((p) => p.shortlisted) : [];
  const winner = L.cats.find((x) => x.key === L.m.winning_category) ?? null;
  return {
    name: L.m.name,
    telegramReady: telegramReady(c.get('deps')),
    hostName: host.name,
    status: L.m.status,
    timeZone: L.m.time_zone,
    startsAt: L.m.starts_at ? new Date(L.m.starts_at).toISOString() : null,
    dateMode: L.m.date_mode,
    dateIsSet: L.m.date_mode === 'fixed' || !!L.m.set_date_option,
    theme: L.m.guest_theme,
    travelMode: L.m.travel_mode,
    ads: (await features(c.get('deps').db, user?.plan ?? 'free')).ads,
    ballot: L.cats,
    maxVotes: s.maxVotes,
    dates: L.dates.map((d) => ({ id: d.id, startsAt: new Date(d.starts_at).toISOString() })),
    // Names only, so a guest can find themselves. Nobody's location or reply detail is exposed.
    people: L.people.filter((p) => !p.is_host).map((p) => ({ id: p.id, name: p.name, claimed: p.claimed })),
    progress: { total: L.people.filter((p) => p.rsvp !== 'no').length, dateAnswered: s.dateAnswered, categoryVoted: L.people.filter((p) => p.categories.length > 0).length, placeVoted: L.people.filter((p) => p.place).length, going: s.going },
    winner,
    places: visible.map((p) => ({
      id: p.id, name: p.name, address: p.address, rating: p.rating, openNow: p.open_now,
      myMinutes: who ? tripMinutes(L, who, p) : null, routed: !!p.routed,
      ...(L.m.status === 'confirmed' ? { lat: p.lat, lng: p.lng, directions: directionsUrl({ lat: p.lat, lng: p.lng }, L.m.travel_mode) } : {}),
    })),
    dateChange,
    me: who && {
      email: who.email ? { address: maskEmail(who.email), confirmed: !!who.email_confirmed } : null,
      telegram: !!who.telegram_chat_id,
      id: who.id, name: who.name, rsvp: who.rsvp, rsvpIsDefault: who.rsvp_is_default, dates: who.dates, noDateWorks: who.no_date_works, categories: who.categories, place: who.place,
      hasLocation: who.lat !== null, joinedLate: who.joined_late, canAmend: !!who.can_amend,
      pickedSetDate: s.setDate ? (who.dates as string[]).includes(s.setDate) : null,
    },
  };
}
/** Tells a returning guest that the host moved the date, and whether replies were kept. */
async function lastDateChange(c: C, L: Loaded) {
  const row = (await c.get('deps').db.query("select detail, created_at from changes where meetup_id = $1 and kind = 'date_changed' order by created_at desc limit 1", [L.m.id]))[0];
  return row ? { replies: row.detail as string, at: new Date(row.created_at).toISOString() } : null;
}
const respond = async (c: C, L: Loaded) => {
  const fresh = (await load(c.get('deps').db, { id: L.m.id }))!;
  return c.json({ meetup: await guestView(c, fresh, await whoAmI(c, fresh), await lastDateChange(c, fresh)) });
};

guest.get('/:token', async (c) => {
  const L = await open(c);
  return c.json({ meetup: await guestView(c, L, await whoAmI(c, L), await lastDateChange(c, L)) });
});

/** Tap a name the host added, or add yourself. The short code is shown once, here. */
guest.post('/:token/join', async (c) => {
  const L = await open(c);
  const input = await body(c, schemas.guestJoin);
  const { db } = c.get('deps');
  if (await whoAmI(c, L)) throw new Fail(409, 'already', "You've already joined on this device.");
  let id: string;
  const late = L.m.date_mode === 'vote' && L.m.status !== 'date_vote';
  if ('participantId' in input) {
    const p = L.people.find((x) => x.id === input.participantId && !x.is_host);
    if (!p) throw new Fail(404, 'not_found', 'That name is not on the list.');
    if (p.claimed) throw new Fail(409, 'taken', "That name's taken. If it's you, use your code.");
    id = p.id;
  } else {
    if (L.m.status === 'confirmed') throw new Fail(409, 'closed', 'This meetup is confirmed. Ask the host to add you.');
    const n = cleanName(input.name, LIMITS.inviteeName);
    if (!n || isBlockedName(n, await setting<string[]>(db, 'blocked_words', []))) throw new Fail(422, 'invalid', 'Enter another name.');
    if (L.people.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new Fail(409, 'taken', 'That name is already listed. Tap it, or pick another.');
    const hostPlan = (await db.query('select plan from users where id = $1', [L.m.host_id]))[0]?.plan ?? 'free';
    if (L.people.length + 1 > (await features(db, hostPlan as 'free' | 'pro')).groupSize) throw new Fail(409, 'full', 'This meetup is full.');
    id = (await db.query('insert into participants (meetup_id, name) values ($1, $2) returning id', [L.m.id, n]))[0]!.id;
  }
  // A 4-character code can collide inside one meetup, so try a few.
  let code = '';
  for (let i = 0; i < 6 && !code; i++) {
    const candidate = makeGuestCode();
    const hash = await codeHash(c, L, candidate);
    const set = await db.query(
      `update participants set claimed = true, code_hash = $2, joined_late = $3, user_id = $4 where id = $1 and not claimed
         and not exists (select 1 from participants q where q.meetup_id = $5 and q.code_hash = $2) returning id`,
      [id, hash, late, c.get('user')?.id ?? null, L.m.id],
    );
    if (set.length) code = candidate;
  }
  if (!code) throw new Fail(409, 'taken', 'Someone just took that name. Pick another.');
  await rememberDevice(c, L, id);
  const fresh = (await load(db, { id: L.m.id }))!;
  return c.json({ code, meetup: await guestView(c, fresh, fresh.people.find((p) => p.id === id)!) });
});

async function checkCode(c: C, L: Loaded, raw: string): Promise<Row> {
  const { db } = c.get('deps');
  const key = `guest-code:${L.m.id}:${await clientKey(c)}`;
  // A second, meetup-wide limit: a guesser who keeps changing network still runs into it.
  const allKey = `guest-code-all:${L.m.id}`;
  await guardLock(db, key);
  await guardLock(db, allKey);
  const code = normaliseGuestCode(raw);
  const hash = code ? await codeHash(c, L, code) : '';
  const p = code ? L.people.find((x) => x.code_hash === hash && !x.is_host) : undefined;
  if (!p) {
    const locked = await strike(db, key, LIMITS.guestCodeTries, LIMITS.guestCodeLockMinutes, LIMITS.guestCodeLockMinutes);
    await strike(db, allKey, LIMITS.guestCodeTriesPerMeetup, LIMITS.guestCodeLockMinutes, LIMITS.guestCodeLockMinutes);
    throw new Fail(locked ? 429 : 401, locked ? 'locked' : 'wrong', locked ? 'Too many wrong tries. Try again in 10 minutes.' : 'Wrong code.');
  }
  await clearStrikes(db, key);
  return p;
}

/** New browser: the code says who you are. No name to pick. Entering it also allows changes for 10 minutes. */
guest.post('/:token/code', async (c) => {
  const L = await open(c);
  const { code } = await body(c, schemas.guestCode);
  const p = await checkCode(c, L, code);
  await c.get('deps').db.query("update participants set amend_until = now() + interval '10 minutes' where id = $1", [p.id]);
  await rememberDevice(c, L, p.id);
  const fresh = (await load(c.get('deps').db, { id: L.m.id }))!;
  return c.json({ meetup: await guestView(c, fresh, fresh.people.find((x) => x.id === p.id)!) });
});

guest.post('/:token/dates', async (c) => {
  const L = await open(c);
  const p = await me(c, L);
  const input = await body(c, z.object({ ids: z.array(schemas.uuid).max(LIMITS.dateOptionsMax), none: z.boolean().default(false) }));
  replyOnly(L);
  if (L.m.status !== 'date_vote') throw new Fail(409, 'closed', 'The date is already set.');
  needAmend(c, p, p.dates.length > 0 || p.no_date_works);
  const ids = [...new Set(input.ids)].filter((id) => L.dates.some((d) => d.id === id));
  if (!input.none && ids.length === 0) throw new Fail(422, 'invalid', 'Tick at least one date.');
  await c.get('deps').db.batch([
    ['delete from date_votes where participant_id = $1', [p.id]],
    ['update participants set no_date_works = $2 where id = $1', [p.id, input.none]],
    ...(input.none ? [] : ids.map((id): [string, unknown[]] => ['insert into date_votes (participant_id, option_id) values ($1, $2)', [p.id, id]])),
  ]);
  await later(c, tellHost(c.get('deps'), L.m.id, 'dates'));
  return respond(c, L);
});

guest.post('/:token/location', async (c) => {
  const L = await open(c);
  const p = await me(c, L);
  replyOnly(L);
  const at = await body(c, schemas.point);
  needAmend(c, p, p.lat !== null);
  await c.get('deps').db.batch([
    ['update participants set lat = $2, lng = $3 where id = $1', [p.id, at.lat, at.lng]],
    ['delete from place_times where participant_id = $1', [p.id]], // routed from the old start, so no longer true
  ]);
  await noteChange(c, L, p, 'location', 'New starting point');
  return respond(c, L);
});

/** Type a starting place instead of sharing GPS. Returns up to five matches to choose from. */
guest.post('/:token/start-search', async (c) => {
  const L = await open(c);
  await me(c, L);
  replyOnly(L);
  const { q } = await body(c, schemas.startSearch);
  return c.json({ results: await lookupStart(c, q) });
});

guest.post('/:token/categories', async (c) => {
  const L = await open(c);
  const p = await me(c, L);
  const { keys } = await body(c, schemas.keyList);
  replyOnly(L);
  if (!['date_vote', 'voting'].includes(L.m.status)) throw new Fail(409, 'closed', 'The category vote is closed.');
  needAmend(c, p, p.categories.length > 0);
  const max = maxCategoryVotes(L.cats.length);
  const picked = [...new Set(keys)].filter((k) => L.cats.some((cat) => cat.key === k));
  if (max === 0 || picked.length < 1 || picked.length > max) throw new Fail(422, 'invalid', `Pick 1 to ${max}.`);
  await c.get('deps').db.batch([
    ['delete from category_votes where participant_id = $1', [p.id]],
    ...picked.map((k): [string, unknown[]] => ['insert into category_votes (participant_id, meetup_id, key) values ($1, $2, $3)', [p.id, L.m.id, k]]),
  ]);
  await later(c, tellHost(c.get('deps'), L.m.id, 'categories'));
  return respond(c, L);
});

guest.post('/:token/rsvp', async (c) => {
  const L = await open(c);
  const p = await me(c, L);
  const input = await body(c, z.object({ rsvp: schemas.rsvp }));
  if (L.m.date_mode === 'vote' && !L.m.set_date_option) throw new Fail(409, 'not_yet', 'You can reply once the date is set.');
  // Confirming a default reply is not a change; switching away from an explicit one is.
  needAmend(c, p, p.rsvp !== 'none' && !p.rsvp_is_default && p.rsvp !== input.rsvp);
  await c.get('deps').db.query('update participants set rsvp = $2, rsvp_is_default = false where id = $1', [p.id, input.rsvp]);
  if (p.rsvp !== input.rsvp) await noteChange(c, L, p, 'rsvp', `Reply: ${p.rsvp === 'no' ? "can't go" : p.rsvp} to ${input.rsvp === 'no' ? "can't go" : input.rsvp}`);
  return respond(c, L);
});

// ----- optional email updates for a guest -----

/** A guest leaves an address. Nothing is sent to it, apart from one confirmation, until they confirm from their inbox. */
guest.post('/:token/email', async (c) => {
  const L = await open(c);
  const p = await me(c, L);
  if (p.is_host) throw new Fail(409, 'host', 'Hosts set up email under Account.');
  const { email } = await body(c, z.object({ email: schemas.email }));
  const deps = c.get('deps');
  // Each confirmation is an email to an address we have not verified, so keep them few.
  const mine = `guest-email:${p.id}`;
  const net = `guest-email-net:${await clientKey(c)}`;
  await guardLock(deps.db, mine);
  await guardLock(deps.db, net);
  await strike(deps.db, mine, 3, 60 * 24, 60 * 24);
  await strike(deps.db, net, 10, 60, 60);
  await deps.db.query('update participants set email = $2, email_confirmed = false where id = $1', [p.id, email]);
  await later(c, sendConfirmation(deps, L, { ...p, email }));
  return respond(c, L);
});

/** Opened from the confirmation email, possibly in a different browser, so the link itself is the proof. */
guest.post('/:token/email/confirm', async (c) => {
  const L = await open(c);
  const { t } = await body(c, z.object({ t: z.string().max(120) }));
  const p = await guestForToken(c.get('deps'), L, t);
  if (!p) throw new Fail(404, 'not_found', 'That link has expired.');
  await c.get('deps').db.query('update participants set email_confirmed = true where id = $1', [p.id]);
  return c.json({ ok: true, name: p.name });
});

/** Stops the emails and forgets the address: from the link in any email, or from the meetup page. */
guest.post('/:token/email/stop', async (c) => {
  const L = await open(c);
  const { t } = await body(c, z.object({ t: z.string().max(120).optional() }));
  const p = t ? await guestForToken(c.get('deps'), L, t) : await whoAmI(c, L);
  if (p) await c.get('deps').db.query('update participants set email = null, email_confirmed = false where id = $1', [p.id]);
  if (t) return c.json({ ok: true }); // the same answer whether or not the link was still good
  return respond(c, L);
});

// ----- optional Telegram updates for a guest: the same updates as email -----

guest.post('/:token/telegram', async (c) => {
  const L = await open(c);
  const p = await me(c, L);
  if (p.is_host) throw new Fail(409, 'host', 'Hosts connect Telegram under Account.');
  const deps = c.get('deps');
  if (!telegramReady(deps)) throw new Fail(409, 'off', 'Telegram is not set up yet.');
  const key = `telegram-link:${p.id}`;
  await guardLock(deps.db, key);
  await strike(deps.db, key, 10, 60, 60);
  return c.json({ url: await connectLink(deps, { participantId: p.id }) });
});

guest.post('/:token/telegram/stop', async (c) => {
  const L = await open(c);
  const p = await me(c, L);
  await c.get('deps').db.batch([
    ['update participants set telegram_chat_id = null where id = $1', [p.id]],
    ['delete from telegram_links where participant_id = $1', [p.id]],
  ]);
  return respond(c, L);
});

guest.post('/:token/place', async (c) => {
  const L = await open(c);
  const p = await me(c, L);
  const { id } = await body(c, schemas.oneId);
  replyOnly(L);
  if (L.m.status !== 'place_vote') throw new Fail(409, 'closed', 'There is no place vote right now.');
  const place = L.places.find((x) => x.id === id && x.shortlisted);
  if (!place) throw new Fail(422, 'invalid', 'Pick one of the listed places.');
  needAmend(c, p, !!p.place);
  await c.get('deps').db.batch([
    ['insert into place_votes (participant_id, place_id) values ($1, $2) on conflict (participant_id) do update set place_id = excluded.place_id', [p.id, id]],
    ['update participants set rsvp = $2, rsvp_is_default = false where id = $1', [p.id, rsvpAfterPlaceVote(p.rsvp)]],
  ]);
  if (p.place && p.place !== id) await noteChange(c, L, p, 'place', `Place vote: ${L.places.find((x) => x.id === p.place)?.name ?? '?'} to ${place.name}`);
  await later(c, tellHost(c.get('deps'), L.m.id, 'place'));
  return respond(c, L);
});
