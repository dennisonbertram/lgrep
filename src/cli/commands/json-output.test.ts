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

import { runSearchCommand } from './search.js';
import { runIndexCommand } from './index.js';
import { runListCommand } from './list.js';
import { runDeleteCommand } from './delete.js';
import { runConfigCommand } from './config.js';
import { formatAsJson, type JsonError } from './json-formatter.js';

describe('JSON output flag', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-json-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    // Create test files
    await writeFile(
      join(sourceDir, 'test.ts'),
      'function hello() { return "world"; }'
    );
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('formatAsJson utility', () => {
    it('should format search results as valid JSON', () => {
      const result = {
        success: true,
        query: 'test query',
        indexName: 'test-index',
        results: [
          {
            filePath: '/path/to/file.ts',
            relativePath: 'file.ts',
            content: 'test content',
            score: 0.95,
            lineStart: 10,
            lineEnd: 15,
            chunkIndex: 0,
          },
        ],
      };

      const json = formatAsJson('search', result);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('results');
      expect(parsed).toHaveProperty('query', 'test query');
      expect(parsed).toHaveProperty('count', 1);
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results[0]).toHaveProperty('file', 'file.ts');
      expect(parsed.results[0]).toHaveProperty('score', 0.95);
      expect(parsed.results[0]).toHaveProperty('line', 10);
    });

    it('should format index results as valid JSON', () => {
      const result = {
        success: true,
        indexName: 'test-index',
        filesProcessed: 10,
        chunksCreated: 50,
      };

      const json = formatAsJson('index', result);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('indexed', 10);
      expect(parsed).toHaveProperty('skipped', 0);
      expect(parsed).toHaveProperty('errors');
      expect(Array.isArray(parsed.errors)).toBe(true);
      expect(parsed.errors.length).toBe(0);
    });

    it('should format list output as valid JSON', async () => {
      // First create an index
      await runIndexCommand(sourceDir, { name: 'test-index' });

      const output = await runListCommand();
      const json = formatAsJson('list', output);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('indexes');
      expect(Array.isArray(parsed.indexes)).toBe(true);
    });

    it('should format delete output as valid JSON', () => {
      const output = 'Deleted index "test-index"';
      const json = formatAsJson('delete', output, { indexName: 'test-index' });
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('deleted', 'test-index');
      expect(parsed).toHaveProperty('success', true);
    });

    it('should format config output as valid JSON', async () => {
      const output = await runConfigCommand();
      const json = formatAsJson('config', output);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('config');
      expect(typeof parsed.config).toBe('object');
    });

    it('should format errors as valid JSON', () => {
      const error = new Error('Test error message');
      const json = formatAsJson('error', error);
      const parsed: JsonError = JSON.parse(json);

      expect(parsed).toHaveProperty('error', 'Test error message');
      expect(parsed).toHaveProperty('code', 'COMMAND_ERROR');
    });

    it('should include error codes in JSON errors', () => {
      const error = new Error('Index "test" not found');
      const json = formatAsJson('error', error);
      const parsed: JsonError = JSON.parse(json);

      expect(parsed).toHaveProperty('error');
      expect(parsed).toHaveProperty('code');
      expect(parsed.code).toMatch(/ERROR|NOT_FOUND/);
    });

    it('should produce valid JSON that can be parsed', () => {
      const result = {
        success: true,
        query: 'test',
        indexName: 'idx',
        results: [],
      };

      const json = formatAsJson('search', result);

      // Should not throw
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should handle special characters in strings', () => {
      const result = {
        success: true,
        query: 'test "quotes" and \n newlines',
        indexName: 'test-index',
        results: [],
      };

      const json = formatAsJson('search', result);
      const parsed = JSON.parse(json);

      expect(parsed.query).toBe('test "quotes" and \n newlines');
    });
  });

  describe('schema validation', () => {
    it('should match search schema with all required fields', () => {
      const result = {
        success: true,
        query: 'test',
        indexName: 'idx',
        results: [
          {
            filePath: '/abs/path.ts',
            relativePath: 'path.ts',
            content: 'content',
            score: 0.9,
            lineStart: 1,
            lineEnd: 2,
            chunkIndex: 0,
          },
        ],
      };

      const json = formatAsJson('search', result);
      const parsed = JSON.parse(json);

      // Required fields
      expect(parsed).toHaveProperty('results');
      expect(parsed).toHaveProperty('query');
      expect(parsed).toHaveProperty('count');

      // Result item schema
      const item = parsed.results[0];
      expect(item).toHaveProperty('file');
      expect(item).toHaveProperty('chunk');
      expect(item).toHaveProperty('score');
      expect(item).toHaveProperty('line');
    });

    it('should match index schema with all required fields', () => {
      const result = {
        success: true,
        indexName: 'test',
        filesProcessed: 5,
        chunksCreated: 20,
      };

      const json = formatAsJson('index', result);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('indexed');
      expect(parsed).toHaveProperty('skipped');
      expect(parsed).toHaveProperty('errors');
      expect(parsed).toHaveProperty('duration_ms');
    });

    it('should match list schema with all required fields', () => {
      const output = `Indexes:

  test-index
    Path:   /test/path
    Model:  test-model
    Status: ready
    Chunks: 10
`;

      const json = formatAsJson('list', output);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('indexes');
      expect(Array.isArray(parsed.indexes)).toBe(true);

      if (parsed.indexes.length > 0) {
        const idx = parsed.indexes[0];
        expect(idx).toHaveProperty('name');
        expect(idx).toHaveProperty('files');
        expect(idx).toHaveProperty('chunks');
        expect(idx).toHaveProperty('created');
      }
    });

    it('should match delete schema with all required fields', () => {
      const output = 'Deleted index "test"';
      const json = formatAsJson('delete', output, { indexName: 'test' });
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('deleted');
      expect(parsed).toHaveProperty('success');
      expect(typeof parsed.success).toBe('boolean');
    });

    it('should match config schema with all required fields', () => {
      const output = `model: test-model
chunkSize: 512
chunkOverlap: 50`;

      const json = formatAsJson('config', output);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('config');
      expect(typeof parsed.config).toBe('object');
    });

    it('should match error schema with all required fields', () => {
      const error = new Error('Test error');
      const json = formatAsJson('error', error);
      const parsed: JsonError = JSON.parse(json);

      expect(parsed).toHaveProperty('error');
      expect(parsed).toHaveProperty('code');
      expect(typeof parsed.error).toBe('string');
      expect(typeof parsed.code).toBe('string');
    });
  });

  describe('error handling in JSON mode', () => {
    it('should format index errors as JSON', () => {
      const error = new Error('Path does not exist');
      const json = formatAsJson('error', error);
      const parsed: JsonError = JSON.parse(json);

      expect(parsed.error).toContain('Path does not exist');
      expect(parsed).toHaveProperty('code');
    });

    it('should format search errors as JSON', () => {
      const error = new Error('Index "test" not found');
      const json = formatAsJson('error', error);
      const parsed: JsonError = JSON.parse(json);

      expect(parsed.error).toContain('not found');
      expect(parsed).toHaveProperty('code');
    });

    it('should format validation errors as JSON', () => {
      const error = new Error('Unknown config key: invalid');
      const json = formatAsJson('error', error);
      const parsed: JsonError = JSON.parse(json);

      expect(parsed.error).toContain('Unknown config key');
      expect(parsed).toHaveProperty('code');
    });
  });

  describe('data types', () => {
    it('should preserve number types in JSON output', () => {
      const result = {
        success: true,
        query: 'test',
        indexName: 'idx',
        results: [
          {
            filePath: '/path.ts',
            relativePath: 'path.ts',
            content: 'content',
            score: 0.8523,
            lineStart: 42,
            lineEnd: 50,
            chunkIndex: 3,
          },
        ],
      };

      const json = formatAsJson('search', result);
      const parsed = JSON.parse(json);

      expect(typeof parsed.results[0].score).toBe('number');
      expect(typeof parsed.results[0].line).toBe('number');
      expect(parsed.results[0].score).toBe(0.8523);
      expect(parsed.results[0].line).toBe(42);
    });

    it('should handle array types correctly', () => {
      const result = {
        success: true,
        query: 'test',
        indexName: 'idx',
        results: [],
      };

      const json = formatAsJson('search', result);
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results.length).toBe(0);
    });

    it('should handle boolean types correctly', () => {
      const output = 'Deleted index "test"';
      const json = formatAsJson('delete', output, { indexName: 'test' });
      const parsed = JSON.parse(json);

      expect(typeof parsed.success).toBe('boolean');
      expect(parsed.success).toBe(true);
    });
  });
});
