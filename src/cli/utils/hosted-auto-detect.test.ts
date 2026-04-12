import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryServerMock, execFileSyncMock } = vi.hoisted(() => ({
  queryServerMock: vi.fn(),
  execFileSyncMock: vi.fn(),
}));

vi.mock('../../server/client.js', () => ({
  queryServer: queryServerMock,
}));

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { detectHostedScopeForDirectory } from './hosted-auto-detect.js';

describe('detectHostedScopeForDirectory', () => {
  beforeEach(() => {
    queryServerMock.mockReset();
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('matches the current git repo and branch to a hosted project/worktree', async () => {
    execFileSyncMock
      .mockImplementationOnce(() => '/Users/example/repos/lgrep\n')
      .mockImplementationOnce(() => 'codex/local-cloud-onboarding\n');

    queryServerMock.mockImplementation(async (request: { method: string; project?: string }) => {
      if (request.method === 'projects') {
        return {
          projects: [
            {
              id: 'p1',
              name: 'lgrep',
              displayName: null,
              repoUrl: null,
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      if (request.method === 'worktrees' && request.project === 'lgrep') {
        return {
          project: 'lgrep',
          worktrees: [
            {
              id: 'w1',
              name: 'global-remote-install',
              rootPath: null,
              repoUrl: null,
              branch: 'codex/global-remote-install',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
            {
              id: 'w2',
              name: 'local-cloud-onboarding',
              rootPath: null,
              repoUrl: null,
              branch: 'codex/local-cloud-onboarding',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 2,
        };
      }

      throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
    });

    const result = await detectHostedScopeForDirectory('/Users/example/repos/lgrep/src');

    expect(result).toEqual({
      project: 'lgrep',
      worktree: 'local-cloud-onboarding',
    });
  });

  it('falls back to the single hosted project when the repo name does not match', async () => {
    execFileSyncMock
      .mockImplementationOnce(() => '/Users/example/repos/unknown\n')
      .mockImplementationOnce(() => '\n');

    queryServerMock.mockImplementation(async (request: { method: string; project?: string }) => {
      if (request.method === 'projects') {
        return {
          projects: [
            {
              id: 'p1',
              name: 'repo-main',
              displayName: null,
              repoUrl: null,
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      if (request.method === 'worktrees' && request.project === 'repo-main') {
        return {
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
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
    });

    const result = await detectHostedScopeForDirectory('/Users/example/repos/unknown');

    expect(result).toEqual({
      project: 'repo-main',
      worktree: 'main',
    });
  });

  it('returns null when multiple hosted worktrees match equally', async () => {
    execFileSyncMock
      .mockImplementationOnce(() => '/Users/example/repos/demo\n')
      .mockImplementationOnce(() => 'feature/login\n');

    queryServerMock.mockImplementation(async (request: { method: string; project?: string }) => {
      if (request.method === 'projects') {
        return {
          projects: [
            {
              id: 'p1',
              name: 'demo',
              displayName: null,
              repoUrl: null,
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      if (request.method === 'worktrees' && request.project === 'demo') {
        return {
          project: 'demo',
          worktrees: [
            {
              id: 'w1',
              name: 'feature-login',
              rootPath: null,
              repoUrl: null,
              branch: 'feature/login',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
            {
              id: 'w2',
              name: 'feature-login',
              rootPath: null,
              repoUrl: null,
              branch: 'feature/login',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 2,
        };
      }

      throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
    });

    const result = await detectHostedScopeForDirectory('/Users/example/repos/demo');

    expect(result).toEqual({
      project: 'demo',
      worktree: undefined,
    });
  });
});
