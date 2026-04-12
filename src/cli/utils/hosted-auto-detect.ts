import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { queryServer } from '../../server/client.js';
import type {
  QueryProjectsResponse,
  QueryWorktreesResponse,
  RemoteProject,
  RemoteWorktree,
} from '../../server/query-server.js';

export interface HostedScopeMatch {
  project: string;
  worktree?: string;
}

interface GitContext {
  repoRoot: string;
  repoName: string;
  branch?: string;
}

function tryGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function getGitContext(directory: string): GitContext | null {
  const repoRoot = tryGit(['rev-parse', '--show-toplevel'], directory);
  if (!repoRoot) {
    return null;
  }

  const branch = tryGit(['branch', '--show-current'], directory) || undefined;

  return {
    repoRoot,
    repoName: basename(repoRoot),
    branch,
  };
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

export async function detectHostedScopeForDirectory(
  directory?: string,
): Promise<HostedScopeMatch | null> {
  const targetDir = resolve(directory ?? process.cwd());
  const git = getGitContext(targetDir);
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

  const project = candidateProjects.get(best.worktree.projectId);
  if (!project) {
    return null;
  }

  return {
    project: project.name,
    worktree: best.worktree.name,
  };
}
