// Emails beyond sign-in codes: news for the host, and opt-in updates for guests.
import type { Row } from '@zorion/db';
import { one } from '@zorion/db';
import type { C, Deps } from './core';
import { sendEmail } from './core';
import { hmac, safeEqual } from './crypto';
import { type Loaded, load, summarise } from './meetups';

/** Sends after the response has gone out where the platform allows it, so nobody waits on an email. */
export function later(c: C, work: Promise<unknown>): Promise<void> | void {
  const safe = work.catch((err) => console.error('email not sent', err instanceof Error ? err.message : err));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    return safe.then(() => undefined); // no execution context (tests, the local demo): finish it now
  }
}

const whenText = (iso: string | null, timeZone: string): string => {
  if (!iso) return 'date to be set';
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
};

/** True the first time a notice of this kind is claimed for a meetup, or again once `everyMinutes` has passed. */
async function claim(deps: Deps, meetupId: string, kind: string, everyMinutes?: number): Promise<boolean> {
  const row = everyMinutes
    ? await one(deps.db, `insert into notices (meetup_id, kind) values ($1, $2) on conflict (meetup_id, kind) do update set sent_at = now()
        where notices.sent_at < now() - make_interval(mins => $3::int) returning kind`, [meetupId, kind, everyMinutes])
    : await one(deps.db, 'insert into notices (meetup_id, kind) values ($1, $2) on conflict (meetup_id, kind) do nothing returning kind', [meetupId, kind]);
  return !!row;
}

// ---------- to the host ----------

export type GuestEvent = 'dates' | 'categories' | 'place' | 'change';

/**
 * Called after a guest acts. Tells the host only when it changes what the host can do next:
 * a vote is complete, or a guest changed their reply after the plan was confirmed (the only change still allowed).
 */
export async function tellHost(deps: Deps, meetupId: string, event: GuestEvent, detail = ''): Promise<void> {
  const L = await load(deps.db, { id: meetupId });
  if (!L) return;
  const host = await one(deps.db, "select email, notify from users where id = $1 and status = 'active'", [L.m.host_id]);
  if (!host?.notify) return;
  const s = summarise(L);
  const guests = L.people.filter((p) => !p.is_host);
  const manage = `${deps.env.APP_ORIGIN}/m/${L.m.id}`;
  let kind = '';
  let subject = '';
  let lines: string[] = [];
  if (event === 'dates' && L.m.status === 'date_vote' && guests.length > 0 && guests.every((p) => p.dates.length > 0 || p.no_date_works)) {
    kind = 'dates_in';
    subject = `Everyone has answered the date vote for ${L.m.name}`;
    lines = ['All your guests have ticked the dates they can make.', `Set the date: ${manage}`];
  } else if (event === 'categories' && L.m.status === 'voting' && s.waiting.length === 0 && guests.some((p) => p.categories.length > 0)) {
    kind = 'votes_in';
    subject = `The food votes are in for ${L.m.name}`;
    lines = ['Everyone going or maybe has voted.', `Find the middle: ${manage}`];
  } else if (event === 'place' && L.m.status === 'place_vote') {
    const voters = L.people.filter((p) => p.is_host || p.rsvp === 'going' || p.rsvp === 'maybe');
    if (voters.every((p) => p.place)) {
      kind = 'places_in';
      subject = `Everyone has voted for a place for ${L.m.name}`;
      lines = ['The final vote is complete.', `Lock in the place: ${manage}`];
    }
  } else if (event === 'change' && L.m.status === 'confirmed') {
    // At most one of these an hour per meetup, however many changes arrive.
    if (!(await claim(deps, L.m.id, 'change', 60))) return;
    await sendEmail(deps, host.email, `A guest changed their reply for ${L.m.name}`, [detail || 'A guest changed their reply after the plan was confirmed.', `See what changed: ${manage}/changes`, '', footer(deps)].join('\n'));
    return;
  }
  if (!kind || !(await claim(deps, L.m.id, kind))) return;
  await sendEmail(deps, host.email, subject, [...lines, '', footer(deps)].join('\n'));
}

const footer = (deps: Deps): string => `You get these because you host on Zorion. Switch them off under Account: ${deps.env.APP_ORIGIN}/account`;

// ---------- to guests who asked ----------

/** The link token for a guest's address. Made from a server secret, so nothing extra is stored and it dies with the address. */
export async function emailToken(deps: Deps, p: Row): Promise<string> {
  return `${p.id}.${(await hmac(deps.env.PEPPER, `guest-email:${p.id}:${p.email}`)).slice(0, 32)}`;
}
/** Finds the guest a confirm or stop link belongs to, or null. */
export async function guestForToken(deps: Deps, L: Loaded, token: string): Promise<Row | null> {
  const [id] = token.split('.');
  const p = L.people.find((x) => x.id === id && x.email && !x.is_host);
  return p && safeEqual(await emailToken(deps, p), token) ? p : null;
}

export async function sendConfirmation(deps: Deps, L: Loaded, p: Row): Promise<void> {
  const link = `${deps.env.APP_ORIGIN}/j/${L.m.link_token}?confirm=${await emailToken(deps, p)}`;
  await sendEmail(deps, p.email, `Confirm email updates for ${L.m.name}`, [
    `Someone, hopefully you, asked Zorion to email this address about the meetup "${L.m.name}".`,
    `Confirm: ${link}`,
    '',
    'If that was not you, ignore this email. Nothing more will be sent.',
  ].join('\n'));
}

export type HostEvent = 'date_set' | 'place_vote' | 'confirmed' | 'date_moved' | 'date_moved_cleared';

/** Called after the host moves the meetup on. Goes only to guests who confirmed an address. */
export async function tellGuests(deps: Deps, meetupId: string, event: HostEvent): Promise<void> {
  const L = await load(deps.db, { id: meetupId });
  if (!L) return;
  const to = L.people.filter((p) => !p.is_host && p.email && p.email_confirmed && (p.rsvp !== 'no' || event.startsWith('date_moved')));
  if (to.length === 0) return;
  const link = `${deps.env.APP_ORIGIN}/j/${L.m.link_token}`;
  const when = whenText(L.m.starts_at, L.m.time_zone);
  const place = L.places.find((p) => p.id === L.m.chosen_place);
  const say: Record<HostEvent, [subject: string, lines: string[]]> = {
    date_set: [`${L.m.name} is on ${when}`, ['The date is set.', `Reply and see the plan: ${link}`]],
    place_vote: [`Vote for the place: ${L.m.name}`, ['The shortlist is ready. Pick the place you would like.', `Vote: ${link}`]],
    confirmed: [`It is on: ${L.m.name}`, [`${place?.name ?? 'The place is set'}${place?.address ? `, ${place.address}` : ''}`, when, `Directions and the plan: ${link}`]],
    date_moved: [`New date for ${L.m.name}: ${when}`, ['The host moved the date. Your reply still stands.', `Change it if you need to: ${link}`]],
    date_moved_cleared: [`New date for ${L.m.name}: ${when}`, ['The host moved the date and is asking everyone to reply again.', `Reply: ${link}`]],
  };
  const [subject, lines] = say[event];
  await Promise.allSettled(to.map(async (p) => sendEmail(deps, p.email, subject, [`Hi ${p.name},`, '', ...lines, '', `You asked for updates about this meetup. Stop them: ${link}?stop=${await emailToken(deps, p)}`].join('\n'))));
}
