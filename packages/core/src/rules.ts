/**
 * Zorion rules engine. Pure functions only: the API, the app and the tests all
 * take their rules from here so they cannot drift apart.
 */

export const LIMITS = {
  meetupName: 25,
  inviteeName: 10,
  categoryName: 12,
  ballotMax: 6,
  dateOptionsMax: 5,
  placesShownMin: 5,
  placesShownMax: 8,
  guestCodeLength: 4,
  guestCodeTries: 3,
  guestCodeTriesPerMeetup: 20, // wrong codes across every device, per lock window
  guestCodeLockMinutes: 10,
  emailCodeMinutes: 10,
  emailCodeTries: 5,
  signInLockMinutes: 15,
} as const;

export type Rsvp = 'none' | 'going' | 'maybe' | 'no';
export type Plan = 'free' | 'pro';
export type TravelMode = 'walk' | 'transit' | 'cycle';
export type MeetupStatus =
  | 'draft' // host is still setting up
  | 'date_vote' // link sent, guests vote on date and food
  | 'voting' // date is set, food votes open
  | 'places' // category decided, host is shortlisting
  | 'place_vote' // more than one place shortlisted
  | 'confirmed' // place locked in
  | 'ended';

/** Half the list, rounded up. Used for category votes and for the shortlist. */
export function halfRoundedUp(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('count must be a non-negative integer');
  return Math.ceil(n / 2);
}

/** How many categories one voter may pick. A ballot of one means there is no vote. */
export function maxCategoryVotes(ballotSize: number): number {
  if (ballotSize < 1 || ballotSize > LIMITS.ballotMax) throw new RangeError('ballot must hold 1 to 6 categories');
  return ballotSize === 1 ? 0 : halfRoundedUp(ballotSize);
}

/** How many places the host may shortlist out of the places shown. */
export function maxShortlist(placesShown: number): number {
  if (placesShown < 1) throw new RangeError('no places to shortlist');
  return Math.max(1, halfRoundedUp(placesShown));
}

export interface TallyRow<K extends string = string> {
  key: K;
  votes: number;
}

/** Counts votes per key, most votes first. Ties keep the order of `keys`. */
export function tally<K extends string>(keys: readonly K[], votes: readonly K[]): TallyRow<K>[] {
  const counts = new Map<K, number>(keys.map((k) => [k, 0]));
  for (const v of votes) if (counts.has(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return keys
    .map((key, i) => ({ key, votes: counts.get(key) ?? 0, i }))
    .sort((a, b) => b.votes - a.votes || a.i - b.i)
    .map(({ key, votes: n }) => ({ key, votes: n }));
}

/** The leaders of a tally. More than one entry means a tie the host has to break. */
export function leaders<K extends string>(rows: readonly TallyRow<K>[]): K[] {
  const top = rows[0]?.votes ?? 0;
  return rows.filter((r) => r.votes === top).map((r) => r.key);
}

export interface Voter {
  id: string;
  rsvp: Rsvp;
  isHost: boolean;
  skipped: boolean;
  /** Date option ids this person can make. Empty when there is no date vote. */
  dates: readonly string[];
  categories: readonly string[];
  place: string | null;
}

/**
 * Category votes that count.
 * Fixed date: everyone who is going or maybe (and the host).
 * Date vote: only people who can make the date that was set, because replies come later.
 */
export function countedCategoryVotes(voters: readonly Voter[], setDateId: string | null): string[] {
  return voters
    .filter((v) => (setDateId ? v.isHost || v.dates.includes(setDateId) : v.isHost || v.rsvp === 'going' || v.rsvp === 'maybe'))
    .flatMap((v) => [...v.categories]);
}

/** People the host is still waiting on before the places can be worked out. */
export function waitingForCategoryVotes(voters: readonly Voter[], setDateId: string | null): string[] {
  return voters
    .filter((v) => !v.skipped && v.categories.length === 0)
    .filter((v) => (setDateId ? v.dates.includes(setDateId) : v.rsvp === 'going' || v.rsvp === 'maybe') || v.isHost)
    .map((v) => v.id);
}

/** Reply a guest starts with once the host sets a voted date. `null` means no default. */
export function defaultRsvpAfterDateSet(pickedDates: readonly string[], setDateId: string): Rsvp | null {
  return pickedDates.includes(setDateId) ? 'going' : null;
}

/** A maybe who votes for a place is treated as going. */
export function rsvpAfterPlaceVote(current: Rsvp): Rsvp {
  return current === 'maybe' || current === 'none' ? 'going' : current;
}

export function isOwnCategoryAllowed(plan: Plan): boolean {
  return plan === 'pro';
}

export function guestSeesAds(guestPlan: Plan | null): boolean {
  return guestPlan !== 'pro';
}

/** Trims, collapses spaces and enforces a length limit. Returns null when nothing is left. */
export function cleanName(raw: string, max: number): string | null {
  const s = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return [...s].slice(0, max).join('');
}

const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'bitch'];
/** Very small first line of defence for names that guests will see. The admin list extends it. */
export function isBlockedName(name: string, extra: readonly string[] = []): boolean {
  const flat = name.toLowerCase().replace(/[^a-z]/g, '');
  return [...BLOCKED, ...extra.map((w) => w.toLowerCase())].some((w) => w.length > 1 && flat.includes(w));
}

/** Icons a Pro host can pick for an own category. Fixed set: no uploads. */
export const OWN_ICONS = ['hotpot', 'coffee', 'burger', 'dessert', 'sushi', 'bbq', 'salad', 'cake', 'karaoke', 'games', 'movie', 'star'] as const;
export type OwnIcon = (typeof OWN_ICONS)[number];

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I
/** Short guest code from secure random bytes. */
export function makeGuestCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(LIMITS.guestCodeLength);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
export function normaliseGuestCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/I/g, '1');
  return s.length === LIMITS.guestCodeLength && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}
