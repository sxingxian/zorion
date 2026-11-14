# Deploying Zorion

Everything runs on free tiers at launch: **Neon** (Postgres) in Singapore, and **Cloudflare Workers** for the app, the website and the admin portal. Every step below can be done from a phone browser. Allow about an hour the first time.

| Host | Serves | Cloudflare Worker | Code |
| --- | --- | --- | --- |
| `zorion.midnightpoetry.studio` | Website, plus the admin portal at `/admin` | `zorion-site` | `apps/site` |
| `zorionapp.midnightpoetry.studio` | PWA, its API, the Stripe and Telegram webhooks, the hourly housekeeping | `zorion-app` | `apps/app` |

Both Workers use the same database and the same `PEPPER` and `TOTP_KEY`.

## 1. Neon database

1. Create a project at neon.tech. Choose **Region: AWS Asia Pacific (Singapore)**. Name the database `zorion`.
2. Project → **Connect** → copy the connection string (the pooled one is fine). This is `DATABASE_URL`. Store it in your password manager.

You don't create any tables yourself: Cloudflare's first build does it (section 2).

Optional: Neon → **Branches** → create a `dev` branch for trying things without touching live data. Its connection string goes in `.dev.vars` on a computer (see the README).

## 2. Cloudflare Workers (connected to GitHub)

Cloudflare watches the GitHub repository and picks up every update to `main` by itself. GitHub never sends anything to Cloudflare or Neon, and holds none of their keys; its Actions only test.

For each update, Cloudflare builds both Workers. Each build installs the locked packages, runs the type checks and tests, applies any new database migrations, builds, and then deploys. If any step fails, that Worker keeps serving the version it had. More in **How each update goes live** below.

Create two Workers in **Workers & Pages → Create → Import a repository** → GitHub → this repository. Their names must match `name` in each `wrangler.jsonc` (`zorion-app`, `zorion-site`).

### `zorion-app` (PWA)

- **Root directory:** `/` (repository root)
- **Build command:** `npm ci && npm run cloudflare:app`
- **Deploy command:** `npm exec -w @zorion/app -- wrangler deploy`
- **Build variables and secrets:** `NODE_VERSION` = `22`, and `DATABASE_URL` as a **Secret** (from section 1)

### `zorion-site` (website and admin portal)

- **Root directory:** `/` (repository root)
- **Build command:** `npm ci && npm run cloudflare:site`
- **Deploy command:** `npm exec -w @zorion/site -- wrangler deploy`
- **Build variables and secrets:** `NODE_VERSION` = `22`, and `DATABASE_URL` as a **Secret**

What each build runs lives in `package.json` (`cloudflare:app`, `cloudflare:site`), so changes to it arrive with the code. Build variables are only seen by the build, never by the running Worker; the Worker gets its own copy of `DATABASE_URL` in section 3. Both builds can run migrations at the same moment safely: one waits for the other, then finds nothing left to do.

Production branch: `main` (Settings → Build → Branch control). Leave builds for other branches off: preview addresses are switched off, and those builds would skip migrations anyway.

Everything the Workers read at runtime is either in `wrangler.jsonc` `vars` (addresses, places provider, routing servers) or a secret in the dashboard. Variables you add in the dashboard survive each deploy (`keep_vars`).

The first deploy creates every table, but the app and admin portal answer with errors until section 3 is done.

### Custom domains

Each `wrangler.jsonc` claims its domain as a Worker custom domain, so the first deploy creates the DNS record and certificate, provided `midnightpoetry.studio` is a zone in the same Cloudflare account. If the domain is attached to another Worker or Pages project, remove it there first. Neither Worker answers on `*.workers.dev`.

### Hourly housekeeping (no cron trigger)

Zorion uses no Cloudflare cron triggers. Instead, `zorion-app` does its housekeeping in the background after an ordinary request, at most once an hour: a row in the database records when it last ran, and only one request per hour wins it. It erases starting points, guest emails and guest Telegram chats of meetups that have ended, deletes old meetups and expired codes, and connects the Telegram bot if it's set up. Nothing to set up.

It needs traffic to run. If nobody uses the app for a while, that data waits until the next visit. Within a few minutes of that visit it is erased. To keep the hour strict even when the app is quiet, point a free uptime monitor at `https://zorionapp.midnightpoetry.studio/api/health` every 15 to 30 minutes.

## 3. Secrets for both Workers

