import { openConfiguredDatabase } from '../../storage/database-config.js';
import { ensureSchema } from '../../storage/migrations.js';
import { startQueryServer } from '../../server/query-server.js';
import { isServerRunning, getServerHealth } from '../../server/client.js';
import { requirePostgresPool } from '../../storage/postgres.js';

const DEFAULT_PORT = 8420;

export interface ServerStartResult {
  success: boolean;
  port: number;
  error?: string;
}

/**
 * Start the lgrep query server.
 */
export async function runServerStartCommand(opts: {
  port?: number;
  json?: boolean;
}): Promise<ServerStartResult> {
  const port = opts.port ?? DEFAULT_PORT;

  // Check if already running
  const running = await isServerRunning(`http://localhost:${port}`);
  if (running) {
    return { success: false, port, error: `Server already running on port ${port}` };
  }

  const db = await openConfiguredDatabase();

  if (db.mode !== 'postgres') {
    return { success: false, port, error: 'Query server requires Postgres storage mode' };
  }

  // Run schema migrations
  const pool = requirePostgresPool(db);
  const { applied } = await ensureSchema(pool);
  if (applied > 0 && !opts.json) {
    console.log(`Applied ${applied} schema migration(s).`);
  }

  startQueryServer(port, db);

  return { success: true, port };
}

/**
 * Get server status.
 */
export async function runServerStatusCommand(opts: {
  port?: number;
  json?: boolean;
}): Promise<unknown> {
  const port = opts.port ?? DEFAULT_PORT;
  const url = process.env['LGREP_SERVER_URL'] ?? `http://localhost:${port}`;

  const running = await isServerRunning(url);
  if (!running) {
    return { status: 'not_running', url };
  }

  return await getServerHealth(url);
}
