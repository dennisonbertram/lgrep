import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export const POSTGRES_INDEXES_TABLE = 'lgrep_indexes';

export type PostgresIndexTableKind =
  | 'chunks'
  | 'files'
  | 'symbols'
  | 'dependencies'
  | 'calls';

export function getPostgresIndexTableName(
  indexName: string,
  kind: PostgresIndexTableKind
): string {
  const digest = createHash('sha1').update(indexName).digest('hex').slice(0, 16);
  return `lgrep_${kind}_${digest}`;
}

export function requirePostgresPool(db: { mode: string; pool: Pool | null }): Pool {
  if (db.mode !== 'postgres' || !db.pool) {
    throw new Error('Postgres pool is not available for this database');
  }

  return db.pool;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function vectorToSql(vector: Float32Array): string {
  return `[${Array.from(vector).join(',')}]`;
}
