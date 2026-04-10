import {
  DEFAULT_SERVER_TOKENS_FILE_ENV,
  createServerToken,
  listServerTokens,
  type StoredServerToken,
} from '../../server/auth.js';

export interface ServerTokenCreateResult {
  id: string;
  label: string;
  token: string;
  path: string;
  projects: string[] | null;
  worktrees: string[] | null;
  createdAt: string;
}

export interface ServerTokenListResult {
  path: string;
  envVar: string;
  tokens: Array<{
    id: string;
    label: string;
    projects: string[] | null;
    worktrees: string[] | null;
    createdAt: string;
  }>;
}

function parseScopeList(value?: string): string[] | null {
  const normalized = value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return normalized && normalized.length > 0 ? normalized : null;
}

function toPublicToken(record: StoredServerToken) {
  return {
    id: record.id,
    label: record.label,
    projects: record.projects,
    worktrees: record.worktrees,
    createdAt: record.createdAt,
  };
}

export async function runServerTokenCreateCommand(opts: {
  label: string;
  projects?: string;
  worktrees?: string;
  allProjects?: boolean;
}): Promise<ServerTokenCreateResult> {
  const label = opts.label.trim();
  if (!label) {
    throw new Error('Token label is required');
  }
  if (!opts.allProjects && !opts.projects?.trim()) {
    throw new Error('Provide --projects <name[,name]> or use --all-projects');
  }

  const result = createServerToken({
    label,
    projects: opts.allProjects ? null : parseScopeList(opts.projects),
    worktrees: parseScopeList(opts.worktrees),
  });

  return {
    id: result.storedToken.id,
    label: result.storedToken.label,
    token: result.token,
    path: result.path,
    projects: result.storedToken.projects,
    worktrees: result.storedToken.worktrees,
    createdAt: result.storedToken.createdAt,
  };
}

export async function runServerTokenListCommand(): Promise<ServerTokenListResult> {
  const result = listServerTokens();
  return {
    path: result.path,
    envVar: DEFAULT_SERVER_TOKENS_FILE_ENV,
    tokens: result.tokens.map(toPublicToken),
  };
}
