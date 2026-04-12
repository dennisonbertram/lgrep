import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runInitCommandMock,
  runProjectCreateCommandMock,
  runWorktreeCreateCommandMock,
  runWorktreeForkCommandMock,
  runWorktreeUpdateCommandMock,
  runServerTokenCreateCommandMock,
  openConfiguredDatabaseMock,
  ensureProjectTablesMock,
  ensureWorktreeTablesMock,
  getProjectMock,
  getWorktreeMock,
} = vi.hoisted(() => ({
  runInitCommandMock: vi.fn(),
  runProjectCreateCommandMock: vi.fn(),
  runWorktreeCreateCommandMock: vi.fn(),
  runWorktreeForkCommandMock: vi.fn(),
  runWorktreeUpdateCommandMock: vi.fn(),
  runServerTokenCreateCommandMock: vi.fn(),
  openConfiguredDatabaseMock: vi.fn(),
  ensureProjectTablesMock: vi.fn(),
  ensureWorktreeTablesMock: vi.fn(),
  getProjectMock: vi.fn(),
  getWorktreeMock: vi.fn(),
}));

vi.mock('./init.js', () => ({
  runInitCommand: runInitCommandMock,
}));

vi.mock('./project.js', () => ({
  runProjectCreateCommand: runProjectCreateCommandMock,
}));

vi.mock('./worktree.js', () => ({
  runWorktreeCreateCommand: runWorktreeCreateCommandMock,
  runWorktreeForkCommand: runWorktreeForkCommandMock,
  runWorktreeUpdateCommand: runWorktreeUpdateCommandMock,
}));

vi.mock('./server-token.js', () => ({
  runServerTokenCreateCommand: runServerTokenCreateCommandMock,
}));

vi.mock('../../storage/database-config.js', () => ({
  openConfiguredDatabase: openConfiguredDatabaseMock,
}));

vi.mock('../../storage/project.js', () => ({
  ensureProjectTables: ensureProjectTablesMock,
  getProject: getProjectMock,
}));

vi.mock('../../storage/worktree.js', () => ({
  ensureWorktreeTables: ensureWorktreeTablesMock,
  getWorktree: getWorktreeMock,
}));

import { runServerBootstrapCommand } from './server-bootstrap.js';

