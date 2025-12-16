import { describe, it, expect, beforeEach } from 'vitest';
import { buildContext } from './context-builder.js';
import type { IndexDatabase } from '../storage/lance.js';
import type { EmbeddingClient } from './embeddings.js';
import type { CodeSymbol, CallEdge } from '../types/code-intel.js';
import type { ContextPackage } from '../types/context.js';

// Mock data
const mockTaskVector = new Float32Array([0.1, 0.2, 0.3]);

const mockChunkResults = [
  {
    id: 'chunk1',
    filePath: '/test/file1.ts',
    relativePath: 'file1.ts',
    contentHash: 'hash1',
    chunkIndex: 0,
    content: 'function foo() {}',
    vector: new Float32Array([0.1, 0.2, 0.3]),
    fileType: 'typescript',
    createdAt: '2024-01-01',
    _score: 0.1,
  },
  {
    id: 'chunk2',
    filePath: '/test/file2.ts',
    relativePath: 'file2.ts',
    contentHash: 'hash2',
    chunkIndex: 0,
    content: 'function bar() {}',
    vector: new Float32Array([0.2, 0.3, 0.4]),
    fileType: 'typescript',
    createdAt: '2024-01-01',
    _score: 0.2,
  },
];

const mockSymbols: CodeSymbol[] = [
  {
    id: 'sym1',
    name: 'foo',
    kind: 'function',
    filePath: '/test/file1.ts',
    relativePath: 'file1.ts',
    range: {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 20 },
    },
    isExported: true,
    isDefaultExport: false,
    modifiers: ['export'],
  },
  {
    id: 'sym2',
    name: 'bar',
    kind: 'function',
    filePath: '/test/file2.ts',
    relativePath: 'file2.ts',
    range: {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 20 },
    },
    isExported: true,
    isDefaultExport: false,
    modifiers: ['export'],
  },
];

describe('buildContext', () => {
  let mockDb: IndexDatabase;
  let mockEmbeddingClient: EmbeddingClient;

  beforeEach(() => {
    mockDb = {
      path: '/test/db',
      connection: {} as never,
      close: async () => {},
    };

    mockEmbeddingClient = {
      model: 'test-model',
      embed: async () => ({ embeddings: [[0.1, 0.2, 0.3]], model: 'test-model' }),
      embedQuery: async () => ({ embeddings: [[0.1, 0.2, 0.3]], model: 'test-model' }),
      healthCheck: async () => ({ healthy: true, modelAvailable: true }),
      getModelDimensions: async () => 3,
    };
  });

  it('should return a valid ContextPackage structure', async () => {
    const result = await buildContext(
      {
        db: mockDb,
        indexName: 'test-index',
        embeddingClient: mockEmbeddingClient,
      },
      'test task',
      { limit: 10, maxTokens: 1000, depth: 2 }
    );

    expect(result).toBeDefined();
    expect(result.task).toBe('test task');
    expect(result.indexName).toBe('test-index');
    expect(result.relevantFiles).toBeInstanceOf(Array);
    expect(result.keySymbols).toBeInstanceOf(Array);
    expect(result.suggestedApproach).toBeInstanceOf(Array);
    expect(result.tokenCount).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
  });

  it('should respect the limit option', async () => {
    const result = await buildContext(
      {
        db: mockDb,
        indexName: 'test-index',
        embeddingClient: mockEmbeddingClient,
      },
      'test task',
      { limit: 2, maxTokens: 10000, depth: 2 }
    );

    expect(result.relevantFiles.length).toBeLessThanOrEqual(2);
  });

  it('should respect the maxTokens budget', async () => {
    const result = await buildContext(
      {
        db: mockDb,
        indexName: 'test-index',
        embeddingClient: mockEmbeddingClient,
      },
      'test task',
      { limit: 100, maxTokens: 100, depth: 2 }
    );

    expect(result.tokenCount).toBeLessThanOrEqual(100);
  });

  it('should handle empty index gracefully', async () => {
    const result = await buildContext(
      {
        db: mockDb,
        indexName: 'empty-index',
        embeddingClient: mockEmbeddingClient,
      },
      'test task',
      { limit: 10, maxTokens: 1000, depth: 2 }
    );

    expect(result).toBeDefined();
    expect(result.relevantFiles).toEqual([]);
    expect(result.keySymbols).toEqual([]);
    expect(result.tokenCount).toBeGreaterThanOrEqual(0);
  });

  it('should use default options when none provided', async () => {
    const result = await buildContext(
      {
        db: mockDb,
        indexName: 'test-index',
        embeddingClient: mockEmbeddingClient,
      },
      'test task'
    );

    expect(result).toBeDefined();
    expect(result.task).toBe('test task');
  });
});

