import { beforeAll, describe, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import type { Deps, Env } from './core';
import { totpAt, totpStep } from './crypto';
import { cleanUp, maintain, verifyStripeSignature } from './extras';
import { createApp } from './index';
import { hmac } from './crypto';

const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'test-pepper', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef'), ENVIRONMENT: 'development' };

/** A browser: keeps its own cookies between calls. */
function browser(app: ReturnType<typeof createApp>) {
  const jar = new Map<string, string>();
  return async (method: string, path: string, json?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-zorion': '1', origin: env.APP_ORIGIN, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
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

// Fake OpenStreetMap: eight pizza places in a row near the middle.
const fakeFetch = (async (url: string) => {
  if (String(url).includes('overpass')) {
    return Response.json({ elements: Array.from({ length: 8 }, (_, i) => ({ type: 'node', id: i + 1, lat: 1.3, lon: 103.84 + i * 0.002, tags: { name: `Pizza ${i + 1}` } })) });
  }
  throw new Error(`unexpected fetch ${url}`);
}) as unknown as typeof fetch;

let deps: Partial<Deps>;
let app: ReturnType<typeof createApp>;
let clock = new Date('2026-11-13T04:00:00Z');

beforeAll(async () => {
  deps = { db: await testDb(), env, fetch: fakeFetch, now: () => clock, outbox: [] };
  app = createApp(deps);
});

async function signIn(b: ReturnType<typeof browser>, email: string) {
  expect((await b('POST', '/api/auth/email-code', { email })).status).toBe(200);
  const code = deps.outbox!.at(-1)!.text.match(/\d{6}/)![0];
  return b('POST', '/api/auth/email-code/verify', { email, code });
}

describe('sign-in', () => {
  it('refuses state-changing calls that do not come from the app', async () => {
    const res = await app.request('/api/auth/email-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"a@b.co"}' });
    expect(res.status).toBe(403);
  });

  it('signs in with an emailed code, once', async () => {
    const b = browser(app);
    const r = await signIn(b, 'Maya@Example.com');
    expect(r.body.next).toBe('done');
    expect((await b('GET', '/api/auth/me')).body.user.email).toBe('maya@example.com');
    const code = deps.outbox!.at(-1)!.text.match(/\d{6}/)![0];
    expect((await browser(app)('POST', '/api/auth/email-code/verify', { email: 'maya@example.com', code })).status).toBe(401);
  });

  it('pauses sign-in after five wrong codes', async () => {
    const b = browser(app);
    await b('POST', '/api/auth/email-code', { email: 'lock@example.com' });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await b('POST', '/api/auth/email-code/verify', { email: 'lock@example.com', code: '000000' })).status);
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuses.slice(4)).toEqual([429, 429]);
  });

  it('password plus authenticator: two different proofs, and a code cannot be replayed', async () => {
    const b = browser(app);
    await signIn(b, 'two@example.com');
    expect((await b('POST', '/api/account/password', { next: 'a long password 1' })).status).toBe(200);
    const { secret } = (await b('POST', '/api/account/two-step/setup')).body;
    const code = await totpAt(secret, totpStep(clock));
    const enabled = await b('POST', '/api/account/two-step/enable', { code });
    expect(enabled.body.recovery).toHaveLength(8);

    const fresh = browser(app);
    expect((await fresh('POST', '/api/auth/password', { email: 'two@example.com', password: 'wrong password' })).status).toBe(401);
    const first = await fresh('POST', '/api/auth/password', { email: 'two@example.com', password: 'a long password 1' });
    expect(first.body).toEqual({ next: 'two_step', accepts: ['totp', 'recovery'] });
    expect((await fresh('GET', '/api/auth/me')).body.user).toBeNull(); // not signed in until the second step
    expect((await fresh('POST', '/api/auth/two-step', { code })).status).toBe(401); // same code again: refused
    clock = new Date(clock.getTime() + 30_000);
    expect((await fresh('POST', '/api/auth/two-step', { code: await totpAt(secret, totpStep(clock)) })).body.next).toBe('done');
    expect((await fresh('GET', '/api/auth/me')).body.user.totp_enabled).toBe(true);

    // Authenticator first: the second step must be something else.
    const third = browser(app);
    clock = new Date(clock.getTime() + 30_000);
    const viaApp = await third('POST', '/api/auth/authenticator', { email: 'two@example.com', code: await totpAt(secret, totpStep(clock)) });
    expect(viaApp.body.accepts).toEqual(['email_code', 'password']);
    expect((await third('POST', '/api/auth/two-step', { password: 'a long password 1' })).body.next).toBe('done');

    // A recovery code works once.
    const fourth = browser(app);
    await fourth('POST', '/api/auth/password', { email: 'two@example.com', password: 'a long password 1' });
    expect((await fourth('POST', '/api/auth/two-step', { recovery: enabled.body.recovery[0] })).body.next).toBe('done');
    const fifth = browser(app);
    await fifth('POST', '/api/auth/password', { email: 'two@example.com', password: 'a long password 1' });
    expect((await fifth('POST', '/api/auth/two-step', { recovery: enabled.body.recovery[0] })).status).toBe(401);
  });
});

