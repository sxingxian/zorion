// Applies pending SQL migrations to the database in DATABASE_URL.
// Usage: DATABASE_URL=postgres://... npm run migrate
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to your Neon connection string.');
  process.exit(1);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    console.log('applying', file);
    await client.query('begin');
    try {
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
