# Security notes

What Zorion protects, how, and what is still open. Report a problem privately to the repository owner; do not open a public issue.

## What is sensitive

- Where people are. A guest's position is used to work out the fair middle and each person's travel time.
- Host accounts: email, password, authenticator key.
- The admin portal.

Card details never reach Zorion. Checkout and the customer portal are Stripe's own pages.

## Locations

- A person's coordinates are never sent to anyone else, including the host. Other screens get travel minutes only, and the drawn map places people on a ring by travel time.
- Maps are drawn in the app. No ad network ever receives a position. The places search receives only the middle point.
- Typing a place instead of sharing GPS: the typed words are looked up from Zorion's server, on a button press, so the map service sees neither the person's network address nor their name. Lookups are limited to 15 per network per ten minutes.
- Routed trip times are off by default. When an admin switches them on, starting points and candidate places are sent to the chosen routing service (an OSRM server, openrouteservice or Google) with no names attached. This is the one case where a position leaves Zorion, and the privacy page says so.
- Coordinates are erased when the meetup ends: 24 hours after its start, or 30 days after its last change if it never got a date. The meetup itself is deleted 90 days after that.

## Host sign-in

- Built in the Worker with WebCrypto only. No third-party identity provider.
- Email plus a 6-digit code, or email plus password, or an authenticator first. With two-step on, the last step must be a different kind of proof from the first.
- Passwords: PBKDF2-SHA256, 100,000 rounds, per-user salt, keyed with a server-side pepper. 100,000 is the most Cloudflare Workers allow; the pepper means a stolen database alone cannot be cracked offline.
- Authenticator keys are stored encrypted (AES-GCM). A used code cannot be used twice.
- Email codes, session tokens, recovery codes and guest codes are stored only as keyed hashes.
- Sessions are random tokens in `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookies.
- Five wrong codes or passwords pause sign-in for that account and network.
- Sign-in emails are limited to 5 per address and 20 per network in 15 minutes, so the form cannot be used to flood inboxes.
- Asking for a sign-in code answers the same way whether or not the email has an account.

## Guests

- No account. The link carries a random 128-bit token.
- A 4-character code identifies a guest on a new browser and is required to change any choice. Once the plan is confirmed, the server accepts only a change of reply; dates, food votes, place votes and starting points are refused.
- Three wrong tries pause code entry for that network for 10 minutes, and 20 wrong tries pause it for the whole meetup, so changing network does not help a guesser.
- The host can reset a guest's code. The host never sees it.

## Emails to guests

- Off unless a guest asks. The address is used only after the guest confirms it from their own inbox, so nobody can sign another person up for more than one confirmation email.
- Confirmation emails are limited to 3 a day per guest and 10 an hour per network.
- The address is never sent to the host or to other guests. It is erased when the guest stops the emails or when the meetup ends.
- Confirm and stop links carry a keyed code derived from the guest and the address. Nothing extra is stored, and the link dies when the address changes.
- Emails are sent after the response has gone out, so a slow or failing mail service never blocks a vote.

## Requests

- Every state-changing request must carry the `X-Zorion` header and come from the app's own origin, which browsers do not allow other sites to do.
- All input is validated with strict schemas. All SQL uses parameters. Own category names are reduced to letters, digits and spaces before they are used in a places search.
- Strict Content-Security-Policy on the app: scripts, styles, fonts and requests from the app's own origin only, no framing. The landing page additionally allows Google's ad hosts.
- API responses are never cached. The service worker never caches `/api`.

## Admin portal

- Password and authenticator, always both. No email sign-in, no recovery by email.
- Signed out after 30 idle minutes. Five wrong tries pause sign-in for 30 minutes.
- Support admins see masked emails and cannot change rules.
- Suspending or deleting a host and every ads change need a second admin to approve, once there are two admins.
- Every sign-in and change is written to an audit log.
- Admins are created from the command line only.

## Payments

- Stripe webhooks are verified by signature and timestamp, and each event is handled once.
- A plan changes only on a verified webhook, never on what the browser says.

## Known limits and open items

- Rate limits are kept in the database. Add Cloudflare rate limiting rules in front for volume attacks (see SETUP.md).
- A 4-character guest code is short by design. It is safe only together with the secret link and the limits above; do not reuse the pattern for anything more valuable than a meetup reply.
- Travel times are estimates from straight-line distance unless routed times are switched on. The fair middle itself is always worked out from distance.
- Browser tests cover the main flows against the local demo with made-up places. Real email, Stripe, OpenStreetMap and Google calls are only tested against fakes.
- No independent security review or penetration test has been done. Do one before handling real users at scale.
- The privacy and terms pages are drafts. They need a contact address and a legal review before launch (see SETUP.md).
