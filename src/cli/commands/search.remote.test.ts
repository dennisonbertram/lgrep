import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryServerMock,
  getServerUrlMock,
  openConfiguredDatabaseMock,
  detectHostedScopeForDirectoryMock,
} = vi.hoisted(() => ({
  queryServerMock: vi.fn(),
  getServerUrlMock: vi.fn(),
  openConfiguredDatabaseMock: vi.fn(),
  detectHostedScopeForDirectoryMock: vi.fn(),
}));

vi.mock('../../server/client.js', () => ({
  queryServer: queryServerMock,
  getServerUrl: getServerUrlMock,
}));

vi.mock('../../storage/database-config.js', () => ({
  openConfiguredDatabase: openConfiguredDatabaseMock,
}));

vi.mock('../utils/hosted-auto-detect.js', () => ({
  detectHostedScopeForDirectory: detectHostedScopeForDirectoryMock,
}));

vi.mock('../utils/progress.js', () => ({
  createSpinner: vi.fn(() => ({
    start: vi.fn(),
    update: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  })),
}));

import { runSearchCommand } from './search.js';

describe('search command (hosted server)', () => {
  beforeEach(() => {
    queryServerMock.mockReset();
    getServerUrlMock.mockReset();
    openConfiguredDatabaseMock.mockReset();
    detectHostedScopeForDirectoryMock.mockReset();
    getServerUrlMock.mockReturnValue('https://lgrep.example.com');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the hosted query server for project-scoped semantic search', async () => {
    detectHostedScopeForDirectoryMock.mockResolvedValue(null);

    queryServerMock.mockResolvedValue({
      project: 'demo-project',
      results: [
        {
          relativePath: 'src/auth.ts',
          content: 'export function authenticate() {}',
          score: 0.91,
          lineStart: 4,
          lineEnd: 8,
          chunkIndex: 0,
        },
      ],
      count: 1,
    });

    const result = await runSearchCommand('authentication flow', {
      project: 'demo-project',
      showProgress: false,
      json: true,
    });

    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'search',
      project: 'demo-project',
      worktree: undefined,
      params: {
        query: 'authentication flow',
        limit: 10,
        diversity: 0.7,
      },
    });
    expect(openConfiguredDatabaseMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      indexName: 'demo-project',
      count: 1,
      results: [
        {
          filePath: 'src/auth.ts',
          relativePath: 'src/auth.ts',
          score: 0.91,
        },
      ],
    });
  });

  it('auto-detects hosted project and worktree from the current directory', async () => {
    detectHostedScopeForDirectoryMock.mockResolvedValue({
      project: 'lgrep',
      worktree: 'local-cloud-onboarding',
    });

    queryServerMock.mockResolvedValue({
      project: 'lgrep',
      worktree: 'local-cloud-onboarding',
      results: [
        {
          relativePath: 'src/cli/commands/server-install-remote.ts',
          content: 'export async function runServerInstallRemoteCommand() {}',
          score: 0.94,
          lineStart: 12,
          lineEnd: 24,
          chunkIndex: 0,
        },
      ],
      count: 1,
    });

    const result = await runSearchCommand('server install remote', {
      showProgress: false,
      json: true,
    });

    expect(detectHostedScopeForDirectoryMock).toHaveBeenCalledTimes(1);
    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'search',
      project: 'lgrep',
      worktree: 'local-cloud-onboarding',
      params: {
        query: 'server install remote',
        limit: 10,
        diversity: 0.7,
      },
    });
    expect(result.indexName).toBe('local-cloud-onboarding');
    expect(openConfiguredDatabaseMock).not.toHaveBeenCalled();
  });

  it('falls back to local storage when an explicit index is requested', async () => {
    openConfiguredDatabaseMock.mockRejectedValue(new Error('local path used'));

    await expect(runSearchCommand('authentication flow', {
      index: 'local-index',
      project: 'demo-project',
      showProgress: false,
    })).rejects.toThrow('local path used');

    expect(queryServerMock).not.toHaveBeenCalled();
    expect(openConfiguredDatabaseMock).toHaveBeenCalled();
  });

  it('fails closed when hosted scope cannot be resolved for the current worktree', async () => {
    detectHostedScopeForDirectoryMock.mockResolvedValue(null);

    await expect(runSearchCommand('authentication flow', {
      showProgress: false,
      json: true,
    })).rejects.toThrow('lgrep worktree resolve');

    expect(queryServerMock).not.toHaveBeenCalled();
    expect(openConfiguredDatabaseMock).not.toHaveBeenCalled();
  });
});
