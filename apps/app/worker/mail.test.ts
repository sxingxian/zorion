import { beforeAll, describe, expect, it } from 'vitest';
import { testDb } from '@zorion/db/testing';
import type { Deps, Env } from './core';
import { cleanUp } from './extras';
import { createApp } from './index';

const env: Env = { DATABASE_URL: '', APP_ORIGIN: 'http://localhost:5173', SITE_ORIGIN: 'http://localhost:5174', PEPPER: 'test-pepper', TOTP_KEY: btoa('0123456789abcdef0123456789abcdef'), ENVIRONMENT: 'development' };

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

const fakeFetch = (async (url: string) => {
  if (String(url).includes('overpass')) return Response.json({ elements: Array.from({ length: 8 }, (_, i) => ({ type: 'node', id: i + 1, lat: 1.3, lon: 103.85 + i * 0.001, tags: { name: `Place ${i + 1}`, 'addr:street': 'Demo Street' } })) });
  throw new Error(`unexpected fetch ${url}`);
}) as unknown as typeof fetch;

let deps: Partial<Deps>;
let app: ReturnType<typeof createApp>;
let h: ReturnType<typeof browser>;
let priya: ReturnType<typeof browser>;
let dev: ReturnType<typeof browser>;
let id = '';
let token = '';
let stopLink = '';

/** Emails sent since the last look, then forgotten. */
const inbox = () => deps.outbox!.splice(0);
const g = (who: ReturnType<typeof browser>, path: string, json?: unknown) => who('POST', `/api/g/${token}${path}`, json);
async function join(name: string, ip: string) {
  const b = browser(app, ip);
  const view = (await b('GET', `/api/g/${token}`)).body.meetup;
  await g(b, '/join', { participantId: view.people.find((x: any) => x.name === name).id });
  return b;
}

beforeAll(async () => {
  deps = { db: await testDb(), env, fetch: fakeFetch, now: () => new Date('2026-11-13T04:00:00Z'), outbox: [] };
  app = createApp(deps);
  h = browser(app);
  await h('POST', '/api/auth/email-code', { email: 'maya@example.com' });
  await h('POST', '/api/auth/email-code/verify', { email: 'maya@example.com', code: inbox().at(-1)!.text.match(/\d{6}/)![0] });
  const made = await h('POST', '/api/meetups', { name: 'Midnight poetry party', timeZone: 'Asia/Singapore', startsAt: '2026-12-01T12:00:00.000Z', invitees: ['Priya', 'Dev'], ballot: [{ key: 'pizza' }, { key: 'ramen' }] });
  id = made.body.meetup.id;
  token = made.body.meetup.link.split('/j/')[1];
  await h('POST', `/api/meetups/${id}/vote`, { keys: ['pizza'] });
  await h('POST', `/api/meetups/${id}/share`, {});
  await h('POST', `/api/meetups/${id}/location`, { lat: 1.3, lng: 103.84 });
  priya = await join('Priya', '198.51.100.2');
  dev = await join('Dev', '198.51.100.3');
  inbox();
});

describe('email updates for a guest', () => {
  it('sends one confirmation and nothing else until the address is confirmed', async () => {
    expect((await g(priya, '/email', { email: 'not-an-email' })).status).toBe(422);
    const asked = await g(priya, '/email', { email: 'Priya@Example.com' });
    expect(asked.body.meetup.me.email).toEqual({ address: 'p•••@example.com', confirmed: false });
    const mail = inbox();
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe('priya@example.com');
    expect(mail[0]!.subject).toBe('Confirm email updates for Midnight poetry party');
    const t = mail[0]!.text.match(/\?confirm=(\S+)/)![1]!;

    // Nobody else can see the address, not the host and not another guest.
    expect(JSON.stringify((await h('GET', `/api/meetups/${id}`)).body)).not.toMatch(/example\.com(?!.*maya)|p•••/);
    expect(JSON.stringify((await dev('GET', `/api/g/${token}`)).body)).not.toMatch(/priya@|p•••/i);

    // The link works from any browser, a wrong one does not.
    const elsewhere = browser(app, '203.0.113.9');
    expect((await g(elsewhere, '/email/confirm', { t: `${t.split('.')[0]}.0000000000` })).status).toBe(404);
    expect((await g(elsewhere, '/email/confirm', { t })).body).toEqual({ ok: true, name: 'Priya' });
    expect((await priya('GET', `/api/g/${token}`)).body.meetup.me.email.confirmed).toBe(true);
  });

  it('allows three confirmation emails a day for one guest', async () => {
    await g(dev, '/email', { email: 'dev1@example.com' });
    await g(dev, '/email', { email: 'dev2@example.com' });
    expect((await g(dev, '/email', { email: 'dev3@example.com' })).status).toBe(200);
    expect((await g(dev, '/email', { email: 'dev4@example.com' })).status).toBe(429);
    expect(inbox()).toHaveLength(3);
    await g(dev, '/email/stop', {}); // Dev decides against it, from the meetup page
    expect((await dev('GET', `/api/g/${token}`)).body.meetup.me.email).toBeNull();
  });
});

