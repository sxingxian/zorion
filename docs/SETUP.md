# Setting up Zorion

Everything below is done once. Commands run from the repository root unless a step says otherwise.

## 0. Try it first, with no accounts

```
npm install
npm run build
npm run demo
```

This serves the app on http://localhost:5173 and the landing page and admin portal on http://localhost:5174, with a database that lives in memory. Places are made up and sign-in codes are printed in the terminal. It is for looking around only.

## 1. What you need

| Service | Used for | Needed to launch |
|---|---|---|
| Cloudflare | Hosting both Workers. `midnightpoetry.studio` must be a zone on this account. | Yes |
| Neon | The Postgres database | Yes |
| Resend | Sending sign-in codes by email | Yes |
| Stripe | Pro subscriptions | Only to sell Pro |
| Google Places API (New) | Places with ratings and opening hours | No. OpenStreetMap is the default |
| Google AdSense | Ads on the landing page | No |

## 2. Database (Neon)

1. Create a Neon project and a database named `zorion`.
2. Copy the connection string (the pooled one is fine).
3. Create the tables:

```
DATABASE_URL='postgres://…' npm run migrate
```

Run the same command after pulling new code. It applies only what is missing.

## 3. Secrets

Make two random values and keep them somewhere safe. Changing `PEPPER` later signs everyone out and invalidates every password and guest code. Changing `TOTP_KEY` breaks every authenticator.

```
openssl rand -hex 32      # PEPPER
openssl rand -base64 32   # TOTP_KEY
```

Set the secrets on each Worker. `DATABASE_URL`, `PEPPER` and `TOTP_KEY` must be identical on both.

```
cd apps/app
npx wrangler secret put DATABASE_URL
npx wrangler secret put PEPPER
npx wrangler secret put TOTP_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM            # for example: Zorion <hello@midnightpoetry.studio>
# optional
npx wrangler secret put GOOGLE_PLACES_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_MONTHLY  # a Stripe price id, price_…
npx wrangler secret put STRIPE_PRICE_YEARLY

cd ../site
npx wrangler secret put DATABASE_URL
npx wrangler secret put PEPPER
npx wrangler secret put TOTP_KEY
```

## 4. Email (Resend)

1. Add and verify `midnightpoetry.studio` (or a subdomain) in Resend.
2. Create an API key that can only send, and store it as `RESEND_API_KEY`.
3. `EMAIL_FROM` must use the verified domain.

Without these, nobody can sign in: codes are only shown on screen in development.

## 5. Deploy

```
npm run check
npm run deploy -w @zorion/app
npm run deploy -w @zorion/site
```

The first deploy attaches `zorionapp.midnightpoetry.studio` and `zorion.midnightpoetry.studio` as custom domains.

To deploy from GitHub instead, add the repository secrets `CLOUDFLARE_API_TOKEN` (permission: Workers Scripts edit, plus Workers Routes edit for the zone), `CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL`, then run the **Deploy** workflow from the Actions tab on `main`. Add a required reviewer to the `production` environment so a deploy needs approval.

## 6. First admin

Admins are never created from the website.

```
cd apps/site
DATABASE_URL='postgres://…' PEPPER='…' TOTP_KEY='…' npm run create-admin -- you@example.com super
```

It prints a one-time password and an authenticator key. Add the key to your authenticator app, then sign in at `zorion.midnightpoetry.studio/admin`. Create a second admin as soon as you can: with one admin, sensitive actions are self-approved (and logged as such); with two or more, a different admin has to approve them.

## 7. Stripe (to sell Pro)