Add these in Cloudflare → each Worker → Settings → **Variables and Secrets**, type **Secret**. Secrets apply to the next request; no redeploy is needed.

| Secret | `zorion-app` | `zorion-site` | Value |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✓ | ✓ | From section 1 |
| `PEPPER` | ✓ | ✓, same value | 40+ random letters and numbers |
| `TOTP_KEY` | ✓ | ✓, same value | 40+ random letters and numbers |

`PEPPER` keys passwords, codes and session tokens; `TOTP_KEY` encrypts authenticator keys and the keys saved in the admin portal (Stripe, Telegram, email). Make each with your password manager's generator (letters and numbers, 40 or more) and save them there. On a computer, `node scripts/generate-secrets.mjs` prints a fresh set once instead.

**Never change `PEPPER` or `TOTP_KEY` once people use Zorion:** it signs everyone out and breaks every password, guest code and authenticator, and the keys saved in the admin portal must be entered again.

The Stripe, Telegram and email keys are not Worker secrets: they are entered in the admin portal (sections 4, 5 and Telegram), stored encrypted, and never shown again. A Worker secret with the same name still works as a fallback.

**Never put `PEPPER`, `TOTP_KEY`, `DATABASE_URL`, Stripe keys or the bot token in the repository, in `wrangler.jsonc` `vars`, or in any `.env` file that is committed.**

## 4. Email (Resend)

Hosts sign in with a 6-digit code by email, and hosts and guests can ask for updates by email.

1. Create a Resend account and verify the domain `app.midnightpoetry.studio` with the DNS records it asks for (SPF/DKIM).
2. Create an API key with **sending access only**.
3. Admin portal → **Email**: paste the key, keep the sender `Zorion <noreply@app.midnightpoetry.studio>` (or another address on that domain) and press **Connect**. It asks for your authenticator code. Then press **Send me a test**.

Until a key is saved, nobody can sign in in production: codes are only shown on screen in development.

**If codes don't arrive** ("We couldn't send the email" in the app): open the admin portal's **Email** page. **Last email from the app** shows Resend's own reason, the sender used, and which key (saved in the portal or set on `zorion-app` in Cloudflare). The usual causes:
- The sender's domain isn't verified in Resend. It must be the exact domain: verifying `midnightpoetry.studio` does not cover `app.midnightpoetry.studio`.
- The key is limited to a different domain, or was deleted in Resend.
- On Resend's free plan without a verified domain, mail can only go to your own Resend address.

How email is used:
- **Sign-in codes** go to hosts only, and only by email (never Telegram).
- **Updates to hosts**: the date answers, the food votes or the place votes are complete, and a guest changed their reply after the plan was confirmed (at most one an hour per meetup). Hosts switch these off under Account.
- **Updates to guests who ask**: the date is set, the place vote opens, it's on, and the date moved. A guest must confirm their address from their inbox first, and every email has a stop link.

## 5. Stripe (to sell Pro)

1. Create the Stripe account for the business and finish activation (business details, bank account).
2. Settings → Billing → **Customer portal**: allow cancelling and updating payment methods.
3. Developers → API keys → copy the secret key (`sk_live_…`, or `sk_test_…` to rehearse).
4. Admin portal → **Payments**: paste the key and press **Connect**, then enter your authenticator code. Zorion saves the key and creates the webhook in Stripe itself. The page then shows the account, whether it can take payments, and whether the webhook is receiving.
5. Admin portal → **Plans**: type the monthly and yearly price in SGD (typing a price puts it on sale), set what Free and Pro include, and press **Save** in the bar at the bottom.

No Stripe product or price has to be made by hand: checkout uses the prices from the portal. Until a key and a price are saved, the Pro screen says Pro isn't on sale yet. A plan changes only when a signed webhook says so, never because the browser says so. Rehearse with a test key first, then save the live key and press **Reconnect webhook**.

## 6. First super admin

Admins can't sign up. Create the first one in the browser:

