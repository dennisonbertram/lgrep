import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryServerMock, getServerUrlMock } = vi.hoisted(() => ({
  queryServerMock: vi.fn(),
  getServerUrlMock: vi.fn(),
}));

vi.mock('../../server/client.js', () => ({
  queryServer: queryServerMock,
  getServerUrl: getServerUrlMock,
}));

import { runWorktreeDiffCommand, runWorktreeListCommand } from './worktree.js';

describe('worktree commands (hosted server)', () => {
  beforeEach(() => {
    queryServerMock.mockReset();
    getServerUrlMock.mockReset();
    getServerUrlMock.mockReturnValue('https://lgrep.example.com');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the hosted query server for worktree listing', async () => {
    queryServerMock.mockResolvedValue({
      project: 'repo-main',
      worktrees: [
        {
          id: 'w1',
          name: 'main',
          rootPath: null,
          repoUrl: null,
          branch: 'main',
          baseCommit: null,
          parentId: null,
          projectId: 'p1',
          model: 'openai:text-embedding-3-small',
          modelDims: 1536,
          chunkMaxTokens: 500,
          chunkOverlap: 50,
          status: 'ready',
          fileCount: 1200,
          chunkCount: 3000,
          createdAt: 'now',
          updatedAt: 'now',
        },
      ],
      count: 1,
    });

    const result = await runWorktreeListCommand({ project: 'repo-main' });

    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'worktrees',
      project: 'repo-main',
      params: {},
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.rootPath).toBeNull();
  });

  it('uses the hosted query server for worktree diffs', async () => {
    queryServerMock.mockResolvedValue({
      a: 'main',
      b: 'feature-login',
      diffs: [
        { path: 'src/auth.ts', changeType: 'modified' },
        { path: 'src/session.ts', changeType: 'added' },
      ],
      count: 2,
    });

    const result = await runWorktreeDiffCommand('main', 'feature-login');

    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'diff',
      params: { a: 'main', b: 'feature-login' },
    });
    expect(result).toHaveLength(2);
    expect(result[0]?.path).toBe('src/auth.ts');
  });
});
