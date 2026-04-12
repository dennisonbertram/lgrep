import { openConfiguredDatabase } from '../../storage/database-config.js';
import { ensureSchema } from '../../storage/migrations.js';
import { startQueryServer } from '../../server/query-server.js';
import { isServerRunning, getServerHealth, getServerUrl } from '../../server/client.js';
import { DEFAULT_SERVER_AUTH_TOKEN_ENV, loadServerAuthConfig } from '../../server/auth.js';
import { requirePostgresPool } from '../../storage/postgres.js';

const DEFAULT_PORT = 8420;

export interface ServerStartResult {
  success: boolean;
  port: number;
  url?: string;
  authEnabled?: boolean;
  authTokenEnv?: string;
  warning?: string;
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
  const url = `http://localhost:${port}`;
  const auth = loadServerAuthConfig();

  // Check if already running
  const running = await isServerRunning(url);
  if (running) {
    return { success: false, port, url, error: `Server already running on port ${port}` };
  }

  const db = await openConfiguredDatabase();

  if (db.mode !== 'postgres') {
    return { success: false, port, url, error: 'Query server requires Postgres storage mode' };
  }

  // Run schema migrations
  const pool = requirePostgresPool(db);
  const { applied } = await ensureSchema(pool);
  if (applied > 0 && !opts.json) {
    console.log(`Applied ${applied} schema migration(s).`);
  }

  if (!auth.descriptor.enabled && !opts.json) {
    console.warn(
      `Warning: ${DEFAULT_SERVER_AUTH_TOKEN_ENV} is not set, so the query server will accept unauthenticated requests.`
    );
  }

  startQueryServer(port, db, { auth });

  return {
    success: true,
    port,
    url,
    authEnabled: auth.descriptor.enabled,
    authTokenEnv: auth.descriptor.enabled ? DEFAULT_SERVER_AUTH_TOKEN_ENV : undefined,
    warning: auth.descriptor.enabled ? undefined : `${DEFAULT_SERVER_AUTH_TOKEN_ENV} is not set`,
  };
}

/**
 * Get server status.
 */
export async function runServerStatusCommand(opts: {
  port?: number;
  json?: boolean;
}): Promise<unknown> {
  const port = opts.port ?? DEFAULT_PORT;
  const url = getServerUrl() ?? `http://localhost:${port}`;

  const running = await isServerRunning(url);
  if (!running) {
    return { status: 'not_running', url };
  }

  return await getServerHealth(url);
}
