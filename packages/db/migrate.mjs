// Applies pending SQL migrations to the database in DATABASE_URL.
// Usage: DATABASE_URL=postgres://... npm run migrate            apply what is missing
//        DATABASE_URL=postgres://... npm run migrate -- --dry-run   only list what would run
//        npm run migrate -- --build   used by Cloudflare's build of each GitHub update:
//          runs only on the production branch (MIGRATE_BRANCH, default main) and stops the
//          build if DATABASE_URL is missing, so code never goes live ahead of its tables.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
const dryRun = process.argv.includes('--dry-run');
const build = process.argv.includes('--build');
const branch = process.env.WORKERS_CI_BRANCH;
const production = process.env.MIGRATE_BRANCH || 'main';
if (build && branch && branch !== production) {
  console.log(`skipping migrations: branch ${branch} is not ${production}`);
  process.exit(0);
}
if (!url) {
  console.error(build
    ? 'DATABASE_URL is missing. Add it under Settings > Build > Variables and secrets in Cloudflare.'
    : 'Set DATABASE_URL to your Neon connection string.');
  process.exit(1);
}
// Both Workers build from the same GitHub update at the same time. Each migration takes a
// transaction lock and checks again inside it, so the second build waits for the first and then
// skips what is already applied. Transaction locks also work through Neon's pooled connection.
const LOCK = 7_261_947_301;
const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query('begin');
  await client.query('select pg_advisory_xact_lock($1)', [LOCK]);
  await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  await client.query('commit');
  const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  const pending = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().filter((f) => !done.has(f));
  if (dryRun) {
    console.log(pending.length ? `would apply:\n${pending.map((f) => `  ${f}`).join('\n')}` : 'nothing to apply: the database is up to date');
    process.exit(0);
  }
  for (const file of pending) {
    await client.query('begin');
    try {
      await client.query('select pg_advisory_xact_lock($1)', [LOCK]);
      if ((await client.query('select 1 from schema_migrations where name = $1', [file])).rows.length) {
        await client.query('commit');
        console.log('already applied', file);
        continue;
      }
      console.log('applying', file);
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }
  console.log('database is up to date');
} finally {
  client.release();
  await pool.end();
}
