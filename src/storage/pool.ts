import { Pool } from 'pg';

const DEFAULT_POOL_CONFIG = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

let sharedPool: Pool | null = null;
let sharedPoolUri: string | null = null;

/**
 * Get or create a singleton connection pool.
 * Returns the same pool if called with the same connection string.
 */
export function getSharedPool(connectionString: string): Pool {
  if (sharedPool && sharedPoolUri === connectionString) {
    return sharedPool;
  }

  if (sharedPool) {
    // Connection string changed — close old pool
    sharedPool.end().catch(() => {});
  }

  sharedPool = new Pool({
    connectionString,
    ...DEFAULT_POOL_CONFIG,
  });

  sharedPool.on('error', (err) => {
    console.error('Unexpected pool error:', err.message);
  });

  sharedPoolUri = connectionString;
  return sharedPool;
}

/**
 * Close the shared pool (for clean shutdown).
 */
export async function closeSharedPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
    sharedPoolUri = null;
  }
}

/**
 * Get pool health statistics.
 */
export function getPoolStats(): {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
} | null {
  if (!sharedPool) return null;
  return {
    totalCount: sharedPool.totalCount,
    idleCount: sharedPool.idleCount,
    waitingCount: sharedPool.waitingCount,
  };
}

/**
 * Check pool health by running a simple query.
 */
export async function checkPoolHealth(): Promise<boolean> {
  if (!sharedPool) return false;
  try {
    await sharedPool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
