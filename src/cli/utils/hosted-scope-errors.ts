import { basename, resolve } from 'node:path';
import { getServerUrl } from '../../server/client.js';
import { getGitContext } from './git-context.js';

function suggestIndexName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'repo';
}

export function formatMissingHostedScopeError(directory: string = process.cwd()): string {
  const targetPath = resolve(directory);
  const git = getGitContext(targetPath);
  const repoName = git?.repoName ?? basename(targetPath);
  const branch = git?.branch?.trim();
  const serverUrl = getServerUrl();
  const suggestedIndexName = suggestIndexName(repoName);

  const lines = [
    'No hosted project/worktree match found for the current directory.',
    `This usually means lgrep is healthy, but "${repoName}" has not been bound for hosted reads yet.`,
    branch ? `Current branch: ${branch}` : null,
    serverUrl ? `Hosted server: ${serverUrl}` : null,
    'Next steps:',
    '  1. Run `lgrep project list` to see hosted projects.',
    '  2. If this repo should use hosted reads, bind it with `lgrep worktree bind --project <name> --worktree <name>`.',
    branch
      ? '  3. If you expected auto-detection to work, switch to a branch that matches a hosted worktree and rerun `lgrep worktree resolve`.'
      : '  3. If you expected auto-detection to work, rerun `lgrep worktree resolve` from a git worktree whose branch matches a hosted worktree.',
    `  4. If this repo should stay local, run \`lgrep index "${targetPath}" --name ${suggestedIndexName}\` instead.`,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

export function formatMissingHostedScopeFix(directory: string = process.cwd()): string {
  const targetPath = resolve(directory);
  const git = getGitContext(targetPath);
  const repoName = git?.repoName ?? basename(targetPath);
  const suggestedIndexName = suggestIndexName(repoName);

  return (
    'Run: lgrep project list, then ' +
    'lgrep worktree bind --project <name> --worktree <name> ' +
    `(or use local mode with lgrep index "${targetPath}" --name ${suggestedIndexName})`
  );
}
