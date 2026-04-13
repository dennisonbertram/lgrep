import { afterEach, describe, expect, it, vi } from 'vitest';

const { getServerUrlMock, getGitContextMock } = vi.hoisted(() => ({
  getServerUrlMock: vi.fn(),
  getGitContextMock: vi.fn(),
}));

vi.mock('../../server/client.js', () => ({
  getServerUrl: getServerUrlMock,
}));

vi.mock('./git-context.js', () => ({
  getGitContext: getGitContextMock,
}));

import { formatMissingHostedScopeError, formatMissingHostedScopeFix } from './hosted-scope-errors.js';

describe('hosted scope error formatting', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('guides first-run hosted users toward project listing and binding', () => {
    getServerUrlMock.mockReturnValue('https://lgrep.example.com');
    getGitContextMock.mockReturnValue({
      repoRoot: '/repo',
      repoName: 'agentic-hosting',
      gitDir: '/repo/.git',
      branch: 'main',
    });

    const message = formatMissingHostedScopeError('/repo');

    expect(message).toContain('has not been bound for hosted reads yet');
    expect(message).toContain('Current branch: main');
    expect(message).toContain('Hosted server: https://lgrep.example.com');
    expect(message).toContain('Run `lgrep project list`');
    expect(message).toContain('lgrep worktree bind --project <name> --worktree <name>');
    expect(message).toContain('lgrep index "/repo" --name agentic-hosting');
  });

  it('formats a concise doctor fix for unbound hosted repos', () => {
    getGitContextMock.mockReturnValue({
      repoRoot: '/repo',
      repoName: 'agentic-hosting',
      gitDir: '/repo/.git',
      branch: 'main',
    });

    const fix = formatMissingHostedScopeFix('/repo');

    expect(fix).toContain('lgrep project list');
    expect(fix).toContain('lgrep worktree bind --project <name> --worktree <name>');
    expect(fix).toContain('lgrep index "/repo" --name agentic-hosting');
  });
});
