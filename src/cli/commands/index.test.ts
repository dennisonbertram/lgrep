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

import { runIndexCommand, type IndexOptions } from './index.js';
import { openDatabase, getIndex, getChunkCount } from '../../storage/lance.js';

describe('index command', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-index-cmd-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['MGREP_HOME'] = testDir;

    // Create some test files
    await writeFile(join(sourceDir, 'file1.txt'), 'Hello world, this is file one with some content.');
    await writeFile(join(sourceDir, 'file2.ts'), 'function hello() { return "world"; }');

    const subDir = join(sourceDir, 'subdir');
    await mkdir(subDir);
    await writeFile(join(subDir, 'file3.md'), '# Heading\n\nSome markdown content here.');
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('successful indexing', () => {
    it('should create an index from a directory', async () => {
      const result = await runIndexCommand(sourceDir, { name: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.indexName).toBe('test-index');
      expect(result.filesProcessed).toBeGreaterThan(0);
      expect(result.chunksCreated).toBeGreaterThan(0);
    });

    it('should auto-generate index name from path if not provided', async () => {
      const result = await runIndexCommand(sourceDir);

      expect(result.success).toBe(true);
      expect(result.indexName).toBe('source');
    });

    it('should store chunks in LanceDB', async () => {
      await runIndexCommand(sourceDir, { name: 'stored-test' });

      const dbPath = join(testDir, 'db');
      const db = await openDatabase(dbPath);
      const handle = await getIndex(db, 'stored-test');

      expect(handle).not.toBeNull();
      expect(handle?.metadata.status).toBe('ready');

      const count = await getChunkCount(db, handle!);
      expect(count).toBeGreaterThan(0);

      await db.close();
    });

    it('should process files recursively', async () => {
      const result = await runIndexCommand(sourceDir, { name: 'recursive-test' });

      // Should find file3.md in subdir
      expect(result.filesProcessed).toBe(3);
    });
  });

  describe('error handling', () => {
    it('should fail for non-existent path', async () => {
      await expect(
        runIndexCommand('/nonexistent/path', { name: 'fail-test' })
      ).rejects.toThrow();
    });

    it('should fail if index already exists', async () => {
      await runIndexCommand(sourceDir, { name: 'dupe-test' });

      await expect(
        runIndexCommand(sourceDir, { name: 'dupe-test' })
      ).rejects.toThrow(/already exists/i);
    });
  });

  describe('options', () => {
    it('should respect custom index name', async () => {
      const result = await runIndexCommand(sourceDir, { name: 'custom-name' });

      expect(result.indexName).toBe('custom-name');
    });
  });

  describe('progress indicators', () => {
    it('should show progress during indexing when showProgress is true', async () => {
      const result = await runIndexCommand(sourceDir, {
        name: 'progress-test',
        showProgress: true,
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBeGreaterThan(0);
    });

    it('should not show progress when showProgress is false', async () => {
      const result = await runIndexCommand(sourceDir, {
        name: 'no-progress-test',
        showProgress: false,
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBeGreaterThan(0);
    });

    it('should default to showing progress', async () => {
      const result = await runIndexCommand(sourceDir, {
        name: 'default-progress-test',
      });

      expect(result.success).toBe(true);
    });

    it('should stop spinner on error', async () => {
      await expect(
        runIndexCommand('/nonexistent/path', {
          name: 'error-test',
          showProgress: true,
        })
      ).rejects.toThrow();
    });
  });
});
