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
import { formatAsJson } from './json-formatter.js';

describe('JSON CLI End-to-End Tests', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-json-e2e-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['MGREP_HOME'] = testDir;

    await writeFile(join(sourceDir, 'test.ts'), 'function hello() { return "world"; }');
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('should produce valid JSON for complete workflow', async () => {
    // 1. Index with JSON output
    const indexResult = await runIndexCommand(sourceDir, { name: 'e2e-test', json: true });
    const indexJson = formatAsJson('index', indexResult);
    const indexParsed = JSON.parse(indexJson);

    expect(indexParsed).toHaveProperty('indexed');
    expect(indexParsed).toHaveProperty('skipped');
    expect(indexParsed.indexed).toBeGreaterThan(0);

    // 2. List with JSON output
    const listOutput = await runListCommand(true);
    const listParsed = JSON.parse(listOutput);

    expect(listParsed).toHaveProperty('indexes');
    expect(Array.isArray(listParsed.indexes)).toBe(true);
    expect(listParsed.indexes.length).toBeGreaterThan(0);
    expect(listParsed.indexes[0].name).toBe('e2e-test');

    // 3. Search with JSON output
    const searchResult = await runSearchCommand('hello', {
      index: 'e2e-test',
      json: true,
    });
    const searchJson = formatAsJson('search', searchResult);
    const searchParsed = JSON.parse(searchJson);

    expect(searchParsed).toHaveProperty('results');
    expect(searchParsed).toHaveProperty('query', 'hello');
    expect(searchParsed).toHaveProperty('count');

    // 4. Config with JSON output
    const configOutput = await runConfigCommand(undefined, undefined, true);
    const configParsed = JSON.parse(configOutput);

    expect(configParsed).toHaveProperty('config');
    expect(typeof configParsed.config).toBe('object');

    // 5. Delete with JSON output
    const deleteOutput = await runDeleteCommand('e2e-test', { json: true });
    const deleteParsed = JSON.parse(deleteOutput);

    expect(deleteParsed).toHaveProperty('deleted', 'e2e-test');
    expect(deleteParsed).toHaveProperty('success', true);
  });

  it('should handle errors as JSON', async () => {
    // Try to search non-existent index
    let errorJson: string | null = null;
    try {
      await runSearchCommand('test', { index: 'nonexistent', json: true });
    } catch (err) {
      errorJson = formatAsJson('error', err as Error);
    }

    expect(errorJson).not.toBeNull();
    if (errorJson) {
      const parsed = JSON.parse(errorJson);
      expect(parsed).toHaveProperty('error');
      expect(parsed).toHaveProperty('code');
      expect(parsed.error).toContain('not found');
    }
  });

  it('should produce consistent JSON schemas across commands', () => {
    // All JSON outputs should be valid and parseable
    const testCases = [
      {
        name: 'search',
        data: { success: true, query: 'test', indexName: 'idx', results: [] },
      },
      {
        name: 'index',
        data: { success: true, indexName: 'idx', filesProcessed: 5, chunksCreated: 10 },
      },
      {
        name: 'error',
        data: new Error('Test error'),
      },
    ];

    for (const testCase of testCases) {
      const json = formatAsJson(testCase.name, testCase.data);

      // Should be valid JSON
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json);

      // Should be an object
      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBeNull();
    }
  });
});
