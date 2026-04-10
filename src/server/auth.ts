import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { dirname } from 'node:path';
import { getServerTokensPath } from '../cli/utils/paths.js';

export const DEFAULT_SERVER_AUTH_TOKEN_ENV = 'LGREP_SERVER_AUTH_TOKEN';
export const DEFAULT_SERVER_TOKENS_FILE_ENV = 'LGREP_SERVER_TOKENS_FILE';

export interface StoredServerToken {
  id: string;
  label: string;
  tokenHash: string;
  projects: string[] | null;
  worktrees: string[] | null;
  createdAt: string;
}

interface StoredServerTokensFile {
  tokens: StoredServerToken[];
}

export interface ServerAccessScope {
  id: string;
  label: string;
  projects: Set<string> | null;
  worktrees: Set<string> | null;
  source: 'none' | 'legacy-env' | 'token-store';
}

export interface ServerAuthDescriptor {
  enabled: boolean;
  mode: 'none' | 'legacy-env' | 'token-store' | 'mixed';
  tokenEnv?: string;
  tokenFile?: string;
  tokenCount: number;
}

export interface ServerAuthConfig {
  legacyToken: string | null;
  storedTokens: StoredServerToken[];
  descriptor: ServerAuthDescriptor;
}

export interface AuthorizeRequestResult {
  authorized: boolean;
  scope: ServerAccessScope | null;
}

function normalizeScopeValues(values?: string[] | null): string[] | null {
  if (!values || values.length === 0) {
    return null;
  }

  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length === 0 || normalized.includes('*')) {
    return null;
  }

  return Array.from(new Set(normalized)).sort();
}

function toScopeSet(values?: string[] | null): Set<string> | null {
  const normalized = normalizeScopeValues(values);
  return normalized ? new Set(normalized) : null;
}

function getTokenStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return env[DEFAULT_SERVER_TOKENS_FILE_ENV]?.trim() || getServerTokensPath();
}

function hashServerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function readStoredTokensFile(path: string): StoredServerTokensFile {
  if (!existsSync(path)) {
    return { tokens: [] };
  }

  const raw = JSON.parse(readFileSync(path, 'utf-8')) as StoredServerTokensFile | StoredServerToken[];
  if (Array.isArray(raw)) {
    return { tokens: raw };
  }

  return {
    tokens: Array.isArray(raw.tokens) ? raw.tokens : [],
  };
}

function writeStoredTokensFile(path: string, data: StoredServerTokensFile): void {
  ensureParentDir(path);
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

export function getServerAuthToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env[DEFAULT_SERVER_AUTH_TOKEN_ENV]?.trim();
  return token ? token : null;
}

export function getBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function loadServerAuthConfig(env: NodeJS.ProcessEnv = process.env): ServerAuthConfig {
  const legacyToken = getServerAuthToken(env);
  const tokenStorePath = getTokenStorePath(env);
  const storedTokens = readStoredTokensFile(tokenStorePath).tokens;

  let mode: ServerAuthDescriptor['mode'] = 'none';
  if (legacyToken && storedTokens.length > 0) {
    mode = 'mixed';
  } else if (legacyToken) {
    mode = 'legacy-env';
  } else if (storedTokens.length > 0) {
    mode = 'token-store';
  }

  return {
    legacyToken,
    storedTokens,
    descriptor: {
      enabled: Boolean(legacyToken) || storedTokens.length > 0,
      mode,
      tokenEnv: legacyToken ? DEFAULT_SERVER_AUTH_TOKEN_ENV : undefined,
      tokenFile: storedTokens.length > 0 || env[DEFAULT_SERVER_TOKENS_FILE_ENV] ? tokenStorePath : undefined,
      tokenCount: storedTokens.length,
    },
  };
}

function buildLegacyScope(): ServerAccessScope {
  return {
    id: 'legacy-env',
    label: 'legacy env token',
    projects: null,
    worktrees: null,
    source: 'legacy-env',
  };
}

