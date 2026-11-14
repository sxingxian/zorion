# Build status

The product rules and screen designs live in the Zorion project on claude.ai ("Zorion build plan" and the mockup board). This file tracks what the code does today.

## Built

- **App** (`apps/app`): host sign-in with two-step, create a meetup with a fixed date or a date vote, people list, host-first voting, guest link with no account, guest codes, RSVP, fair middle, 5 to 8 closest places, shortlist and place vote, confirmation with directions, host edits (a new date keeps replies unless the host clears them), change log for the host, account, themes, light and dark, Pro checkout through Stripe, own categories for Pro, sponsored slots, hourly housekeeping that runs on normal traffic (no cron trigger). Phone, tablet and desktop layouts. Installable.
- **Site** (`apps/site`): landing page, admin portal (overview, categories and rules, sponsored and ads, users and plans, access and audit).
- **Shared**: rules engine (`packages/core`), database schema and migrations (`packages/db`), crypto (`packages/server`).

## Decisions taken

- Own sign-in in the Worker, with a customised second step.
- Places from OpenStreetMap or Google, switchable in the admin portal.
- Email through Resend.
- Two Workers: one for the app, one for the landing page and admin portal.

## Added after the first version

- Typing a starting place instead of sharing GPS.
- Routed trip times through Google's Routes API, switched on in the admin portal. The estimate is the default and the fallback.
- A three.js hero on the landing page, with the drawn map as fallback.
- Privacy and terms pages (drafts for review).
- Browser tests for the main flows (`npm run e2e`).

- Emails beyond sign-in codes: news for hosts, and opt-in updates for guests.
- Free routed trip times through an OSRM server or openrouteservice.
- Telegram as a second channel for the same updates as email, for hosts and guests.

## Not built yet

- Routed transit times without Google. No free service offers them as a matrix.
- Pro prices and group sizes are placeholders: prices come from Stripe, group sizes from the admin portal (8 free, 30 Pro by default).