describe('server bootstrap command', () => {
  let originalDatabaseUrl: string | undefined;

  beforeEach(() => {
    originalDatabaseUrl = process.env['LGREP_DATABASE_URL'];
    process.env['LGREP_DATABASE_URL'] = 'postgres://example.com/lgrep';

    const fakeDb = { close: vi.fn().mockResolvedValue(undefined) };
    openConfiguredDatabaseMock.mockResolvedValue(fakeDb);
    ensureProjectTablesMock.mockResolvedValue(undefined);
    ensureWorktreeTablesMock.mockResolvedValue(undefined);

    runInitCommandMock.mockResolvedValue({ success: true });
    runProjectCreateCommandMock.mockResolvedValue({
      id: 'project-1',
      name: 'repo-main',
      displayName: null,
      repoUrl: null,
      model: 'openai:text-embedding-3-small',
      modelDims: 1536,
      chunkMaxTokens: 500,
      chunkOverlap: 50,
      excludePatterns: [],
      metadata: {},
      createdAt: 'now',
      updatedAt: 'now',
    });
    runServerTokenCreateCommandMock.mockResolvedValue({
      id: 'token-1',
      label: 'repo-main agents',
      token: 'secret-token',
      path: '/tmp/server-tokens.json',
      projects: ['repo-main'],
      worktrees: null,
      createdAt: 'now',
    });
    getProjectMock.mockReset().mockResolvedValue(null);
    getWorktreeMock.mockReset().mockResolvedValue(null);
    runWorktreeCreateCommandMock.mockResolvedValue({ success: true });
    runWorktreeForkCommandMock.mockResolvedValue({ success: true });
    runWorktreeUpdateCommandMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env['LGREP_DATABASE_URL'];
    } else {
      process.env['LGREP_DATABASE_URL'] = originalDatabaseUrl;
    }
    vi.clearAllMocks();
  });

  it('bootstraps a new hosted project with additional worktrees', async () => {
    const result = await runServerBootstrapCommand({
      path: '/repos/repo-main',
      project: 'repo-main',
      worktrees: [
        'feature-login|/repos/repo-feature-login|feature/login',
        'feature-billing|/repos/repo-feature-billing|feature/billing',
      ],
    });

    expect(runInitCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'cloud',
      profile: 'cloud',
      databaseUrlEnv: 'LGREP_DATABASE_URL',
      integration: 'none',
      skipIndex: true,
      yes: true,
    }));
    expect(runProjectCreateCommandMock).toHaveBeenCalledWith({
      name: 'repo-main',
      json: undefined,
    });
    expect(runWorktreeCreateCommandMock).toHaveBeenCalledWith({
      name: 'main',
      path: '/repos/repo-main',
      branch: undefined,
      project: 'repo-main',
      json: undefined,
    });
    expect(runWorktreeForkCommandMock).toHaveBeenCalledTimes(2);
    expect(runServerTokenCreateCommandMock).toHaveBeenCalledWith({
      label: 'repo-main agents',
      projects: 'repo-main',
    });
    expect(result.project).toMatchObject({
      name: 'repo-main',
      created: true,
    });
    expect(result.additionalWorktrees.map((worktree) => worktree.name)).toEqual([
      'feature-login',
      'feature-billing',
    ]);
    expect(result.token.value).toBe('secret-token');
    expect(result.server.startCommand).toContain('server start --port 8420');
    expect(result.server.tmuxCommand).toContain('tmux new-session -d -s lgrep-server-repo-main');
    expect(result.server.statusCommand).toContain('server status');
  });

  it('updates existing worktrees instead of recreating them', async () => {
    getProjectMock.mockResolvedValue({
      id: 'project-1',
      name: 'repo-main',
      displayName: null,
      repoUrl: null,
      model: 'openai:text-embedding-3-small',
      modelDims: 1536,
      chunkMaxTokens: 500,
      chunkOverlap: 50,
      excludePatterns: [],
      metadata: {},
      createdAt: 'now',
      updatedAt: 'now',
    });
    getWorktreeMock
      .mockResolvedValueOnce({
        id: 'wt-main',
        name: 'main',
        rootPath: '/repos/repo-main',
        branch: 'main',
      })
      .mockResolvedValueOnce({
        id: 'wt-login',
        name: 'feature-login',
        rootPath: '/repos/repo-feature-login',
        branch: 'feature/login',
      });

    const result = await runServerBootstrapCommand({
      path: '/repos/repo-main',
      project: 'repo-main',
      worktrees: ['feature-login|/repos/repo-feature-login|feature/login'],
    });

    expect(runProjectCreateCommandMock).not.toHaveBeenCalled();
    expect(runWorktreeCreateCommandMock).not.toHaveBeenCalled();
    expect(runWorktreeForkCommandMock).not.toHaveBeenCalled();
    expect(runWorktreeUpdateCommandMock).toHaveBeenCalledTimes(2);
    expect(result.project.created).toBe(false);
    expect(result.mainWorktree.action).toBe('updated');
    expect(result.additionalWorktrees[0]?.action).toBe('updated');
  });

  it('adds a hosted-token note for remote server URLs', async () => {
    const result = await runServerBootstrapCommand({
      path: '/repos/repo-main',
      project: 'repo-main',
      serverUrl: 'https://lgrep.example.com',
    });

    expect(result.notes).toContain(
      'Scoped tokens are stored in /tmp/server-tokens.json. Remote deployments like Railway still authenticate with LGREP_SERVER_AUTH_TOKEN until DB-backed hosted token storage ships.'
    );
  });
});
