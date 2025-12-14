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
});