1. Make a long random setup token (16+ characters; a password manager's generator works).
2. Cloudflare → `zorion-site` → Settings → Variables and Secrets → add the **Secret** `ADMIN_SETUP_TOKEN` with that value.
3. Open `https://zorion.midnightpoetry.studio/admin`. While there are no admins, it shows **Set up the first admin**. Enter the token, your email and a password (12+ characters), scan the QR code with your authenticator app and enter the code.
4. Delete `ADMIN_SETUP_TOKEN` from `zorion-site`.

Setup closes for good once any admin exists, even with the right token. Five wrong tokens pause it for 30 minutes, and every try is in the audit log.

From then on, admins always sign in with password, then authenticator. Sensitive actions (suspending or deleting a host, any change to ads) need a second admin's approval once there are two. Changing a key (Stripe, Telegram, email) needs a super admin and a fresh authenticator code. To add an admin: **Admins** → **Invite**. Send them the link; it works once, for 24 hours, and they set their own password and authenticator.

## 7. Google ads (in the app, for Free users)

Free users see ads in the app; Pro users see none. Each ad spot shows a Google ad when one is available, and Zorion's own sponsored spot when it isn't (no ad unit, the person said no, an ad blocker, or no ad to show).

The Google ad loads in a frame served by `zorion.midnightpoetry.studio/ad-frame`, a different origin from the app, so Google's scripts can't read the app's pages or cookies. The landing page itself shows no ads.

1. Apply for AdSense with `zorion.midnightpoetry.studio`. Approval can take days to weeks.
2. AdSense → Privacy & messaging → **European regulations**: create and publish the message for visitors from the EEA, UK and Switzerland. Zorion's own prompt asks everyone else before any Google script loads.
3. AdSense → Ads → **By ad unit** → create a display ad unit. Copy its ID (the number in `data-ad-slot`).
4. Admin portal → **Ads**: paste the publisher ID (`ca-pub-…`) and the ad unit ID, keep *Ask before showing Google ads* on, and save. A second admin approves it if there is one. `zorion.midnightpoetry.studio/ads.txt` then serves the matching line within five minutes.

## 8. DNS

The Workers' first deploy creates both records (section 2). Keep the orange-cloud proxy on: the rate limits use the visitor's address from `CF-Connecting-IP`.

## 9. After the first deploy

- [ ] Admin portal: sign in, and check the overview, categories and audit log load.
- [ ] Sign in to the app as a host with an email code; check the email arrives.
- [ ] Create a meetup, open the link on a second phone as a guest, reply, share location, vote. Find the middle and lock in a place.
- [ ] Turn on two-step under Account, sign out, and check the second step is asked.
- [ ] Guest updates: ask for email updates as a guest, confirm from the inbox, and check the "It's on" email arrives.
- [ ] Install the PWA on an iPhone (Share → Add to Home Screen) and on an Android phone.
- [ ] Stripe test mode: buy Pro with card `4242 4242 4242 4242`, check Pro unlocks, cancel in the billing portal, then swap to live keys.
- [ ] Run `https://securityheaders.com` against both hosts. You should get an A.
- [ ] Set real group sizes in the admin portal → **Categories & rules**, and Pro prices in Stripe.
- [ ] Add `CONTACT_EMAIL` to `zorion-site` (Settings → Variables and Secrets, type Text) so the privacy and terms pages show it.
- [ ] Have the privacy notice and terms (drafts at `/privacy` and `/terms`) reviewed by a lawyer before public launch.

## Places and trip times (optional)

**Places** come from OpenStreetMap by default, with no key. For ratings and opening hours, or steady traffic, switch to Google:

1. Google Cloud (console.cloud.google.com) → create a project → **APIs & Services → Library** → enable **Places API (New)**, and **Routes API** if you want Google trip times.
2. **APIs & Services → Credentials → Create credentials → API key**. Edit it: under *API restrictions*, allow only Places API (New) and Routes API. Leave *Application restrictions* at None (Zorion calls Google from its server). Set a budget alert under Billing.
3. Admin portal → **Categories** → *Places come from* → Google Places. Paste the key in the field that appears and press **Connect**. Zorion checks it with one real search (and one route, to see whether Routes API is on), then asks for your authenticator code.

A typed starting place ("Bugis MRT") is looked up by the same service. The public OpenStreetMap servers allow light use only; for real traffic choose Google, or point `OVERPASS_URL` and `NOMINATIM_URL` (variables on `zorion-app`) at your own servers.

**Trip times** are Zorion's own estimate by default, and no starting point leaves Zorion. Admin portal → Categories → *Trip times come from* switches to real routes. A choice that needs a key shows its key field right under it; until the key is connected, the page says trip times use the estimate.

| Choice | Cost | Covers | Set-up |
| --- | --- | --- | --- |
| OpenStreetMap routing | Free, no key | Walking, cycling | Nothing: `OSRM_FOOT_URL` and `OSRM_BIKE_URL` in `apps/app/wrangler.jsonc` point at the public FOSSGIS servers |
| openrouteservice | Free plan with a key | Walking, cycling | Sign up at openrouteservice.org, copy the key from *API keys*, and connect it on the Categories page |
| Google routes | Paid per trip | Walking, cycling, transit | Uses the Google key above, with **Routes API** turned on. If it was off, turn it on and press **Check again** |

Every routed choice sends starting points (with no names) to that service; the privacy page says so. The public OSRM servers are run by volunteers, allow one request a second and promise no availability; Zorion keeps to that and falls back to the estimate for any call it skips. openrouteservice's free plan allows 500 matrix requests a day. Transit is only routed by Google.

## Telegram updates (optional, free)

Hosts (Account → Telegram) and guests (meetup page → Get updates → On Telegram) can get the same updates as email on Telegram, with the same subject and lines.

1. In Telegram, message **@BotFather**, send `/newbot`, choose a name (e.g. "Zorion") and a username ending in `bot` (e.g. `ZorionMeetBot`). Copy the token.
2. Admin portal → **Telegram**: paste the token, enter your authenticator code and press **Connect**. Zorion reads the bot's username, makes a webhook secret, and points the bot at `https://zorionapp.midnightpoetry.studio/api/webhooks/telegram`. **Check bot** shows whether messages are arriving.

Until a bot is connected, the Telegram choice doesn't appear anywhere. A bot can only message people who pressed Start in a chat with it, so people connect through a one-time link that opens the bot. Sending `/stop` to the bot, or blocking it, disconnects them. Sign-in codes are never sent on Telegram.

## How each update goes live

Merge a pull request into `main` (the GitHub app works). That's all: Cloudflare picks up the new commit and builds both Workers.

1. `npm ci` installs exactly what `package-lock.json` lists.
2. Type checks and tests. A failure stops the build here, before the database is touched.
3. `npm run migrate -- --build` applies migrations the database hasn't had yet, each in its own transaction. It runs only for `main`.
4. The Worker is built and deployed. The new code goes live only after its tables exist.

Watch a build in Cloudflare → the Worker → **Deployments** (or the check Cloudflare adds to the commit on GitHub). A failed build changes nothing that's live; fix it and merge again, or press **Retry build**.

**Protect `main` (recommended).** GitHub → Settings → Rules → **New branch ruleset** for `main`: require a pull request, and require the status checks **check** and **Browser tests**. Cloudflare builds whatever lands on `main`, so this makes sure only fully tested code lands there, and that nobody can push to it directly.

**Rolling back.** Cloudflare → the Worker → Deployments → pick the earlier version → **Rollback**. Migrations stay in place; they only ever add tables and columns, so earlier code keeps working with them.

**Migrations only add.** Never rename or drop a column in the same release that stops using it: stop using it in one release, remove it in a later one. The old code is still serving while the migration runs.

**Checking by hand** (on a computer): `DATABASE_URL=… npm run migrate -- --dry-run` lists what would run, without changing anything.

## Extra protection (recommended)

- Cloudflare → `midnightpoetry.studio` → Security → **WAF → Rate limiting rules**: a rule on `/api/auth/*`, `/api/g/*` and `/admin/api/*`, in front of the limits built into the app.
- Cloudflare **Zero Trust → Access**: an application for `zorion.midnightpoetry.studio/admin*`, so admins pass your identity provider before they even see the sign-in page.
- SSL/TLS: **Always Use HTTPS** on, minimum TLS 1.2. Security → Bots: **Bot Fight Mode** on.

## Local development

See the README. `npm run demo` serves both sites with an in-memory database and made-up places, no accounts needed; `npm run check` runs every type check, test and build; `npm run e2e` drives the main flows in a real browser. CI runs all three on each push.

## Release safety

- Cloudflare pulls from GitHub; GitHub pushes nothing. No Cloudflare or Neon key is stored on GitHub, and the GitHub Actions have read-only access to the code.
- `DATABASE_URL` reaches the build as a Cloudflare build secret, so only code on `main` can change the live database. Protect `main` as above.
- Migrations run only after the type checks and tests pass, and only on `main`. Two builds at once can't apply the same migration twice.
- GitHub Actions are pinned to exact commits (with the version in a comment). To update one, look up the new release's commit and change both.
- CI installs only the versions in `package-lock.json` (`npm ci`) and fails if it is out of date, then checks for known vulnerabilities in what ships.
- Workers serve only their custom domains (`workers_dev` and `preview_urls` are off).
