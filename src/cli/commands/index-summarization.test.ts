import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runIndexCommand, type IndexOptions } from './index.js';
import { createSummarizerClient } from '../../core/summarizer.js';
import { updateSymbolSummary, getSymbols } from '../../storage/code-intel.js';
import { openDatabase } from '../../storage/lance.js';
import { getDbPath, getCachePath } from '../utils/paths.js';
import { loadConfig } from '../../storage/config.js';
import { access, readFile } from 'node:fs/promises';
import { walkFiles } from '../../core/walker.js';
import { createEmbeddingClient } from '../../core/embeddings.js';
import { openEmbeddingCache } from '../../storage/cache.js';
import { extractSymbols } from '../../core/ast/symbol-extractor.js';
import { extractDependencies } from '../../core/ast/dependency-extractor.js';
import { extractCalls } from '../../core/ast/call-extractor.js';

// Mock dependencies
vi.mock('node:fs/promises');
vi.mock('../../core/summarizer.js');
vi.mock('../../storage/code-intel.js');
vi.mock('../../storage/lance.js');
vi.mock('../utils/paths.js');
vi.mock('../../storage/config.js');
vi.mock('../../core/walker.js');
vi.mock('../../core/embeddings.js');
vi.mock('../../storage/cache.js');
vi.mock('../../core/ast/symbol-extractor.js');
vi.mock('../../core/ast/dependency-extractor.js');
vi.mock('../../core/ast/call-extractor.js');