function buildStoredScope(token: StoredServerToken): ServerAccessScope {
  return {
    id: token.id,
    label: token.label,
    projects: toScopeSet(token.projects),
    worktrees: toScopeSet(token.worktrees),
    source: 'token-store',
  };
}

export function authorizeServerRequest(
  req: IncomingMessage,
  config: ServerAuthConfig,
): AuthorizeRequestResult {
  if (!config.descriptor.enabled) {
    return {
      authorized: true,
      scope: {
        id: 'public',
        label: 'public',
        projects: null,
        worktrees: null,
        source: 'none',
      },
    };
  }

  const providedToken = getBearerToken(req);
  if (!providedToken) {
    return { authorized: false, scope: null };
  }

  if (config.legacyToken) {
    const expected = Buffer.from(config.legacyToken);
    const provided = Buffer.from(providedToken);
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      return { authorized: true, scope: buildLegacyScope() };
    }
  }

  const providedHash = Buffer.from(hashServerToken(providedToken));
  for (const token of config.storedTokens) {
    const expectedHash = Buffer.from(token.tokenHash);
    if (expectedHash.length === providedHash.length && timingSafeEqual(expectedHash, providedHash)) {
      return { authorized: true, scope: buildStoredScope(token) };
    }
  }

  return { authorized: false, scope: null };
}

export function scopeAllowsProject(scope: ServerAccessScope, projectId: string | null | undefined, projectName: string | null | undefined): boolean {
  if (!scope.projects) {
    return true;
  }

  return (projectId ? scope.projects.has(projectId) : false)
    || (projectName ? scope.projects.has(projectName) : false);
}

export function scopeAllowsWorktree(scope: ServerAccessScope, worktreeId: string | null | undefined, worktreeName: string | null | undefined): boolean {
  if (!scope.worktrees) {
    return true;
  }

  return (worktreeId ? scope.worktrees.has(worktreeId) : false)
    || (worktreeName ? scope.worktrees.has(worktreeName) : false);
}

export function filterProjectsForScope<T extends { id: string; name: string }>(projects: T[], scope: ServerAccessScope): T[] {
  return projects.filter((project) => scopeAllowsProject(scope, project.id, project.name));
}

export function filterWorktreesForScope<T extends { id: string; name: string; projectId: string | null }>(
  worktrees: T[],
  scope: ServerAccessScope,
  projectNamesById?: Map<string, string>,
): T[] {
  return worktrees.filter((worktree) =>
    scopeAllowsWorktree(scope, worktree.id, worktree.name)
      && scopeAllowsProject(
        scope,
        worktree.projectId,
        worktree.projectId ? projectNamesById?.get(worktree.projectId) ?? null : null,
      ),
  );
}

export interface CreateServerTokenOptions {
  label: string;
  projects?: string[] | null;
  worktrees?: string[] | null;
  path?: string;
}

export interface CreateServerTokenResult {
  token: string;
  storedToken: StoredServerToken;
  path: string;
}

export function createServerToken(options: CreateServerTokenOptions): CreateServerTokenResult {
  const path = options.path ?? getTokenStorePath();
  const existing = readStoredTokensFile(path);
  const token = randomBytes(24).toString('base64url');
  const now = new Date().toISOString();

  const storedToken: StoredServerToken = {
    id: randomBytes(8).toString('hex'),
    label: options.label.trim(),
    tokenHash: hashServerToken(token),
    projects: normalizeScopeValues(options.projects),
    worktrees: normalizeScopeValues(options.worktrees),
    createdAt: now,
  };

  existing.tokens.push(storedToken);
  writeStoredTokensFile(path, existing);

  return { token, storedToken, path };
}

export function listServerTokens(path = getTokenStorePath()): { path: string; tokens: StoredServerToken[] } {
  return {
    path,
    tokens: readStoredTokensFile(path).tokens,
  };
}
