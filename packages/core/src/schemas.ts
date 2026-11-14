import { z } from 'zod';
import { LIMITS, OWN_ICONS } from './rules';

const name = (max: number) => z.string().trim().min(1).max(max * 4); // cleaned and cut to `max` characters on the server

export const email = z.string().trim().toLowerCase().min(3).max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email');
export const sixDigits = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const password = z.string().min(10, 'Use at least 10 characters').max(128);
export const isoDate = z.string().datetime({ offset: true });
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
/** A starting point, with the place name when it was typed rather than shared from GPS. */
export const start = point.extend({ label: z.string().max(80).transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim()).optional() });
export const rsvp = z.enum(['going', 'maybe', 'no']);
export const travelMode = z.enum(['walk', 'transit', 'cycle']);
export const guestTheme = z.enum(['pink', 'gold']);

export const ballotItem = z.union([
  z.object({ key: z.string().regex(/^[a-z0-9_]{1,24}$/) }),
  z.object({ own: z.object({ name: name(LIMITS.categoryName), icon: z.enum(OWN_ICONS), save: z.boolean().default(true) }) }),
]);

export const createMeetup = z
  .object({
    name: name(LIMITS.meetupName),
    timeZone: z.string().min(1).max(64),
    startsAt: isoDate.nullable(),
    dateOptions: z.array(isoDate).max(LIMITS.dateOptionsMax).default([]),
    ballot: z.array(ballotItem).min(1).max(LIMITS.ballotMax),
    travelMode: travelMode.default('walk'),
    invitees: z.array(name(LIMITS.inviteeName)).max(60).default([]),
  })
  .refine((m) => (m.startsAt ? m.dateOptions.length === 0 : m.dateOptions.length >= 2), {
    message: 'Set one date, or offer at least two dates to vote on',
  });

export const updateMeetup = z.object({
  name: name(LIMITS.meetupName).optional(),
  startsAt: isoDate.optional(),
  clearReplies: z.boolean().default(false),
  guestTheme: guestTheme.optional(),
});

export const guestJoin = z.union([z.object({ participantId: uuid }), z.object({ name: name(LIMITS.inviteeName) })]);
export const guestCode = z.object({ code: z.string().min(4).max(8) });
export const keyList = z.object({ keys: z.array(z.string().min(1).max(40)).max(8) });
export const idList = z.object({ ids: z.array(uuid).max(8) });
export const oneId = z.object({ id: uuid });

export type CreateMeetup = z.infer<typeof createMeetup>;
export type UpdateMeetup = z.infer<typeof updateMeetup>;

/** Typed words for a starting place. */
export const startSearch = z.object({ q: z.string().trim().min(3).max(120) });
