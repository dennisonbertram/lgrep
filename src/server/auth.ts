import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const DEFAULT_SERVER_AUTH_TOKEN_ENV = 'LGREP_SERVER_AUTH_TOKEN';

export function getServerAuthToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env[DEFAULT_SERVER_AUTH_TOKEN_ENV]?.trim();
  return token ? token : null;
}

export function isServerAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getServerAuthToken(env) !== null;
}

export function getBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function isAuthorizedRequest(req: IncomingMessage, expectedToken: string | null): boolean {
  if (!expectedToken) {
    return true;
  }

  const providedToken = getBearerToken(req);
  if (!providedToken) {
    return false;
  }

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}
