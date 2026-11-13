import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Db, Row } from './index';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** An in-memory Postgres with every migration applied. For tests only. */
export async function testDb(): Promise<Db & { close(): Promise<void> }> {
  const pg = new PGlite();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params as any[])).rows;
    },
    async batch(statements) {
      return pg.transaction(async (tx) => {
        const out: Row[][] = [];
        for (const [text, params] of statements) out.push((await tx.query<Row>(text, (params ?? []) as any[])).rows);
        return out;
      });
    },
    close: () => pg.close(),
  };
}