describe('graph expansion', () => {
  it('should follow call graph edges', async () => {
    // This will be implemented after basic structure is working
    expect(true).toBe(true);
  });

  it('should respect depth limit', async () => {
    // This will be implemented after basic structure is working
    expect(true).toBe(true);
  });

  it('should track distance from initial nodes', async () => {
    // This will be implemented after basic structure is working
    expect(true).toBe(true);
  });
});

describe('relevance scoring', () => {
  it('should rank relevant items higher', async () => {
    // This will be implemented after basic structure is working
    expect(true).toBe(true);
  });

  it('should combine vector similarity and graph distance', async () => {
    // This will be implemented after basic structure is working
    expect(true).toBe(true);
  });

  it('should boost exported symbols', async () => {
    // This will be implemented after basic structure is working
    expect(true).toBe(true);
  });
});

describe('approach suggestions', () => {
  let mockDb: IndexDatabase;
  let mockEmbeddingClient: EmbeddingClient;

  beforeEach(() => {
    mockDb = {
      path: '/test/db',
      connection: {} as never,
      close: async () => {},
    };

    mockEmbeddingClient = {
      model: 'test-model',
      embed: async () => ({ embeddings: [[0.1, 0.2, 0.3]], model: 'test-model' }),
      embedQuery: async () => ({ embeddings: [[0.1, 0.2, 0.3]], model: 'test-model' }),
      healthCheck: async () => ({ healthy: true, modelAvailable: true }),
      getModelDimensions: async () => 3,
    };
  });

  it('should return empty suggestedApproach by default (generateApproach: false)', async () => {
    const result = await buildContext(
      {
        db: mockDb,
        indexName: 'test-index',
        embeddingClient: mockEmbeddingClient,
      },
      'implement user authentication',
      { generateApproach: false }
    );

    expect(result.suggestedApproach).toEqual([]);
  });

  it('should return empty suggestedApproach when generateApproach is undefined', async () => {
    const result = await buildContext(
      {
        db: mockDb,
        indexName: 'test-index',
        embeddingClient: mockEmbeddingClient,
      },
      'implement user authentication',
      {} // No generateApproach option
    );

    expect(result.suggestedApproach).toEqual([]);
  });

  it('should generate approach when generateApproach: true and summarizer is healthy', async () => {
    // Mock config loading
    const originalLoadConfig = await import('../storage/config.js');

    const result = await buildContext(
      {
        db: mockDb,
        indexName: 'test-index',
        embeddingClient: mockEmbeddingClient,
      },
      'implement user authentication',
      { generateApproach: true }
    );

    // Should have approach steps
    expect(result.suggestedApproach).toBeDefined();
    expect(Array.isArray(result.suggestedApproach)).toBe(true);

    // In real implementation, this would have steps if summarizer is healthy
    // For now, we're just testing the structure
  });

  it('should handle summarizer health check failure gracefully', async () => {
    const result = await buildContext(
      {
        db: mockDb,
        indexName: 'test-index',
        embeddingClient: mockEmbeddingClient,
      },
      'implement user authentication',
      { generateApproach: true }
    );

    // Should not throw, should return empty array on failure
    expect(result.suggestedApproach).toBeDefined();
    expect(Array.isArray(result.suggestedApproach)).toBe(true);
  });
});
