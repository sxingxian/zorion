# Zorion

Plan a meetup your whole crew can walk to. The host puts food on the ballot, the crew votes from one link, and Zorion finds the fair middle.

| Surface | Address | Code |
|---|---|---|
| App (PWA) | zorionapp.midnightpoetry.studio | `apps/app` |
| Landing page and admin portal | zorion.midnightpoetry.studio | `apps/site` |
| Rules engine | shared | `packages/core` |
| Database schema | Neon Postgres | `packages/db` |

See `docs/` for the build plan, set-up and security notes.

```
npm install
npm run check      # type checks, tests and builds
```
