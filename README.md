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

- [docs/SETUP.md](docs/SETUP.md): Cloudflare, Neon, Resend, Stripe and the first admin, step by step
- [docs/SECURITY.md](docs/SECURITY.md): what is protected and how, and what is still open
- [docs/PLAN.md](docs/PLAN.md): what is built and what is not
