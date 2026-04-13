import { basename, resolve } from 'node:path';
import { getServerUrl, queryServer } from '../../server/client.js';
import type {
  QueryProjectsResponse,
  QueryWorktreesResponse,
  RemoteProject,
  RemoteWorktree,
} from '../../server/query-server.js';
import { getGitContext } from './git-context.js';
import { readHostedWorktreeBinding } from './hosted-worktree-binding.js';

export interface HostedScopeMatch {
  project: string;
  worktree?: string;
  source?: 'env' | 'binding' | 'heuristic';
  bindingPath?: string;
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getBranchCandidates(branch?: string): string[] {
  if (!branch) {
    return [];
  }

  const tail = branch.split('/').filter(Boolean).at(-1) ?? branch;
  return Array.from(new Set([
    branch,
    tail,
    normalizeToken(branch),
    normalizeToken(tail),
  ].filter(Boolean)));
}

function getWorktreeScore(worktree: RemoteWorktree, branch?: string): number {
  if (!branch) {
    return 0;
  }

  if (worktree.branch === branch) {
    return 100;
  }

  if (worktree.name === branch) {
    return 95;
  }

  const normalizedName = normalizeToken(worktree.name);
  const normalizedBranch = normalizeToken(branch);
  if (normalizedName && normalizedName === normalizedBranch) {
    return 90;
  }

  const tail = branch.split('/').filter(Boolean).at(-1) ?? branch;
  if (worktree.name === tail) {
    return 85;
  }

  if (normalizedName && normalizedName === normalizeToken(tail)) {
    return 80;
  }

  if (worktree.branch && normalizeToken(worktree.branch) === normalizedBranch) {
    return 75;
  }

  return 0;
}

function chooseWorktree(worktrees: RemoteWorktree[], branch?: string): RemoteWorktree | null {
  if (worktrees.length === 1) {
    return worktrees[0] ?? null;
  }

  const scored = worktrees
    .map((worktree) => ({ worktree, score: getWorktreeScore(worktree, branch) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return null;
  }

  const second = scored[1];
  if (second && second.score === best.score) {
    return null;
  }

  return best.worktree;
}

async function listRemoteProjects(): Promise<RemoteProject[]> {
  const response = await queryServer({
    method: 'projects',
    params: {},
  }) as QueryProjectsResponse;

  return response.projects;
}

async function listRemoteWorktrees(project?: string): Promise<RemoteWorktree[]> {
  const response = await queryServer({
    method: 'worktrees',
    project,
    params: {},
  }) as QueryWorktreesResponse;

  return response.worktrees;
}

function getHostedScopeFromEnv(): HostedScopeMatch | null {
  const project = process.env['LGREP_PROJECT']?.trim();
  const worktree = process.env['LGREP_WORKTREE']?.trim();
  if (!project) {
    return null;
  }

  return {
    project,
    worktree: worktree || undefined,
    source: 'env',
  };
}

export async function resolveHostedScopeForDirectory(
  directory?: string,
): Promise<HostedScopeMatch | null> {
  const targetDir = resolve(directory ?? process.cwd());
  const envScope = getHostedScopeFromEnv();
  if (envScope) {
    return envScope;
  }

  const git = getGitContext(targetDir);
  const binding = await readHostedWorktreeBinding(targetDir, {
    serverUrl: getServerUrl(),
  });
  if (binding) {
    return {
      project: binding.binding.projectName,
      worktree: binding.binding.worktreeName,
      source: 'binding',
      bindingPath: binding.path,
    };
  }

  const projects = await listRemoteProjects();

  if (projects.length === 0) {
    return null;
  }

  const repoName = git?.repoName ?? basename(targetDir);
  const exactProjectMatches = projects.filter((project) => project.name === repoName);

  let selectedProject: RemoteProject | null = null;
  if (exactProjectMatches.length === 1) {
    selectedProject = exactProjectMatches[0] ?? null;
  } else if (projects.length === 1) {
    selectedProject = projects[0] ?? null;
  }

  if (selectedProject) {
    const worktrees = await listRemoteWorktrees(selectedProject.name);
    const worktree = chooseWorktree(worktrees, git?.branch);

    return {
      project: selectedProject.name,
      worktree: worktree?.name,
      source: 'heuristic',
    };
  }

  const allWorktrees = await listRemoteWorktrees();
  if (getBranchCandidates(git?.branch).length === 0) {
    return null;
  }

  const candidateProjects = new Map<string, RemoteProject>();
  for (const project of projects) {
    candidateProjects.set(project.id, project);
  }

  const matchingWorktrees = allWorktrees
    .map((worktree) => ({ worktree, score: getWorktreeScore(worktree, git?.branch) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = matchingWorktrees[0];
  const second = matchingWorktrees[1];
  if (!best || (second && second.score === best.score)) {
    return null;
  }

  const projectId = best.worktree.projectId;
  if (!projectId) {
    return null;
  }

  const project = candidateProjects.get(projectId);
  if (!project) {
    return null;
  }

  return {
    project: project.name,
    worktree: best.worktree.name,
    source: 'heuristic',
  };
}

export async function detectHostedScopeForDirectory(
  directory?: string,
): Promise<HostedScopeMatch | null> {
  const match = await resolveHostedScopeForDirectory(directory);
  if (!match) {
    return null;
  }

  return {
    project: match.project,
    worktree: match.worktree,
  };
}
