import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryServerMock, getServerUrlMock } = vi.hoisted(() => ({
  queryServerMock: vi.fn(),
  getServerUrlMock: vi.fn(),
}));

vi.mock('../../server/client.js', () => ({
  queryServer: queryServerMock,
  getServerUrl: getServerUrlMock,
}));

import { runCallersCommand } from './callers.js';
import { runImpactCommand } from './impact.js';
import { runContextCommand } from './context.js';

describe('hosted read commands', () => {
  beforeEach(() => {
    queryServerMock.mockReset();
    getServerUrlMock.mockReset();
    getServerUrlMock.mockReturnValue('https://lgrep.example.com');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the hosted query server for callers', async () => {
    queryServerMock.mockResolvedValue({
      symbol: 'createSession',
      project: 'repo-main',
      callers: [
        {
          file: 'feature-login:src/app.ts',
          line: 5,
          callerName: 'startApp',
          callerKind: 'function',
          worktreeName: 'feature-login',
        },
      ],
      count: 1,
    });

    const result = await runCallersCommand('createSession', {
      project: 'repo-main',
      showProgress: false,
      json: true,
    });

    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'callers',
      project: 'repo-main',
      worktree: undefined,
      params: { symbol: 'createSession' },
    });
    expect(result.callers?.[0]?.callerName).toBe('startApp');
    expect(result.count).toBe(1);
  });

  it('uses the hosted query server for impact', async () => {
    queryServerMock.mockResolvedValue({
      symbol: 'createSession',
      project: 'repo-main',
      worktree: 'feature-login',
      directCallers: [
        {
          file: 'src/app.ts',
          line: 5,
          callerName: 'startApp',
          callerKind: 'function',
        },
      ],
      transitiveFiles: ['src/routes.ts'],
      totalFiles: 2,
    });

    const result = await runImpactCommand('createSession', {
      project: 'repo-main',
      worktree: 'feature-login',
      showProgress: false,
      json: true,
    });

    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'impact',
      project: 'repo-main',
      worktree: 'feature-login',
      params: { symbol: 'createSession' },
    });
    expect(result.totalFiles).toBe(2);
    expect(result.transitiveFiles).toEqual(['src/routes.ts']);
  });

  it('uses the hosted query server for context packages', async () => {
    queryServerMock.mockResolvedValue({
      task: 'understand session token flow',
      indexName: 'repo-main/feature-login',
      project: 'repo-main',
      worktree: 'feature-login',
      relevantFiles: [
        {
          filePath: 'src/session.ts',
          relativePath: 'src/session.ts',
          score: 0.9,
          relevance: 0.9,
          reason: 'Semantic match',
          content: 'export function createSession() {}',
        },
      ],
      keySymbols: [],
      suggestedApproach: [],
      tokenCount: 42,
      timestamp: 'now',
      files: [],
      symbols: [],
    });

    const result = await runContextCommand('understand session token flow', {
      project: 'repo-main',
      worktree: 'feature-login',
      limit: 5,
      maxTokens: 2000,
      summaryOnly: true,
      noApproach: true,
      json: true,
    });

    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'context',
      project: 'repo-main',
      worktree: 'feature-login',
      params: {
        task: 'understand session token flow',
        limit: 5,
        maxTokens: 2000,
        depth: undefined,
        summaryOnly: true,
        noApproach: true,
      },
    });
    expect(result.indexName).toBe('repo-main/feature-login');
    expect(result.relevantFiles).toHaveLength(1);
  });
});