describe('news for the host', () => {
  it('says once that the food votes are in, when the last person votes', async () => {
    for (const b of [priya, dev]) {
      await g(b, '/rsvp', { rsvp: 'going' });
      await g(b, '/location', { lat: 1.3, lng: 103.86 });
    }
    await g(priya, '/categories', { keys: ['pizza'] });
    expect(inbox()).toHaveLength(0); // Dev has not voted yet
    await g(dev, '/categories', { keys: ['ramen'] });
    const mail = inbox();
    expect(mail.map((m) => [m.to, m.subject])).toEqual([['maya@example.com', 'The food votes are in for Midnight poetry party']]);
    expect(mail[0]!.text).toContain(`http://localhost:5173/m/${id}`);
    await g(dev, '/categories', { keys: ['pizza'] }); // a change of mind inside the window
    expect(inbox()).toHaveLength(0);
  });
});

describe('the plan moving on', () => {
  it('tells confirmed guests when the place vote opens, and the host when it is complete', async () => {
    const places = (await h('POST', `/api/meetups/${id}/middle`, {})).body.meetup.places;
    await h('POST', `/api/meetups/${id}/shortlist`, { ids: [places[0].id, places[1].id], hostPick: places[0].id });
    const mail = inbox();
    expect(mail.map((m) => [m.to, m.subject])).toEqual([['priya@example.com', 'Vote for the place: Midnight poetry party']]); // Dev left no address
    expect(mail[0]!.text).toContain('Hi Priya,');
    stopLink = mail[0]!.text.match(/\?stop=(\S+)/)![1]!;

    await g(priya, '/place', { id: places[1].id });
    expect(inbox()).toHaveLength(0);
    await g(dev, '/place', { id: places[1].id });
    expect(inbox().map((m) => [m.to, m.subject])).toEqual([['maya@example.com', 'Everyone has voted for a place for Midnight poetry party']]);
  });

  it('tells confirmed guests when it is on, with the place and the time in the meetup\'s time zone', async () => {
    await h('POST', `/api/meetups/${id}/lock`, {});
    const mail = inbox();
    expect(mail.map((m) => [m.to, m.subject])).toEqual([['priya@example.com', 'It is on: Midnight poetry party']]);
    expect(mail[0]!.text).toContain('Place 2, Demo Street');
    expect(mail[0]!.text).toMatch(/Tue,? 1 Dec,? 8:00\s?pm/i); // 12:00 UTC is 8pm in Singapore
  });

  it('tells the host about a changed reply after confirmation, at most once an hour', async () => {
    await (deps.db as any).query("update participants set amend_until = now() + interval '10 minutes'");
    await g(dev, '/rsvp', { rsvp: 'maybe' });
    const mail = inbox();
    expect(mail.map((m) => [m.to, m.subject])).toEqual([['maya@example.com', 'A guest changed their reply for Midnight poetry party']]);
    expect(mail[0]!.text).toContain('Dev: Reply: going to maybe');
    await g(dev, '/rsvp', { rsvp: 'going' });
    expect(inbox()).toHaveLength(0);
  });

  it('tells confirmed guests about a new date, and stays quiet when only the name changes', async () => {
    await h('PATCH', `/api/meetups/${id}`, { name: 'Midnight poetry do' });
    expect(inbox()).toHaveLength(0);
    await h('PATCH', `/api/meetups/${id}`, { startsAt: '2026-12-02T12:00:00.000Z' });
    const mail = inbox();
    expect(mail.map((m) => m.to)).toEqual(['priya@example.com']);
    expect(mail[0]!.subject).toMatch(/^New date for Midnight poetry do: Wed,? 2 Dec/);
    expect(mail[0]!.text).toContain('Your reply still stands.');
  });
});

describe('switching emails off', () => {
  it('stops a guest\'s emails from the link in any of them, and forgets the address', async () => {
    expect((await g(browser(app, '203.0.113.9'), '/email/stop', { t: stopLink })).body).toEqual({ ok: true });
    expect((await priya('GET', `/api/g/${token}`)).body.meetup.me.email).toBeNull();
    expect(await (deps.db as any).query('select count(*)::int as n from participants where email is not null')).toEqual([{ n: 0 }]);
    await h('PATCH', `/api/meetups/${id}`, { startsAt: '2026-12-03T12:00:00.000Z' });
    expect(inbox()).toHaveLength(0);
    expect((await g(browser(app, '203.0.113.9'), '/email/confirm', { t: stopLink })).status).toBe(404); // the old link is dead
  });

  it('stops a host\'s emails from their account', async () => {
    expect((await h('PATCH', '/api/account', { notify: false })).body.user.notify).toBe(false);
    await (deps.db as any).query('delete from notices');
    await (deps.db as any).query("update participants set amend_until = now() + interval '10 minutes'");
    await g(dev, '/rsvp', { rsvp: 'maybe' });
    expect(inbox()).toHaveLength(0);
  });

  it('erases guest addresses when the meetup ends', async () => {
    await (deps.db as any).query("update participants set email = 'late@example.com', email_confirmed = true where name = 'Dev'");
    await (deps.db as any).query("update meetups set starts_at = now() - interval '2 days'");
    await cleanUp(deps.db!);
    expect(await (deps.db as any).query('select count(*)::int as n from participants where email is not null')).toEqual([{ n: 0 }]);
  });
});
