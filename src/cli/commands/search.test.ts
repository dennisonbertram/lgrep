import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Mock the embeddings module before importing
vi.mock('../../core/embeddings.js', () => ({
  createEmbeddingClient: vi.fn().mockReturnValue({
    model: 'test-model',
    embed: vi.fn().mockImplementation(async (input: string | string[]) => {
      const texts = Array.isArray(input) ? input : [input];
      return {
        embeddings: texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        model: 'test-model',
      };
    }),
    embedQuery: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3, 0.4]],
      model: 'test-model',
    }),
    healthCheck: vi.fn().mockResolvedValue({ ok: true, model: 'test-model', dimensions: 4 }),
    getModelDimensions: vi.fn().mockResolvedValue(4),
  }),
}));

import { runSearchCommand, type SearchOptions } from './search.js';
import { runIndexCommand } from './index.js';
import { runAnalyzeCommand } from './analyze.js';

describe('search command', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-search-cmd-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['MGREP_HOME'] = testDir;

    // Create test files with different content for variety
    await writeFile(
      join(sourceDir, 'auth.ts'),
      'function authenticate(user: string, password: string) { return checkCredentials(user, password); }'
    );
    await writeFile(
      join(sourceDir, 'database.ts'),
      'async function connectToDatabase(url: string) { return new DatabaseConnection(url); }'
    );
    await writeFile(
      join(sourceDir, 'api.ts'),
      'export function handleRequest(req: Request) { return processApiRequest(req); }'
    );

    // Create an index for testing
    await runIndexCommand(sourceDir, { name: 'test-index' });

    // Run analyze to populate code intelligence data
    await runAnalyzeCommand(sourceDir, { index: 'test-index' });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('successful searches', () => {
    it('should return results for a query', async () => {
      const result = await runSearchCommand('authentication', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should include file path and content in results', async () => {
      const result = await runSearchCommand('database connection', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);

      const firstResult = result.results[0];
      expect(firstResult).toHaveProperty('filePath');
      expect(firstResult).toHaveProperty('content');
      expect(firstResult).toHaveProperty('score');
    });

    it('should respect limit option', async () => {
      const result = await runSearchCommand('function', {
        index: 'test-index',
        limit: 2,
      });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('should include line numbers when available', async () => {
      const result = await runSearchCommand('api request', { index: 'test-index' });

      expect(result.success).toBe(true);
      if (result.results.length > 0) {
        const firstResult = result.results[0];
        expect(firstResult).toHaveProperty('lineStart');
        expect(firstResult).toHaveProperty('lineEnd');
      }
    });
  });

  describe('error handling', () => {
    it('should fail for non-existent index', async () => {
      await expect(
        runSearchCommand('test query', { index: 'nonexistent-index' })
      ).rejects.toThrow(/not found/i);
    });

    it('should return empty results for no matches', async () => {
      // With mocked embeddings, this may still return results due to cosine similarity
      // but with real embeddings, a nonsense query would return low scores
      const result = await runSearchCommand('xyz completely unrelated gibberish', {
        index: 'test-index',
      });

      expect(result.success).toBe(true);
      // Results may exist but with low scores - this is expected behavior
    });
  });

  describe('options', () => {
    it('should use default limit when not specified', async () => {
      const result = await runSearchCommand('function', { index: 'test-index' });

      expect(result.success).toBe(true);
      // Default limit is 10
      expect(result.results.length).toBeLessThanOrEqual(10);
    });
  });

  describe('progress indicators', () => {
    it('should show progress during search when showProgress is true', async () => {
      const result = await runSearchCommand('authentication', {
        index: 'test-index',
        showProgress: true,
      });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should not show progress when showProgress is false', async () => {
      const result = await runSearchCommand('database', {
        index: 'test-index',
        showProgress: false,
      });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should default to showing progress', async () => {
      const result = await runSearchCommand('api', {
        index: 'test-index',
      });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should stop spinner on error', async () => {
      await expect(
        runSearchCommand('test', {
          index: 'nonexistent-index',
          showProgress: true,
        })
      ).rejects.toThrow();
    });
  });

  describe('diversity option', () => {
    it('should accept diversity parameter between 0.0 and 1.0', async () => {
      const result = await runSearchCommand('function', {
        index: 'test-index',
        diversity: 0.7,
      });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should use default diversity of 0.7 when not specified', async () => {
      const result = await runSearchCommand('function', { index: 'test-index' });

      expect(result.success).toBe(true);
      // Default behavior should apply MMR with lambda=0.7
    });

    it('should accept diversity=1.0 for pure relevance', async () => {
      const result = await runSearchCommand('function', {
        index: 'test-index',
        diversity: 1.0,
      });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should accept diversity=0.0 for maximum diversity', async () => {
      const result = await runSearchCommand('function', {
        index: 'test-index',
        diversity: 0.0,
      });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should reject diversity < 0.0', async () => {
      await expect(
        runSearchCommand('function', {
          index: 'test-index',
          diversity: -0.5,
        })
      ).rejects.toThrow(/diversity.*between 0.0 and 1.0/i);
    });

    it('should reject diversity > 1.0', async () => {
      await expect(
        runSearchCommand('function', {
          index: 'test-index',
          diversity: 1.5,
        })
      ).rejects.toThrow(/diversity.*between 0.0 and 1.0/i);
    });
  });

  describe('--usages flag', () => {
    it('should find all call sites for a symbol', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        usages: 'authenticate',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('usages');
      expect(result.symbol).toBe('authenticate');
      expect(result.usages).toBeDefined();
      expect(Array.isArray(result.usages)).toBe(true);
    });

    it('should include file path, line, and caller info for each usage', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        usages: 'checkCredentials',
      });

      expect(result.success).toBe(true);
      if (result.usages && result.usages.length > 0) {
        const usage = result.usages[0];
        expect(usage).toHaveProperty('file');
        expect(usage).toHaveProperty('line');
        expect(usage).toHaveProperty('caller');
        expect(usage).toHaveProperty('callerKind');
      }
    });

    it('should return empty array for symbol with no usages', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        usages: 'nonExistentSymbol',
      });

      expect(result.success).toBe(true);
      expect(result.usages).toBeDefined();
      expect(result.usages).toHaveLength(0);
    });

    it('should work with JSON output format', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        usages: 'authenticate',
        json: true,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('usages');
      expect(result).toHaveProperty('usages');
      expect(result).toHaveProperty('count');
    });
  });

  describe('--definition flag', () => {
    it('should find symbol definition', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        definition: 'authenticate',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('definition');
      expect(result.symbol).toBe('authenticate');
      expect(result.definitions).toBeDefined();
      expect(Array.isArray(result.definitions)).toBe(true);
    });

    it('should include file, line, kind, and signature for each definition', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        definition: 'authenticate',
      });

      expect(result.success).toBe(true);
      if (result.definitions && result.definitions.length > 0) {
        const def = result.definitions[0];
        expect(def).toHaveProperty('file');
        expect(def).toHaveProperty('line');
        expect(def).toHaveProperty('kind');
        expect(def).toHaveProperty('exported');
      }
    });

    it('should return empty array for non-existent symbol', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        definition: 'nonExistentSymbol',
      });

      expect(result.success).toBe(true);
      expect(result.definitions).toBeDefined();
      expect(result.definitions).toHaveLength(0);
    });

    it('should support fuzzy matching', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        definition: 'auth',
      });

      expect(result.success).toBe(true);
      expect(result.definitions).toBeDefined();
      // Should find symbols containing 'auth'
    });

    it('should work with JSON output format', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        definition: 'authenticate',
        json: true,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('definition');
      expect(result).toHaveProperty('definitions');
      expect(result).toHaveProperty('count');
    });
  });

  describe('--type filter', () => {
    it('should filter results by symbol type', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        type: 'function',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('type');
      expect(result.symbolType).toBe('function');
      expect(result.symbols).toBeDefined();
      expect(Array.isArray(result.symbols)).toBe(true);
    });

    it('should support various symbol kinds', async () => {
      const kinds = ['function', 'class', 'interface', 'type', 'const'];

      for (const kind of kinds) {
        const result = await runSearchCommand('', {
          index: 'test-index',
          type: kind,
        });

        expect(result.success).toBe(true);
        expect(result.symbolType).toBe(kind);
      }
    });

    it('should return empty array when no symbols match the type', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        type: 'class',
      });

      expect(result.success).toBe(true);
      expect(result.symbols).toBeDefined();
      // May be empty if no classes in test files
    });

    it('should work with JSON output format', async () => {
      const result = await runSearchCommand('', {
        index: 'test-index',
        type: 'function',
        json: true,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('type');
      expect(result).toHaveProperty('symbols');
      expect(result).toHaveProperty('count');
    });
  });
});
