import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getGitContext, type GitContext } from './git-context.js';

const BINDING_FILE_NAME = 'lgrep-worktree.json';

export interface HostedWorktreeBinding {
  version: 1;
  projectName: string;
  projectId?: string;
  worktreeName: string;
  worktreeId?: string;
  repoRoot: string;
  branch?: string;
  serverUrl?: string | null;
  boundAt: string;
}

export interface HostedWorktreeBindingReadResult {
  path: string;
  git: GitContext;
  binding: HostedWorktreeBinding;
}

export interface HostedWorktreeBindingWriteInput {
  projectName: string;
  projectId?: string;
  worktreeName: string;
  worktreeId?: string;
  branch?: string;
  serverUrl?: string | null;
}

export interface HostedWorktreeBindingReadOptions {
  serverUrl?: string | null;
}

function normalizeServerUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function getBindingPath(git: GitContext): string {
  return join(git.gitDir, BINDING_FILE_NAME);
}

function isHostedBinding(value: unknown): value is HostedWorktreeBinding {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1 &&
    typeof candidate['projectName'] === 'string' &&
    candidate['projectName'].trim().length > 0 &&
    typeof candidate['worktreeName'] === 'string' &&
    candidate['worktreeName'].trim().length > 0 &&
    typeof candidate['repoRoot'] === 'string' &&
    candidate['repoRoot'].trim().length > 0;
}

function bindingMatchesContext(
  binding: HostedWorktreeBinding,
  git: GitContext,
  expectedServerUrl?: string | null,
): boolean {
  if (binding.branch && git.branch && binding.branch !== git.branch) {
    return false;
  }

  const normalizedBindingServer = normalizeServerUrl(binding.serverUrl);
  const normalizedExpectedServer = normalizeServerUrl(expectedServerUrl);
  if (normalizedBindingServer && normalizedExpectedServer && normalizedBindingServer !== normalizedExpectedServer) {
    return false;
  }

  if (binding.repoRoot !== git.repoRoot) {
    return false;
  }

  return true;
}

export async function readHostedWorktreeBinding(
  directory: string,
  options: HostedWorktreeBindingReadOptions = {},
): Promise<HostedWorktreeBindingReadResult | null> {
  const git = getGitContext(directory);
  if (!git) {
    return null;
  }

  const path = getBindingPath(git);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isHostedBinding(parsed)) {
      return null;
    }
    if (!bindingMatchesContext(parsed, git, options.serverUrl)) {
      return null;
    }

    return {
      path,
      git,
      binding: parsed,
    };
  } catch {
    return null;
  }
}

export async function writeHostedWorktreeBinding(
  directory: string,
  input: HostedWorktreeBindingWriteInput,
): Promise<HostedWorktreeBindingReadResult> {
  const git = getGitContext(directory);
  if (!git) {
    throw new Error(`Cannot bind hosted worktree for "${directory}" because it is not inside a git repository.`);
  }

  const binding: HostedWorktreeBinding = {
    version: 1,
    projectName: input.projectName,
    projectId: input.projectId,
    worktreeName: input.worktreeName,
    worktreeId: input.worktreeId,
    repoRoot: git.repoRoot,
    branch: input.branch ?? git.branch,
    serverUrl: normalizeServerUrl(input.serverUrl),
    boundAt: new Date().toISOString(),
  };

  const path = getBindingPath(git);
  await mkdir(git.gitDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(binding, null, 2)}\n`, 'utf8');

  return {
    path,
    git,
    binding,
  };
}
