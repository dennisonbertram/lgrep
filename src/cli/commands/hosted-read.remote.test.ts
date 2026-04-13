import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryServerMock, getServerUrlMock, detectHostedScopeForDirectoryMock } = vi.hoisted(() => ({
  queryServerMock: vi.fn(),
  getServerUrlMock: vi.fn(),
  detectHostedScopeForDirectoryMock: vi.fn(),
}));

vi.mock('../../server/client.js', () => ({
  queryServer: queryServerMock,
  getServerUrl: getServerUrlMock,
}));

vi.mock('../utils/hosted-auto-detect.js', () => ({
  detectHostedScopeForDirectory: detectHostedScopeForDirectoryMock,
}));

import { runCallersCommand } from './callers.js';
import { runImpactCommand } from './impact.js';
import { runContextCommand } from './context.js';

describe('hosted read commands', () => {
  beforeEach(() => {
    queryServerMock.mockReset();
    getServerUrlMock.mockReset();
    detectHostedScopeForDirectoryMock.mockReset();
    getServerUrlMock.mockReturnValue('https://lgrep.example.com');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the hosted query server for callers', async () => {
    detectHostedScopeForDirectoryMock.mockResolvedValue(null);

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

  it('auto-detects hosted scope for callers', async () => {
    detectHostedScopeForDirectoryMock.mockResolvedValue({
      project: 'lgrep',
      worktree: 'local-cloud-onboarding',
    });

    queryServerMock.mockResolvedValue({
      symbol: 'runInstallCommand',
      project: 'lgrep',
      worktree: 'local-cloud-onboarding',
      callers: [
        {
          file: 'src/cli/index.ts',
          line: 1204,
          callerName: 'registerInstallCommand',
          callerKind: 'function',
          worktreeName: 'local-cloud-onboarding',
        },
      ],
      count: 1,
    });

    const result = await runCallersCommand('runInstallCommand', {
      showProgress: false,
      json: true,
    });

    expect(detectHostedScopeForDirectoryMock).toHaveBeenCalledTimes(1);
    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'callers',
      project: 'lgrep',
      worktree: 'local-cloud-onboarding',
      params: { symbol: 'runInstallCommand' },
    });
    expect(result.indexName).toBe('local-cloud-onboarding');
  });

  it('uses the hosted query server for impact', async () => {
    detectHostedScopeForDirectoryMock.mockResolvedValue(null);

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
    detectHostedScopeForDirectoryMock.mockResolvedValue({
      project: 'repo-main',
      worktree: undefined,
    });

    queryServerMock.mockResolvedValue({
      task: 'understand session token flow',
      indexName: 'repo-main',
      project: 'repo-main',
      worktree: undefined,
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
      limit: 5,
      maxTokens: 2000,
      summaryOnly: true,
      noApproach: true,
      json: true,
    });

    expect(queryServerMock).toHaveBeenCalledWith({
      method: 'context',
      project: 'repo-main',
      worktree: undefined,
      params: {
        task: 'understand session token flow',
        limit: 5,
        maxTokens: 2000,
        depth: undefined,
        summaryOnly: true,
        noApproach: true,
      },
    });
    expect(detectHostedScopeForDirectoryMock).toHaveBeenCalledTimes(1);
    expect(result.indexName).toBe('repo-main');
    expect(result.relevantFiles).toHaveLength(1);
  });

  it('fails closed for callers when hosted scope cannot be resolved', async () => {
    detectHostedScopeForDirectoryMock.mockResolvedValue(null);

    await expect(runCallersCommand('runInstallCommand', {
      showProgress: false,
      json: true,
    })).rejects.toThrow('lgrep worktree resolve');

    expect(queryServerMock).not.toHaveBeenCalled();
  });
});
