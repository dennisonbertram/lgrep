import type { QueryRequest } from './query-server.js';
import { getServerAuthToken } from './auth.js';

const DEFAULT_PORT = 8420;

/**
 * Get the server URL from environment or default.
 */
export function getServerUrl(): string | null {
  return process.env['LGREP_SERVER_URL'] ?? null;
}

function createServerHeaders(): Record<string, string> {
  const token = getServerAuthToken();
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Check if a server is running at the given URL.
 */
export async function isServerRunning(url?: string): Promise<boolean> {
  const base = url ?? getServerUrl() ?? `http://localhost:${DEFAULT_PORT}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${base}/health`, {
      signal: controller.signal,
      headers: createServerHeaders(),
    });
    clearTimeout(timeout);
    return resp.ok || resp.status === 401 || resp.status === 403;
  } catch {
    return false;
  }
}

/**
 * Send a query to the running lgrep server.
 */
export async function queryServer(
  request: QueryRequest,
  url?: string,
): Promise<unknown> {
  const base = url ?? getServerUrl() ?? `http://localhost:${DEFAULT_PORT}`;

  const resp = await fetch(`${base}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...createServerHeaders(),
    },
    body: JSON.stringify(request),
  });

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `Server error: ${resp.status}`);
  }

  return data;
}

/**
 * Get server health status.
 */
export async function getServerHealth(url?: string): Promise<unknown> {
  const base = url ?? getServerUrl() ?? `http://localhost:${DEFAULT_PORT}`;
  const resp = await fetch(`${base}/health`, {
    headers: createServerHeaders(),
  });
  const data = await resp.json();

  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `Server error: ${resp.status}`);
  }

  return data;
}
