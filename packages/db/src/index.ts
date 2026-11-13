import { neon } from '@neondatabase/serverless';

/** A row as returned by Postgres. Column names are snake_case, as in the migrations. */
export type Row = Record<string, any>;

/**
 * The only way the app talks to Postgres. Every query is parameterised:
 * values never get concatenated into the SQL text.
 */
export interface Db {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs statements in one transaction (all or nothing). */
  batch(statements: Array<[text: string, params?: unknown[]]>): Promise<Row[][]>;
}

export function neonDb(connectionString: string): Db {
  const sql = neon(connectionString);
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      return (await sql.query(text, params)) as T[];
    },
    async batch(statements) {
      return (await sql.transaction(statements.map(([text, params]) => sql.query(text, params ?? [])))) as Row[][];
    },
  };
}

export async function one<T extends Row = Row>(db: Db, text: string, params?: unknown[]): Promise<T | null> {
  const rows = await db.query<T>(text, params);
  return rows[0] ?? null;
}