1. Create a product "Zorion Pro" with a monthly and a yearly price. Put the two price ids in `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`.
2. Add a webhook endpoint `https://zorionapp.midnightpoetry.studio/api/webhooks/stripe` for `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Turn on the customer portal in Stripe so hosts can cancel or change their card.

Until these are set, the Pro screen says billing is not set up yet. Test with Stripe test keys first.

## 8. Places

OpenStreetMap is the default and needs no key. It uses the public Overpass service, which has fair-use limits and no ratings or opening hours. For real traffic, either switch to Google or point the app at your own Overpass server.

To use Google: enable **Places API (New)** in Google Cloud, create a key restricted to that API, store it as `GOOGLE_PLACES_KEY`, then choose Google under Admin → Categories & rules. Google bills per search after its free monthly allowance, so set a budget alert.

### Typed starting places

Guests and hosts can type a station, street or postcode instead of sharing GPS. The lookup follows the places setting: OpenStreetMap's Nominatim by default, Google when Google is chosen. The public Nominatim service allows light use only (about one lookup a second in total), so for real traffic choose Google or set `NOMINATIM_URL` to your own server. `OVERPASS_URL` does the same for the places search.

### Routed trip times

By default Zorion estimates trip times from straight-line distance and nothing leaves Zorion. Under Admin → Categories & rules you can switch to real routed times. Every routed choice sends each starting point to that service with no name attached, and each falls back to the estimate if its call fails.

| Choice | Cost | Covers | Set-up |
|---|---|---|---|
| OpenStreetMap routing (OSRM) | Free, no key | Walking, cycling | Works as shipped: `OSRM_FOOT_URL` and `OSRM_BIKE_URL` in `apps/app/wrangler.jsonc` point at the public servers run by FOSSGIS |
| openrouteservice | Free plan with a key | Walking, cycling | Sign up at openrouteservice.org, then `npx wrangler secret put ORS_API_KEY` |
| Google routes | Paid per trip calculated | Walking, cycling, transit | Enable **Routes API** for your Google key, or store a separate `GOOGLE_ROUTES_KEY`. Set a budget alert |

Limits to know:

- The public OSRM servers are run by volunteers. They allow one request a second and promise no availability. Zorion keeps to that limit and uses the estimate for any call it has to skip. For steady traffic, run your own OSRM and point the two URLs at it.
- openrouteservice's free plan allows 500 matrix requests a day and 40 a minute. Zorion uses one per "Find the middle".
- Transit is only routed by Google. With a free choice, transit meetups use the estimate.

### Emails

Besides sign-in codes, Zorion sends:

- **To hosts**: when the date answers, the food votes or the place votes are complete, and when a guest changes their reply after the plan is confirmed (at most one an hour per meetup). After confirmation the reply is the only thing a guest can change. A host can switch these off under Account.
- **To guests who ask**: when the date is set, when the place vote opens, when the place is confirmed, and when the date moves. A guest leaves an address on the meetup page and must confirm it from their inbox first. Every email has a stop link.

All of it goes through Resend with the same `RESEND_API_KEY` and `EMAIL_FROM`.

### Telegram (optional)

The same updates can go to Telegram, with the same subject (in bold) and the same lines as the email. Hosts connect under Account; guests choose "On Telegram" next to email on the meetup page. Sign-in codes stay on email only.

1. In Telegram, message **@BotFather**, send `/newbot`, and pick a name and a username (for example `ZorionMeetBot`). It gives you a bot token.
2. Make a webhook secret: `openssl rand -hex 32`.
3. Store all three on the app:

```
cd apps/app
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_BOT_USERNAME      # the username, without @
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

4. After deploying, point the bot at the app, from the repository root:

```
TELEGRAM_BOT_TOKEN='…' TELEGRAM_WEBHOOK_SECRET='…' APP_ORIGIN=https://zorionapp.midnightpoetry.studio npm run telegram:setup
```

Until the username is set, the Telegram choice does not appear anywhere. If someone blocks the bot, Zorion forgets their chat and stops trying.

## 9. Ads

- Sponsored slots inside the app are managed under Admin → Sponsored & ads. They are first-party: no ad network sees the app.
- AdSense runs on the landing page only. Enter the publisher id in the admin portal, and add an `ads.txt` file to `apps/site/public/` with the line Google gives you.

## 10. Legal pages

`/privacy` and `/terms` on the landing site are drafts written from what the code does. Before launch:

1. Set `CONTACT_EMAIL` in `apps/site/wrangler.jsonc`. The pages show it as the contact address.
2. Have both pages reviewed, and add what only you can decide: the legal name of the business, governing law, and your refund policy.
3. Keep them true. If you switch on routed trip times, AdSense, or a new provider, check the privacy page still describes it.

## 11. Recommended Cloudflare settings

- A rate limiting rule on `/api/auth/*`, `/api/g/*` and `/admin/api/*` as a second layer in front of the limits built into the app.
- Cloudflare Access in front of `/admin*` if you want admins to pass your identity provider before they even see the sign-in page.
- Bot Fight Mode on, "Always Use HTTPS" on, minimum TLS 1.2.

## Local development against a real database

Copy `apps/app/.dev.vars.example` to `apps/app/.dev.vars` and `apps/site/.dev.vars`, fill in a Neon **development branch** connection string, then:

```
npm run dev -w @zorion/app    # http://localhost:5173
npm run dev -w @zorion/site   # http://localhost:5174
```

In development, sign-in codes are available at `/api/dev/outbox` instead of being emailed. That address returns "not found" in production.

## Tests

```
npm run check                                   # type checks, unit and API tests, builds
npx playwright install chromium                 # once
npm run e2e                                     # main flows in a real browser, against the local demo
```

To use an installed Chrome instead of Playwright's download: `E2E_CHROME=/path/to/chrome npm run e2e`.
