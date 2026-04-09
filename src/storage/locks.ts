import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * Convert a string key to a Postgres bigint suitable for pg_advisory_lock.
 * Uses the first 8 bytes of a SHA-256 hash, interpreted as a signed 64-bit int.
 */
export function hashToInt64(key: string): string {
  const hash = createHash('sha256').update(key).digest();
  // Read as signed BigInt from first 8 bytes
  const bigint = hash.readBigInt64BE(0);
  return bigint.toString();
}

/**
 * Acquire a Postgres advisory lock for a worktree operation.
 * Uses pg_advisory_xact_lock (transaction-scoped, auto-released on commit/rollback).
 */
export async function withWorktreeLock<T>(
  pool: Pool,
  worktreeId: string,
  operation: 'index' | 'update' | 'delete',
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const lockId = hashToInt64(worktreeId + ':' + operation);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Try to acquire an advisory lock without blocking.
 * Returns true if the lock was acquired, false if already held.
 * Uses session-level lock — caller must release with releaseWorktreeLock.
 */
export async function tryWorktreeLock(
  pool: Pool,
  worktreeId: string,
  operation: string,
): Promise<boolean> {
  const lockId = hashToInt64(worktreeId + ':' + operation);
  const result = await pool.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
    [lockId],
  );
  return result.rows[0]?.acquired ?? false;
}

/**
 * Release a session-level advisory lock previously acquired with tryWorktreeLock.
 */
export async function releaseWorktreeLock(
  pool: Pool,
  worktreeId: string,
  operation: string,
): Promise<void> {
  const lockId = hashToInt64(worktreeId + ':' + operation);
  await pool.query('SELECT pg_advisory_unlock($1::bigint)', [lockId]);
}

/**
 * Atomic worktree status transition. Only updates if the current status
 * matches the expected value. Returns true if the transition succeeded.
 */
export async function atomicStatusTransition(
  pool: Pool,
  worktreeId: string,
  expectedStatus: string,
  newStatus: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE "lgrep_worktrees"
        SET status = $1, updated_at = NOW()
      WHERE id = $2 AND status = $3
      RETURNING id`,
    [newStatus, worktreeId, expectedStatus],
  );
  return (result.rowCount ?? 0) > 0;
}
