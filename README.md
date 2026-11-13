# Zorion

Plan a meetup your whole crew can walk to. The host puts food on the ballot, the crew votes from one link, and Zorion finds the fair middle.

| Surface | Address | Code |
|---|---|---|
| App (PWA) | zorionapp.midnightpoetry.studio | `apps/app` |
| Landing page and admin portal | zorion.midnightpoetry.studio | `apps/site` |
| Rules engine | shared | `packages/core` |
| Database schema | Neon Postgres | `packages/db` |

```
npm install
npm run check      # type checks, tests and builds
npm run demo       # both sites locally, in-memory database, no accounts needed (run a build first)
npm run e2e        # browser tests against the demo (run a build first)
```

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Neon, Cloudflare, Resend, Stripe, the first admin and the optional extras, step by step, from a phone
- [docs/SECURITY.md](docs/SECURITY.md): what is protected and how, and what is still open
- [docs/PLAN.md](docs/PLAN.md): what is built and what is not

## Local development

`npm run demo` needs no accounts. `DEMO_SETUP=1 npm run demo` starts with no admin, to try the first-admin setup (token `demo-setup-token-1234`). To run against a real database instead, copy `apps/app/.dev.vars.example` to `apps/app/.dev.vars` and `apps/site/.dev.vars`, fill in a Neon **development branch** connection string, then:

```
npm run migrate                # with DATABASE_URL set to the same development branch
npm run dev -w @zorion/app     # http://localhost:5173
npm run dev -w @zorion/site    # http://localhost:5174
```

In development, sign-in codes are shown at `/api/dev/outbox` instead of being emailed. That address returns "not found" in production.

## Tests

```
npm run check                      # type checks, unit and API tests, builds
npx playwright install chromium    # once
npm run e2e                        # main flows in a real browser, against the local demo
```

To use an installed Chrome instead of Playwright's download: `E2E_CHROME=/path/to/chrome npm run e2e`.
