import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from './migrations.js';

interface LoggedQuery {
  sql: string;
  params: unknown[];
}

class FakePoolClient {
  queries: LoggedQuery[] = [];
  released = false;

  constructor(
    private currentVersion: number,
    private failOn?: string,
  ) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql: normalized, params });

    if (this.failOn && normalized.includes(this.failOn)) {
      throw new Error('boom');
    }

    if (normalized.startsWith('SELECT COALESCE(MAX(version), 0) AS v FROM "lgrep_schema_migrations"')) {
      return { rows: [{ v: this.currentVersion } as T] };
    }

    if (normalized.startsWith('INSERT INTO "lgrep_schema_migrations"')) {
      this.currentVersion = Number(params[0] ?? this.currentVersion);
      return { rows: [] };
    }

    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

class FakePool {
  readonly client: FakePoolClient;

  constructor(currentVersion: number, failOn?: string) {
    this.client = new FakePoolClient(currentVersion, failOn);
  }

  async connect(): Promise<PoolClient> {
    return this.client as unknown as PoolClient;
  }

  async query(): Promise<never> {
    throw new Error('ensureSchema should use a connected client');
  }
}

describe('ensureSchema', () => {
  it('acquires an advisory lock and skips work when schema is current', async () => {
    const pool = new FakePool(6);

    const result = await ensureSchema(pool as unknown as Pool);

    expect(result).toEqual({ applied: 0 });
    expect(pool.client.released).toBe(true);
    expect(pool.client.queries[0]).toEqual({
      sql: 'SELECT pg_advisory_lock($1, $2)',
      params: [27647, 1],
    });
    expect(pool.client.queries.at(-1)).toEqual({
      sql: 'SELECT pg_advisory_unlock($1, $2)',
      params: [27647, 1],
    });
    expect(pool.client.queries.some((entry) => entry.sql === 'BEGIN')).toBe(false);
  });

  it('runs pending migrations while holding the advisory lock', async () => {
    const pool = new FakePool(5);

    const result = await ensureSchema(pool as unknown as Pool);

    expect(result).toEqual({ applied: 1 });
    expect(pool.client.released).toBe(true);

    const lockIndex = pool.client.queries.findIndex((entry) => entry.sql === 'SELECT pg_advisory_lock($1, $2)');
    const migrationIndex = pool.client.queries.findIndex((entry) =>
      entry.sql.includes('ALTER TABLE "lgrep_shared_chunks" ADD COLUMN IF NOT EXISTS model_dims INTEGER'),
    );
    const commitIndex = pool.client.queries.findIndex((entry) => entry.sql === 'COMMIT');
    const unlockIndex = pool.client.queries.findIndex((entry) => entry.sql === 'SELECT pg_advisory_unlock($1, $2)');

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(migrationIndex).toBeGreaterThan(lockIndex);
    expect(commitIndex).toBeGreaterThan(migrationIndex);
    expect(unlockIndex).toBeGreaterThan(commitIndex);
  });

  it('rolls back failed migrations and still releases the advisory lock', async () => {
    const pool = new FakePool(
      5,
      'ALTER TABLE "lgrep_shared_chunks" ADD COLUMN IF NOT EXISTS model_dims INTEGER',
    );

    await expect(ensureSchema(pool as unknown as Pool)).rejects.toThrow(
      'Migration v6 (Phase 6: dimension-aware shared chunk storage) failed: boom',
    );

    expect(pool.client.released).toBe(true);
    expect(pool.client.queries.some((entry) => entry.sql === 'ROLLBACK')).toBe(true);
    expect(pool.client.queries.at(-1)).toEqual({
      sql: 'SELECT pg_advisory_unlock($1, $2)',
      params: [27647, 1],
    });
  });
});