describe('a fixed-date meetup, start to finish', () => {
  const host = () => browser(app);
  let h: ReturnType<typeof browser>;
  let id = '';
  let token = '';
  let priya: ReturnType<typeof browser>;
  let priyaCode = '';

  it('creates a meetup and keeps Free hosts off own categories', async () => {
    h = host();
    await signIn(h, 'maya@example.com');
    const base = { name: 'Midnight poetry party', timeZone: 'Asia/Singapore', startsAt: '2026-11-13T12:00:00.000Z', invitees: ['Alexandria', 'Priya', 'Dev'] };
    const own = await h('POST', '/api/meetups', { ...base, ballot: [{ key: 'pizza' }, { own: { name: 'Hotpot', icon: 'hotpot' } }] });
    expect(own.status).toBe(402);
    const made = await h('POST', '/api/meetups', { ...base, ballot: ['pizza', 'ramen', 'tacos', 'bar', 'izakaya'].map((key) => ({ key })) });
    expect(made.status).toBe(200);
    expect(made.body.meetup.maxVotes).toBe(3);
    id = made.body.meetup.id;
    token = made.body.meetup.link.split('/j/')[1];
    expect((await browser(app)('GET', `/api/meetups/${id}`)).status).toBe(401);
  });

  it('makes the host vote before the link goes out', async () => {
    expect((await browser(app)('GET', `/api/g/${token}`)).status).toBe(404); // not shared yet
    expect((await h('POST', `/api/meetups/${id}/share`, {})).body.error).toBe('vote_first');
    expect((await h('POST', `/api/meetups/${id}/vote`, { keys: ['pizza', 'ramen', 'tacos', 'bar'] })).status).toBe(422);
    await h('POST', `/api/meetups/${id}/vote`, { keys: ['pizza', 'ramen'] });
    expect((await h('POST', `/api/meetups/${id}/share`, { guestTheme: 'gold' })).status).toBe(402);
    expect((await h('POST', `/api/meetups/${id}/share`, {})).body.meetup.status).toBe('voting');
  });

  it('lets a guest join without an account and shows the code once', async () => {
    priya = browser(app);
    const view = (await priya('GET', `/api/g/${token}`)).body.meetup;
    expect(view.me).toBeNull();
    expect(JSON.stringify(view)).not.toContain('lat');
    const p = view.people.find((x: any) => x.name === 'Priya');
    const joined = await priya('POST', `/api/g/${token}/join`, { participantId: p.id });
    priyaCode = joined.body.code;
    expect(priyaCode).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);
    expect((await browser(app)('POST', `/api/g/${token}/join`, { participantId: p.id })).status).toBe(409); // name is taken now
    expect((await priya('POST', `/api/g/${token}/rsvp`, { rsvp: 'maybe' })).body.meetup.me.rsvp).toBe('maybe');
    // A typed start keeps its name, for Priya only; the host and the crew never see it.
    const set = (await priya('POST', `/api/g/${token}/location`, { lat: 1.3, lng: 103.86, label: 'Bugis MRT\u0007' })).body.meetup;
    expect(set.me).toMatchObject({ hasLocation: true, startLabel: 'Bugis MRT' });
    expect(JSON.stringify((await h('GET', `/api/meetups/${id}`)).body)).not.toContain('Bugis MRT');
    expect((await priya('POST', `/api/g/${token}/location`, { lat: 1.3, lng: 103.86, label: 'x'.repeat(81) })).status).toBe(422);
    expect((await priya('POST', `/api/g/${token}/categories`, { keys: ['pizza', 'ramen', 'tacos', 'bar'] })).status).toBe(422);
    expect((await priya('POST', `/api/g/${token}/categories`, { keys: ['pizza', 'tacos'] })).status).toBe(200);
  });

  it('needs the code to change a choice, and pauses the link after three wrong codes', async () => {
    // Just after joining, changes need no code for 30 minutes (so Back works on every step). Then they do.
    await (deps.db as any).query("update participants set amend_until = now() - interval '1 minute'");
    expect((await priya('POST', `/api/g/${token}/categories`, { keys: ['bar'] })).body.error).toBe('code_required');
    expect((await priya('POST', `/api/g/${token}/code`, { code: priyaCode })).status).toBe(200);
    expect((await priya('POST', `/api/g/${token}/categories`, { keys: ['pizza'] })).status).toBe(200);
    const stranger = browser(app);
    const tries = [];
    for (let i = 0; i < 4; i++) tries.push((await stranger('POST', `/api/g/${token}/code`, { code: '2222' })).status);
    expect(tries).toEqual([401, 401, 429, 429]);
    await (deps.db as any).query('delete from throttles');
  });

  it('pauses code entry for the whole meetup when wrong codes keep coming from different networks', async () => {
    const guess = (ip: string) => app.request(`/api/g/${token}/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zorion': '1', origin: env.APP_ORIGIN, 'cf-connecting-ip': ip },
      body: JSON.stringify({ code: '2222' }),
    });
    const statuses = [];
    for (let i = 0; i < 21; i++) statuses.push((await guess(`203.0.113.${i}`)).status);
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
    await (deps.db as any).query('delete from throttles');
  });

  it('a new browser needs only the code', async () => {
    const phone2 = browser(app);
    const r = await phone2('POST', `/api/g/${token}/code`, { code: priyaCode.toLowerCase() });
    expect(r.body.meetup.me.name).toBe('Priya');
  });

  it('waits for votes or a skip, then finds the middle and the closest places', async () => {
    const dev = browser(app);
    const devId = (await dev('GET', `/api/g/${token}`)).body.meetup.people.find((x: any) => x.name === 'Dev').id;
    await dev('POST', `/api/g/${token}/join`, { participantId: devId });
    await dev('POST', `/api/g/${token}/rsvp`, { rsvp: 'going' });
    await dev('POST', `/api/g/${token}/location`, { lat: 1.3, lng: 103.84 });
    expect((await h('POST', `/api/meetups/${id}/location`, { lat: 1.3, lng: 103.85, label: 'Rochor' })).body.meetup.startLabel).toBe('Rochor');
    expect((await h('POST', `/api/meetups/${id}/location`, { lat: 1.3, lng: 103.85 })).body.meetup).toMatchObject({ hasLocation: true, startLabel: null }); // GPS has no name
    expect((await h('POST', `/api/meetups/${id}/middle`, {})).body.error).toBe('waiting');
    expect((await h('POST', `/api/meetups/${id}/people/${devId}/skip`, {})).body.meetup.waiting).toEqual([]);
    const mid = await h('POST', `/api/meetups/${id}/middle`, {});
    expect(mid.body.meetup.status).toBe('places');
    expect(mid.body.meetup.winner).toBe('pizza');
    expect(mid.body.meetup.places).toHaveLength(8);
    expect(mid.body.meetup.maxShortlist).toBe(4);
    expect(mid.body.meetup.middle.lng).toBeCloseTo(103.85, 2);
  });

  it('host shortlists, votes first, guests vote for one, a maybe becomes going', async () => {
    const places = (await h('GET', `/api/meetups/${id}`)).body.meetup.places;
    const ids = places.slice(0, 3).map((p: any) => p.id);
    expect((await h('POST', `/api/meetups/${id}/shortlist`, { ids })).body.error).toBe('vote_first');
    expect((await h('POST', `/api/meetups/${id}/shortlist`, { ids, hostPick: ids[0] })).body.meetup.status).toBe('place_vote');
    const view = (await priya('GET', `/api/g/${token}`)).body.meetup;
    expect(view.places).toHaveLength(3);
    expect(view.places[0].myMinutes).toBeGreaterThan(0);
    expect(view.places[0].lat).toBeUndefined();
    const voted = await priya('POST', `/api/g/${token}/place`, { id: ids[1] });
    expect(voted.body.meetup.me.rsvp).toBe('going');
    const locked = await h('POST', `/api/meetups/${id}/lock`, {});
    expect(locked.body.error).toBe('tie');
    expect((await h('POST', `/api/meetups/${id}/lock`, { id: ids[0] })).body.meetup.status).toBe('confirmed');
  });

  it('after confirming: guests see where to go, changes need the code and reach the host', async () => {
    const view = (await priya('GET', `/api/g/${token}`)).body.meetup;
    expect(view.places).toHaveLength(1);
    expect(view.places[0].directions).toContain('travelmode=walking');
    await deps.db!.query('update participants set amend_until = null'); // the 10-minute change window has passed
    expect((await priya('POST', `/api/g/${token}/rsvp`, { rsvp: 'no' })).body.error).toBe('code_required');
    await priya('POST', `/api/g/${token}/code`, { code: priyaCode });
    expect((await priya('POST', `/api/g/${token}/rsvp`, { rsvp: 'no' })).status).toBe(200);
    // Everything but the reply is fixed now, even with the code accepted.
    const fixed = [
      await priya('POST', `/api/g/${token}/location`, { lat: 1.31, lng: 103.87 }),
      await priya('POST', `/api/g/${token}/place`, { id: view.places[0].id }),
      await priya('POST', `/api/g/${token}/categories`, { keys: ['ramen'] }),
      await priya('POST', `/api/g/${token}/dates`, { ids: [], none: true }),
      await priya('POST', `/api/g/${token}/start-search`, { q: 'Bugis MRT' }),
    ];
    expect(fixed.map((r) => [r.status, r.body.error])).toEqual(Array(5).fill([409, 'confirmed']));
    const hostView = (await h('GET', `/api/meetups/${id}`)).body.meetup;
    expect(hostView.unseenChanges).toBe(1); // only the reply change reached the host
    // Someone who can't go is no longer counted among the people a vote is waiting for.
    const after = (await priya('GET', `/api/g/${token}`)).body.meetup;
    expect(after.progress.total).toBe(hostView.people.filter((p: any) => p.rsvp !== 'no').length);
    expect(after.progress.total).toBeLessThan(hostView.people.length);
    expect((await h('GET', `/api/meetups/${id}/changes`)).body.changes[0].detail).toBe("Reply: going to can't go");
  });

  it('a new date keeps replies unless the host clears them', async () => {
    const kept = await h('PATCH', `/api/meetups/${id}`, { startsAt: '2026-11-14T11:30:00.000Z' });
    expect(kept.body.meetup.people.find((p: any) => p.name === 'Priya').rsvp).toBe('no');
    expect((await priya('GET', `/api/g/${token}`)).body.meetup.dateChange.replies).toBe('kept');
    const cleared = await h('PATCH', `/api/meetups/${id}`, { startsAt: '2026-11-15T11:30:00.000Z', clearReplies: true });
    expect(cleared.body.meetup.people.find((p: any) => p.name === 'Priya').rsvp).toBe('none');
    expect(cleared.body.meetup.people.find((p: any) => p.isHost).rsvp).toBe('going');
  });

  it('one shortlisted place means no vote', async () => {
    const b = browser(app);
    await signIn(b, 'solo@example.com');
    const m = (await b('POST', '/api/meetups', { name: 'Quick bite', timeZone: 'UTC', startsAt: '2026-11-20T12:00:00.000Z', ballot: [{ key: 'pizza' }], invitees: [] })).body.meetup;
    expect(m.maxVotes).toBe(0);
    await b('POST', `/api/meetups/${m.id}/share`, {});
    await b('POST', `/api/meetups/${m.id}/location`, { lat: 1.3, lng: 103.85 });
    const mid = (await b('POST', `/api/meetups/${m.id}/middle`, {})).body.meetup;
    const done = await b('POST', `/api/meetups/${m.id}/shortlist`, { ids: [mid.places[0].id] });
    expect(done.body.meetup.status).toBe('confirmed');
    expect(done.body.meetup.chosenPlace).toBe(mid.places[0].id);
  });
});

describe('a meetup with a date vote', () => {
  it('counts only people who can make the set date, and defaults them to going', async () => {
    const h = browser(app);
    await signIn(h, 'dates@example.com');
    const made = (await h('POST', '/api/meetups', {
      name: 'Weekend', timeZone: 'UTC', startsAt: null, dateOptions: ['2026-11-21T11:00:00.000Z', '2026-11-22T04:30:00.000Z'],
      ballot: [{ key: 'pizza' }, { key: 'ramen' }], invitees: ['Leo', 'Sofia'],
    })).body.meetup;
    const token = made.link.split('/j/')[1];
    await h('POST', `/api/meetups/${made.id}/vote`, { keys: ['pizza'] });
    expect((await h('POST', `/api/meetups/${made.id}/share`, {})).body.meetup.status).toBe('date_vote');
    const [d1, d2] = made.dates.map((d: any) => d.id);

    const leo = browser(app);
    const sofia = browser(app);
    const people = (await leo('GET', `/api/g/${token}`)).body.meetup.people;
    await leo('POST', `/api/g/${token}/join`, { participantId: people.find((p: any) => p.name === 'Leo').id });
    await sofia('POST', `/api/g/${token}/join`, { participantId: people.find((p: any) => p.name === 'Sofia').id });
    expect((await leo('POST', `/api/g/${token}/rsvp`, { rsvp: 'going' })).body.error).toBe('not_yet');
    await leo('POST', `/api/g/${token}/dates`, { ids: [d1] });
    await sofia('POST', `/api/g/${token}/dates`, { ids: [d2] });
    await leo('POST', `/api/g/${token}/categories`, { keys: ['ramen'] });
    await sofia('POST', `/api/g/${token}/categories`, { keys: ['ramen'] });

    const before = (await h('GET', `/api/meetups/${made.id}`)).body.meetup;
    expect(before.dates.map((d: any) => d.votes)).toEqual([2, 2]); // the host counts as free for every date offered
    const set = (await h('POST', `/api/meetups/${made.id}/date`, { id: d1 })).body.meetup;
    expect(set.status).toBe('voting');
    expect(set.people.find((p: any) => p.name === 'Leo')).toMatchObject({ rsvp: 'going', rsvpIsDefault: true });
    expect(set.people.find((p: any) => p.name === 'Sofia').rsvp).toBe('none');
    // Pizza (host) 1, ramen (Leo) 1: Sofia cannot make the date, so her ramen vote does not count. It is a tie.
    expect(set.categoryTally).toEqual([{ key: 'pizza', votes: 1 }, { key: 'ramen', votes: 1 }]);

    // A late joiner skips the date vote.
    const kai = browser(app);
    const late = await kai('POST', `/api/g/${token}/join`, { name: 'Kai' });
    expect(late.body.meetup.me.joinedLate).toBe(true);
    expect((await kai('POST', `/api/g/${token}/dates`, { ids: [d1] })).body.error).toBe('closed');
  });
});

describe('housekeeping', () => {
  it('ends old meetups and deletes locations', async () => {
    const db = deps.db!;
    await db.query("update meetups set starts_at = now() - interval '2 days'");
    await cleanUp(db);
    expect((await db.query("select count(*)::int as n from meetups where status <> 'ended'"))[0]!.n).toBe(0);
    expect((await db.query('select count(*)::int as n from participants where lat is not null or start_label is not null'))[0]!.n).toBe(0);
  });

  it('also ends a meetup that never got a date, 30 days after its last change', async () => {
    const db = deps.db!;
    const h2 = browser(app);
    await signIn(h2, 'nodate@example.com');
    const made = await h2('POST', '/api/meetups', { name: 'No date yet', timeZone: 'Asia/Singapore', startsAt: null, dateOptions: ['2027-01-10T12:00:00.000Z', '2027-01-11T12:00:00.000Z'], invitees: ['Zed'], ballot: [{ key: 'pizza' }, { key: 'ramen' }] });
    if (made.status !== 200) throw new Error(JSON.stringify(made.body));
    expect(made.status).toBe(200);
    const mid = made.body.meetup.id;
    await h2('POST', `/api/meetups/${mid}/location`, { lat: 1.3, lng: 103.84 });
    await cleanUp(db);
    expect((await db.query('select status from meetups where id = $1', [mid]))[0]!.status).not.toBe('ended');
    await db.query("update meetups set updated_at = now() - interval '31 days' where id = $1", [mid]);
    await cleanUp(db);
    expect((await db.query('select status from meetups where id = $1', [mid]))[0]!.status).toBe('ended');
    expect((await db.query('select count(*)::int as n from participants where meetup_id = $1 and lat is not null', [mid]))[0]!.n).toBe(0);
  });

  it('runs housekeeping at most once an hour, without a scheduler', async () => {
    const db = deps.db!;
    const d = deps as Deps;
    await db.query("delete from throttles where key = 'maintenance'");
    expect(await maintain(d)).toBe(true);
    expect(await maintain(d)).toBe(false);
    await db.query("update throttles set window_start = now() - interval '61 minutes' where key = 'maintenance'");
    expect(await maintain(d)).toBe(true);
    expect(await maintain(d)).toBe(false);
  });

  it('answers a health check', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('sends legal links to the landing site', async () => {
    const res = await app.request('/api/legal/privacy');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:5174/privacy');
    expect((await app.request('/api/legal/https:%2F%2Fevil.example')).status).toBe(404);
  });

  it('checks Stripe signatures and their age', async () => {
    const now = new Date('2026-11-13T00:00:00Z');
    const t = Math.floor(now.getTime() / 1000);
    const sig = `t=${t},v1=${await hmac('whsec', `${t}.{}`)}`;
    expect(await verifyStripeSignature('{}', sig, 'whsec', now)).toBe(true);
    expect(await verifyStripeSignature('{"x":1}', sig, 'whsec', now)).toBe(false);
    expect(await verifyStripeSignature('{}', sig, 'whsec', new Date(now.getTime() + 10 * 60_000))).toBe(false);
  });
});

describe('plans and settings from the admin portal', () => {
  it('enforces what the Free plan includes, as set by an admin', async () => {
    const db = deps.db!;
    const b = browser(app);
    await signIn(b, 'planner@example.com');
    await db.query("insert into settings (key, value) values ('plans', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ free: { groupSize: 3, travel: ['walk'], goldTheme: false, activeMeetups: 1 }, price: { monthly: 490, yearly: 4900 } })]);
    const base = { name: 'Plan check', timeZone: 'Asia/Singapore', startsAt: '2027-01-10T12:00:00.000Z', dateOptions: [], ballot: [{ key: 'pizza' }, { key: 'ramen' }] };
    expect((await b('POST', '/api/meetups', { ...base, invitees: ['A', 'B', 'C'] })).body.error).toBe('upgrade');
    expect((await b('POST', '/api/meetups', { ...base, invitees: ['A'], travelMode: 'transit' })).body.error).toBe('upgrade');
    expect((await b('POST', '/api/meetups', { ...base, invitees: ['A'] })).status).toBe(200);
    expect((await b('POST', '/api/meetups', { ...base, invitees: ['A'] })).body.message).toContain('1 meetup at a time');
    expect((await b('PATCH', '/api/account', { theme: 'gold' })).body.error).toBe('upgrade');
    expect((await b('GET', '/api/auth/me')).body.features).toMatchObject({ groupSize: 3, goldTheme: false });
    expect((await (await app.request('/api/config')).json() as any).plans.price.monthly).toBe(490);
    await db.query("delete from settings where key = 'plans'");
  });

  it('prices checkout from the admin setting and uses keys saved in the portal', async () => {
    const db = deps.db!;
    const seen: string[] = [];
    const stripeFetch = (async (url: string, init?: RequestInit) => {
      seen.push(`${(init?.headers as Record<string, string>).authorization} ${init?.body}`);
      return Response.json({ url: 'https://checkout.stripe.com/c/pay/x' });
    }) as unknown as typeof fetch;
    const { saveSetting } = await import('@zorion/server/settings');
    await saveSetting(db, env.TOTP_KEY, 'STRIPE_SECRET_KEY', ['sk', 'test', 'fromtheportal1234'].join('_'));
    await db.query("insert into settings (key, value) values ('plans', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ price: { monthly: 490, yearly: 4900 } })]);
    const app2 = createApp({ ...deps, fetch: stripeFetch, outbox: [] });
    const b = browser(app2);
    await b('POST', '/api/auth/email-code', { email: 'buyer@example.com' });
    // The outbox is per app here, so read the code from the second app's sign-in email.
    const code = (await (await app2.request('/api/dev/outbox')).json() as any).outbox.at(-1).text.match(/\d{6}/)[0];
    await b('POST', '/api/auth/email-code/verify', { email: 'buyer@example.com', code });
    expect((await b('POST', '/api/billing/checkout', { period: 'yearly' })).body.url).toContain('checkout.stripe.com');
    expect(seen.at(-1)).toContain(`Bearer ${['sk', 'test', 'fromtheportal1234'].join('_')}`);
    expect(decodeURIComponent(seen.at(-1)!)).toContain('[unit_amount]=4900');
    expect(decodeURIComponent(seen.at(-1)!)).toContain('[recurring][interval]=year');
    await db.query("delete from settings where key in ('plans', 'env:STRIPE_SECRET_KEY')");
  });
});

describe('email in production', () => {
  it('says plainly when Resend refuses, records why for the admin portal, and tidies pasted keys', async () => {
    const db = await testDb();
    const seen: Array<{ auth: string; from: string }> = [];
    const resend = (async (url: string, init: RequestInit) => {
      expect(String(url)).toBe('https://api.resend.com/emails');
      const headers = init.headers as Record<string, string>;
      seen.push({ auth: headers.authorization!, from: JSON.parse(String(init.body)).from });
      return Response.json({ statusCode: 403, name: 'validation_error', message: 'The app.midnightpoetry.studio domain is not verified.' }, { status: 403 });
    }) as unknown as typeof fetch;
    // A key pasted with a trailing line break, and a sender pasted with quotes around it.
    const prod: Env = { ...env, ENVIRONMENT: 'production', RESEND_API_KEY: ['re', 'abcdefghijklmnopqrstuvwx\n'].join('_'), EMAIL_FROM: '"Zorion <noreply@app.midnightpoetry.studio>"' };
    const b = browser(createApp({ db, env: prod, fetch: resend, now: () => clock, outbox: [] }));
    const res = await b('POST', '/api/auth/email-code', { email: 'someone@example.com' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'email_failed', message: "We couldn't send the email. Please try again in a few minutes." });
    expect(seen[0]).toEqual({ auth: `Bearer ${['re', 'abcdefghijklmnopqrstuvwx'].join('_')}`, from: 'Zorion <noreply@app.midnightpoetry.studio>' });
    const [row] = await db.query("select value from settings where key = 'email_status'");
    expect(row!.value).toMatchObject({ ok: false, key: 'worker', from: 'Zorion <noreply@app.midnightpoetry.studio>', reason: 'Resend 403: The app.midnightpoetry.studio domain is not verified.' });
    expect(JSON.stringify(row!.value)).not.toContain('someone@example.com');
    expect(JSON.stringify(row!.value)).not.toContain('abcdefgh');
  });

  it('records a success, and a missing key as a reason rather than a crash', async () => {
    const db = await testDb();
    const ok = (async () => Response.json({ id: 'x' })) as unknown as typeof fetch;
    const prod: Env = { ...env, ENVIRONMENT: 'production', RESEND_API_KEY: ['re', 'abcdefghijklmnopqrstuvwx'].join('_') };
    expect((await browser(createApp({ db, env: prod, fetch: ok, now: () => clock, outbox: [] }))('POST', '/api/auth/email-code', { email: 'a@example.com' })).status).toBe(200);
    expect((await db.query("select value from settings where key = 'email_status'"))[0]!.value).toMatchObject({ ok: true, from: 'Zorion <noreply@app.midnightpoetry.studio>' });
    const none: Env = { ...env, ENVIRONMENT: 'production' };
    expect((await browser(createApp({ db, env: none, fetch: ok, now: () => clock, outbox: [] }))('POST', '/api/auth/email-code', { email: 'b@example.com' })).status).toBe(503);
    expect((await db.query("select value from settings where key = 'email_status'"))[0]!.value).toMatchObject({ ok: false, key: 'none', reason: expect.stringContaining('No Resend key') });
  });
});

describe('outside calls', () => {
  it('calls fetch the way Workers requires, never as a method of deps (Illegal invocation)', async () => {
    const db = await testDb();
    // Like the Workers runtime: refuse to run when called with an object as `this`.
    const strict = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
      return Promise.resolve(Response.json({ id: 'x' }));
    } as unknown as typeof fetch;
    const prod: Env = { ...env, ENVIRONMENT: 'production', RESEND_API_KEY: ['re', 'abcdefghijklmnopqrstuvwx'].join('_') };
    const res = await browser(createApp({ db, env: prod, fetch: strict, now: () => clock, outbox: [] }))('POST', '/api/auth/email-code', { email: 'a@example.com' });
    expect(res.status).toBe(200);
  });
});
