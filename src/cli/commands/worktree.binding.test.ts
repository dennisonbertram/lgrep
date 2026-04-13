import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServerUrlMock,
  queryServerMock,
  resolveHostedScopeForDirectoryMock,
  writeHostedWorktreeBindingMock,
  getGitContextMock,
  openConfiguredDatabaseMock,
  ensureProjectTablesMock,
  ensureWorktreeTablesMock,
  getProjectMock,
  getWorktreeMock,
} = vi.hoisted(() => ({
  getServerUrlMock: vi.fn(),
  queryServerMock: vi.fn(),
  resolveHostedScopeForDirectoryMock: vi.fn(),
  writeHostedWorktreeBindingMock: vi.fn(),
  getGitContextMock: vi.fn(),
  openConfiguredDatabaseMock: vi.fn(),
  ensureProjectTablesMock: vi.fn(),
  ensureWorktreeTablesMock: vi.fn(),
  getProjectMock: vi.fn(),
  getWorktreeMock: vi.fn(),
}));

vi.mock('../../server/client.js', () => ({
  getServerUrl: getServerUrlMock,
  queryServer: queryServerMock,
}));

vi.mock('../utils/hosted-auto-detect.js', () => ({
  resolveHostedScopeForDirectory: resolveHostedScopeForDirectoryMock,
}));

vi.mock('../utils/hosted-worktree-binding.js', () => ({
  writeHostedWorktreeBinding: writeHostedWorktreeBindingMock,
}));

vi.mock('../utils/git-context.js', () => ({
  getGitContext: getGitContextMock,
}));

vi.mock('../../storage/database-config.js', () => ({
  openConfiguredDatabase: openConfiguredDatabaseMock,
}));

vi.mock('../../storage/project.js', async () => {
  const actual = await vi.importActual<typeof import('../../storage/project.js')>('../../storage/project.js');
  return {
    ...actual,
    ensureProjectTables: ensureProjectTablesMock,
    getProject: getProjectMock,
  };
});

vi.mock('../../storage/worktree.js', async () => {
  const actual = await vi.importActual<typeof import('../../storage/worktree.js')>('../../storage/worktree.js');
  return {
    ...actual,
    ensureWorktreeTables: ensureWorktreeTablesMock,
    getWorktree: getWorktreeMock,
  };
});

import {
  runWorktreeBindCommand,
  runWorktreeResolveCommand,
} from './worktree.js';

describe('worktree bind/resolve commands', () => {
  beforeEach(() => {
    getServerUrlMock.mockReset();
    queryServerMock.mockReset();
    resolveHostedScopeForDirectoryMock.mockReset();
    writeHostedWorktreeBindingMock.mockReset();
    getGitContextMock.mockReset();
    openConfiguredDatabaseMock.mockReset();
    ensureProjectTablesMock.mockReset();
    ensureWorktreeTablesMock.mockReset();
    getProjectMock.mockReset();
    getWorktreeMock.mockReset();

    getServerUrlMock.mockReturnValue('https://lgrep.example.com');
    getGitContextMock.mockReturnValue({
      repoRoot: '/repo',
      repoName: 'repo',
      gitDir: '/repo/.git',
      branch: 'feature/login',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the current hosted scope and reports how it was found', async () => {
    resolveHostedScopeForDirectoryMock.mockResolvedValue({
      project: 'lgrep',
      worktree: 'feature-login',
      source: 'binding',
      bindingPath: '/repo/.git/lgrep-worktree.json',
    });

    const result = await runWorktreeResolveCommand({ path: '/repo' });

    expect(result).toEqual({
      success: true,
      project: 'lgrep',
      worktree: 'feature-login',
      source: 'binding',
      bindingPath: '/repo/.git/lgrep-worktree.json',
      repoRoot: '/repo',
      branch: 'feature/login',
      serverUrl: 'https://lgrep.example.com',
    });
  });

  it('refuses to bind a hosted worktree when the current git branch does not match', async () => {
    queryServerMock
      .mockResolvedValueOnce({
        projects: [
          { id: 'p1', name: 'lgrep' },
        ],
      })
      .mockResolvedValueOnce({
        project: 'lgrep',
        worktrees: [
          { id: 'w1', name: 'main', branch: 'main' },
        ],
      });

    await expect(runWorktreeBindCommand({
      path: '/repo',
      project: 'lgrep',
      worktree: 'main',
    })).rejects.toThrow('does not match hosted worktree branch');

    expect(writeHostedWorktreeBindingMock).not.toHaveBeenCalled();
  });

  it('writes an explicit binding for a matching hosted worktree', async () => {
    queryServerMock
      .mockResolvedValueOnce({
        projects: [
          { id: 'p1', name: 'lgrep' },
        ],
      })
      .mockResolvedValueOnce({
        project: 'lgrep',
        worktrees: [
          { id: 'w1', name: 'feature-login', branch: 'feature/login' },
        ],
      });

    writeHostedWorktreeBindingMock.mockResolvedValue({
      path: '/repo/.git/lgrep-worktree.json',
      git: {
        repoRoot: '/repo',
        repoName: 'repo',
        gitDir: '/repo/.git',
        branch: 'feature/login',
      },
      binding: {
        version: 1,
        projectId: 'p1',
        projectName: 'lgrep',
        worktreeId: 'w1',
        worktreeName: 'feature-login',
        repoRoot: '/repo',
        branch: 'feature/login',
        serverUrl: 'https://lgrep.example.com',
        boundAt: 'now',
      },
    });

    const result = await runWorktreeBindCommand({
      path: '/repo',
      project: 'lgrep',
      worktree: 'feature-login',
    });

    expect(writeHostedWorktreeBindingMock).toHaveBeenCalledWith('/repo', {
      projectId: 'p1',
      projectName: 'lgrep',
      worktreeId: 'w1',
      worktreeName: 'feature-login',
      branch: 'feature/login',
      serverUrl: 'https://lgrep.example.com',
    });
    expect(result.bindingPath).toBe('/repo/.git/lgrep-worktree.json');
    expect(result.project).toBe('lgrep');
    expect(result.worktree).toBe('feature-login');
  });
});
