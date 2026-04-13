import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

export interface GitContext {
  repoRoot: string;
  repoName: string;
  gitDir: string;
  branch?: string;
}

export function tryGit(args: string[], cwd: string): string | null {
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

export function getGitContext(directory: string): GitContext | null {
  const repoRoot = tryGit(['rev-parse', '--show-toplevel'], directory);
  if (!repoRoot) {
    return null;
  }

  const gitDirValue = tryGit(['rev-parse', '--git-dir'], directory);
  const branch = tryGit(['branch', '--show-current'], directory) || undefined;

  return {
    repoRoot,
    repoName: basename(repoRoot),
    gitDir: resolve(directory, gitDirValue ?? '.git'),
    branch,
  };
}