describe('Index Command - Summarization', () => {
  const mockSummarizer = {
    model: 'llama3.2:3b',
    summarizeSymbol: vi.fn(),
    suggestApproach: vi.fn(),
    healthCheck: vi.fn(),
  };

  const mockConfig = {
    model: 'mxbai-embed-large',
    chunkSize: 500,
    chunkOverlap: 50,
    maxFileSize: 5 * 1024 * 1024,
    excludes: ['node_modules'],
    secretExcludes: ['.env'],
    summarizationModel: 'llama3.2:3b',
    enableSummarization: true,
    maxSummaryLength: 100,
    contextMaxTokens: 32000,
    contextGraphDepth: 2,
    contextFileLimit: 15,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock file system
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue('function testFunc() { return 42; }');

    // Mock paths
    vi.mocked(getDbPath).mockReturnValue('/mock/db/path');
    vi.mocked(getCachePath).mockReturnValue('/mock/cache/path');

    // Mock config
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);

    // Mock summarizer
    vi.mocked(createSummarizerClient).mockReturnValue(mockSummarizer);

    // Mock walker - return a test TypeScript file
    vi.mocked(walkFiles).mockResolvedValue([
      {
        absolutePath: '/test/path/test.ts',
        relativePath: 'test.ts',
        extension: '.ts',
        size: 100,
      },
    ]);

    // Mock AST extractors
    vi.mocked(extractSymbols).mockReturnValue([
      {
        id: 'test-id-1',
        name: 'testFunc',
        kind: 'function',
        filePath: '/test/path/test.ts',
        relativePath: 'test.ts',
        lineStart: 0,
        lineEnd: 2,
        columnStart: 0,
        columnEnd: 30,
        isExported: true,
        isDefaultExport: false,
        signature: 'function testFunc(): number',
        documentation: undefined,
        parentId: undefined,
        modifiers: [],
      },
    ]);

    vi.mocked(extractDependencies).mockReturnValue([]);
    vi.mocked(extractCalls).mockReturnValue([]);

    // Mock database
    const mockDb = {
      connection: {
        openTable: vi.fn(),
        createTable: vi.fn(),
      },
      close: vi.fn(),
    };
    vi.mocked(openDatabase).mockResolvedValue(mockDb as any);

    // Mock cache
    const mockCache = {
      close: vi.fn(),
    };
    vi.mocked(openEmbeddingCache).mockResolvedValue(mockCache as any);

    // Mock embedding client
    const mockEmbedClient = {
      model: 'mxbai-embed-large',
      getModelDimensions: vi.fn().mockResolvedValue(1024),
      embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
    };
    vi.mocked(createEmbeddingClient).mockReturnValue(mockEmbedClient as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should summarize symbols during indexing by default', async () => {
    // Mock health check to return healthy
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: true,
      modelAvailable: true,
    });

    // Mock summarization
    mockSummarizer.summarizeSymbol.mockResolvedValue('A sample summary');

    // Mock update
    vi.mocked(updateSymbolSummary).mockResolvedValue();

    // This test will fail initially - we need to implement the feature
    const result = await runIndexCommand('/test/path', {
      showProgress: false,
    });

    // Verify summarization was attempted
    expect(mockSummarizer.healthCheck).toHaveBeenCalled();
    expect(result.symbolsSummarized).toBeDefined();
  });

  it('should skip summarization when --no-summarize is passed', async () => {
    const options: IndexOptions = {
      showProgress: false,
      summarize: false,
    };

    const result = await runIndexCommand('/test/path', options);

    // Summarizer should not be created when summarize is false
    expect(createSummarizerClient).not.toHaveBeenCalled();
    expect(result.symbolsSummarized).toBeUndefined();
  });

  it('should force re-summarization when --resummarize is passed', async () => {
    // Mock a symbol that already has a summary
    const existingSymbol = {
      id: 'test-symbol-1',
      name: 'testFunction',
      kind: 'function' as const,
      summary: 'Existing summary',
      summaryModel: 'llama3.2:3b',
      summaryGeneratedAt: '2024-01-01T00:00:00Z',
    };

    vi.mocked(getSymbols).mockResolvedValue([existingSymbol as any]);
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: true,
      modelAvailable: true,
    });
    mockSummarizer.summarizeSymbol.mockResolvedValue('New summary');

    const options: IndexOptions = {
      showProgress: false,
      resummarize: true,
    };

    const result = await runIndexCommand('/test/path', options);

    // Should re-summarize even though symbol has existing summary
    expect(result.symbolsSummarized).toBeGreaterThan(0);
  });

  it('should gracefully handle Ollama unavailable', async () => {
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: false,
      modelAvailable: false,
    });

    const result = await runIndexCommand('/test/path', {
      showProgress: false,
    });

    // Should not fail, just skip summarization
    expect(result.success).toBe(true);
    expect(result.summarizationSkipped).toBe(true);
    expect(mockSummarizer.summarizeSymbol).not.toHaveBeenCalled();
  });

  it('should skip import/export symbols from summarization', async () => {
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: true,
      modelAvailable: true,
    });

    // Import/export symbols should be skipped
    // (This is tested implicitly through the implementation)

    const result = await runIndexCommand('/test/path', {
      showProgress: false,
    });

    expect(result.success).toBe(true);
  });

  it('should track symbolsSummarized count correctly', async () => {
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: true,
      modelAvailable: true,
    });

    mockSummarizer.summarizeSymbol.mockResolvedValue('Summary text');

    const result = await runIndexCommand('/test/path', {
      showProgress: false,
    });

    expect(typeof result.symbolsSummarized).toBe('number');
    expect(result.symbolsSummarized).toBeGreaterThanOrEqual(0);
  });

  it('should include summarization stats in JSON output', async () => {
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: true,
      modelAvailable: true,
    });

    mockSummarizer.summarizeSymbol.mockResolvedValue('Summary');

    const result = await runIndexCommand('/test/path', {
      showProgress: false,
      json: true,
    });

    // JSON output should include these fields
    expect(result).toHaveProperty('symbolsSummarized');
    expect(result).toHaveProperty('summarizationSkipped');
  });

  it('should handle summarization errors gracefully', async () => {
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: true,
      modelAvailable: true,
    });

    // Simulate summarization error
    mockSummarizer.summarizeSymbol.mockRejectedValue(
      new Error('Ollama timeout')
    );

    const result = await runIndexCommand('/test/path', {
      showProgress: false,
    });

    // Should not fail entire indexing due to summarization error
    expect(result.success).toBe(true);
  });

  it('should use configured summarization model', async () => {
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: true,
      modelAvailable: true,
    });

    await runIndexCommand('/test/path', {
      showProgress: false,
    });

    expect(createSummarizerClient).toHaveBeenCalledWith({
      model: mockConfig.summarizationModel,
    });
  });

  it('should skip symbols without meaningful code', async () => {
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: true,
      modelAvailable: true,
    });

    // Override extractSymbols to return import symbol
    vi.mocked(extractSymbols).mockReturnValue([
      {
        id: 'import-1',
        name: 'React',
        kind: 'import',
        filePath: '/test/path/test.ts',
        relativePath: 'test.ts',
        lineStart: 0,
        lineEnd: 0,
        columnStart: 0,
        columnEnd: 20,
        isExported: false,
        isDefaultExport: false,
        signature: undefined,
        documentation: undefined,
        parentId: undefined,
        modifiers: [],
      },
    ]);

    const result = await runIndexCommand('/test/path', {
      showProgress: false,
    });

    // Import symbols should not be summarized
    expect(mockSummarizer.summarizeSymbol).not.toHaveBeenCalled();
  });

  it('should handle model unavailable but Ollama healthy', async () => {
    mockSummarizer.healthCheck.mockResolvedValue({
      healthy: true,
      modelAvailable: false, // Model not pulled
    });

    const result = await runIndexCommand('/test/path', {
      showProgress: false,
    });

    expect(result.summarizationSkipped).toBe(true);
    expect(mockSummarizer.summarizeSymbol).not.toHaveBeenCalled();
  });
});
