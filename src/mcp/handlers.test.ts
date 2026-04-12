import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSearchCommand: vi.fn(),
  runCallersCommand: vi.fn(),
  runImpactCommand: vi.fn(),
  runDepsCommand: vi.fn(),
  runDeadCommand: vi.fn(),
  runSimilarCommand: vi.fn(),
  runCyclesCommand: vi.fn(),
  runUnusedExportsCommand: vi.fn(),
  runBreakingCommand: vi.fn(),
  runRenameCommand: vi.fn(),
  runContextCommand: vi.fn(),
  runSymbolsCommand: vi.fn(),
  runExplainCommand: vi.fn(),
  runStatsCommand: vi.fn(),
}));

vi.mock('../cli/commands/search.js', () => ({
  runSearchCommand: mocks.runSearchCommand,
}));
vi.mock('../cli/commands/callers.js', () => ({
  runCallersCommand: mocks.runCallersCommand,
}));
vi.mock('../cli/commands/impact.js', () => ({
  runImpactCommand: mocks.runImpactCommand,
}));
vi.mock('../cli/commands/deps.js', () => ({
  runDepsCommand: mocks.runDepsCommand,
}));
vi.mock('../cli/commands/dead.js', () => ({
  runDeadCommand: mocks.runDeadCommand,
}));
vi.mock('../cli/commands/similar.js', () => ({
  runSimilarCommand: mocks.runSimilarCommand,
}));
vi.mock('../cli/commands/cycles.js', () => ({
  runCyclesCommand: mocks.runCyclesCommand,
}));
vi.mock('../cli/commands/unused-exports.js', () => ({
  runUnusedExportsCommand: mocks.runUnusedExportsCommand,
}));
vi.mock('../cli/commands/breaking.js', () => ({
  runBreakingCommand: mocks.runBreakingCommand,
}));
vi.mock('../cli/commands/rename.js', () => ({
  runRenameCommand: mocks.runRenameCommand,
}));
vi.mock('../cli/commands/context.js', () => ({
  runContextCommand: mocks.runContextCommand,
}));
vi.mock('../cli/commands/symbols.js', () => ({
  runSymbolsCommand: mocks.runSymbolsCommand,
}));
vi.mock('../cli/commands/explain.js', () => ({
  runExplainCommand: mocks.runExplainCommand,
}));
vi.mock('../cli/commands/stats.js', () => ({
  runStatsCommand: mocks.runStatsCommand,
}));

import { handleSearch, handleStats, handleToolCall } from './handlers.js';

describe('MCP handlers', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mockFn) => mockFn.mockReset());
  });

  it('routes search through the CLI command layer with JSON-safe options', async () => {
    mocks.runSearchCommand.mockResolvedValue({
      success: true,
      results: [{ filePath: '/repo/src/app.ts' }],
    });

    const response = await handleSearch({
      query: 'find auth middleware',
      index: 'remote-index',
      project: 'repo-main',
      worktree: 'feature-login',
      limit: 5,
      diversity: 0.4,
      definition: 'authenticate',
    });

    expect(mocks.runSearchCommand).toHaveBeenCalledWith('find auth middleware', {
      index: 'remote-index',
      project: 'repo-main',
      worktree: 'feature-login',
      limit: 5,
      diversity: 0.4,
      usages: undefined,
      definition: 'authenticate',
      type: undefined,
      json: true,
      showProgress: false,
    });
    expect(response).toEqual([
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            results: [{ filePath: '/repo/src/app.ts' }],
          },
          null,
          2
        ),
      },
    ]);
  });

  it('routes hosted callers through the same CLI layer', async () => {
    mocks.runCallersCommand.mockResolvedValue({
      success: true,
      callers: [{ file: 'feature-login:src/app.ts', line: 10 }],
      count: 1,
    });

    const response = await handleToolCall('lgrep_callers', {
      symbol: 'createSession',
      project: 'repo-main',
      worktree: 'feature-login',
    });

    expect(mocks.runCallersCommand).toHaveBeenCalledWith('createSession', {
      index: undefined,
      project: 'repo-main',
      worktree: 'feature-login',
      json: true,
      showProgress: false,
    });
    expect(JSON.parse(response[0]!.text)).toMatchObject({
      success: true,
      count: 1,
    });
  });

  it('routes stats through the same storage-backed command layer', async () => {
    mocks.runStatsCommand.mockResolvedValue({
      success: true,
      index: { name: 'remote-index', chunks: 42 },
    });

    const response = await handleStats({ index: 'remote-index' });

    expect(mocks.runStatsCommand).toHaveBeenCalledWith({
      index: 'remote-index',
      json: true,
      showProgress: false,
    });
    expect(JSON.parse(response[0]!.text)).toEqual({
      success: true,
      index: { name: 'remote-index', chunks: 42 },
    });
  });

  it('rejects unknown tool names', async () => {
    await expect(handleToolCall('lgrep_unknown', {})).rejects.toThrow(
      'Unknown tool: lgrep_unknown'
    );
  });
});
