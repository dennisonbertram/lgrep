import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryServerMock, getServerUrlMock } = vi.hoisted(() => ({
  queryServerMock: vi.fn(),
  getServerUrlMock: vi.fn(),
}));

vi.mock('../../server/client.js', () => ({
  queryServer: queryServerMock,
  getServerUrl: getServerUrlMock,
}));

import { runProjectInfoCommand, runProjectListCommand } from './project.js';

describe('project commands (hosted server)', () => {
  beforeEach(() => {
    queryServerMock.mockReset();
    getServerUrlMock.mockReset();
    getServerUrlMock.mockReturnValue('https://lgrep.example.com');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the hosted query server for project listing', async () => {
    queryServerMock.mockResolvedValue({
      projects: [
        {
          id: 'p1',
          name: 'repo-main',
          displayName: 'Repo Main',
          repoUrl: 'git@example.com:repo.git',
          model: 'openai:text-embedding-3-small',
          modelDims: 1536,
          chunkMaxTokens: 500,
          chunkOverlap: 50,
          createdAt: 'now',
          updatedAt: 'now',
        },
      ],
      count: 1,
    });

    const result = await runProjectListCommand();

    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'projects',
      params: {},
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('repo-main');
  });

  it('uses the hosted query server for project info', async () => {
    queryServerMock.mockResolvedValue({
      project: {
        id: 'p1',
        name: 'repo-main',
        displayName: 'Repo Main',
        repoUrl: 'git@example.com:repo.git',
        model: 'openai:text-embedding-3-small',
        modelDims: 1536,
        chunkMaxTokens: 500,
        chunkOverlap: 50,
        createdAt: 'now',
        updatedAt: 'now',
      },
      stats: {
        worktreeCount: 2,
        totalFiles: 2000,
        uniqueFiles: 1400,
        totalChunks: 5000,
        uniqueChunks: 3200,
        storageSavingsPercent: 36,
      },
      worktrees: [
        { name: 'main', status: 'ready', branch: 'main', fileCount: 1200, chunkCount: 3000 },
        { name: 'feature-login', status: 'ready', branch: 'feature/login', fileCount: 800, chunkCount: 2000 },
      ],
    });

    const result = await runProjectInfoCommand('repo-main');

    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'project-info',
      project: 'repo-main',
      params: {},
    });
    expect(result.stats.worktreeCount).toBe(2);
    expect(result.worktrees.map((worktree) => worktree.name)).toEqual(['main', 'feature-login']);
  });
});
