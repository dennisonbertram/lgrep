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

// Mock config module - setup a spy that we can override per test
vi.mock('../../storage/config.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../storage/config.js')>();
  return {
    ...mod,
    loadConfig: vi.fn(async () => ({ ...mod.DEFAULT_CONFIG })),
  };
});

import { runIndexCommand } from './index.js';
import * as lanceModule from '../../storage/lance.js';
import { openDatabase, getIndex } from '../../storage/lance.js';
import * as configModule from '../../storage/config.js';
import { DEFAULT_CONFIG } from '../../storage/config.js';

describe('index command - batch processing', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-batch-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    // Reset config mock to default for each test
    vi.mocked(configModule.loadConfig).mockResolvedValue({ ...DEFAULT_CONFIG });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('batched database writes', () => {
    it('should batch chunks across files instead of writing per-file', async () => {
      // Create 10 small files with controlled content
      // Each file should produce exactly 1 chunk
      for (let i = 0; i < 10; i++) {
        await writeFile(
          join(sourceDir, `file${i}.txt`),
          `This is file ${i} with unique content for testing batching behavior.`
        );
      }

      // Spy on addChunks to count how many times it's called
      const addChunksSpy = vi.spyOn(lanceModule, 'addChunks');

      // Set dbBatchSize to 3 in config
      // With 10 files producing 1 chunk each:
      // - Should batch in groups of 3
      // - Calls: 3, 3, 3, 1 (remainder)
      // - Total: 4 calls instead of 10
      vi.mocked(configModule.loadConfig).mockResolvedValue({ ...DEFAULT_CONFIG, dbBatchSize: 3 });

      const result = await runIndexCommand(sourceDir, {
        name: 'batch-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(10);
      expect(result.chunksCreated).toBeGreaterThanOrEqual(10);

      // Key assertion: addChunks should be called fewer times than files processed
      // With batch size of 3 and 10 chunks, we expect 4 calls (3+3+3+1)
      const callCount = addChunksSpy.mock.calls.length;
      expect(callCount).toBeLessThan(result.filesProcessed);
      expect(callCount).toBeGreaterThan(0);

      // Verify all chunks were eventually written
      const dbPath = join(testDir, 'db');
      const db = await openDatabase(dbPath);
      const handle = await getIndex(db, 'batch-test');
      expect(handle).not.toBeNull();

      const { getChunkCount } = await import('../../storage/lance.js');
      const count = await getChunkCount(db, handle!);
      expect(count).toBeGreaterThanOrEqual(10);

      await db.close();
    });

    it('should flush remaining chunks after file loop', async () => {
      // Create 8 files (not evenly divisible by batch size)
      for (let i = 0; i < 8; i++) {
        await writeFile(
          join(sourceDir, `file${i}.txt`),
          `Content for file ${i} to test remainder flushing.`
        );
      }

      const addChunksSpy = vi.spyOn(lanceModule, 'addChunks');

      // With dbBatchSize=5 and 8 files:
      // - First call: 5 chunks
      // - Second call: 3 chunks (remainder)
      vi.mocked(configModule.loadConfig).mockResolvedValue({ ...DEFAULT_CONFIG, dbBatchSize: 5 });

      const result = await runIndexCommand(sourceDir, {
        name: 'flush-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);
      expect(result.chunksCreated).toBeGreaterThanOrEqual(8);

      // Should have at least 2 calls (5 + 3)
      expect(addChunksSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      // Verify all chunks were written
      const dbPath = join(testDir, 'db');
      const db = await openDatabase(dbPath);
      const handle = await getIndex(db, 'flush-test');
      const { getChunkCount } = await import('../../storage/lance.js');
      const count = await getChunkCount(db, handle!);
      expect(count).toBeGreaterThanOrEqual(8);

      await db.close();
    });

    it('should handle case where batch size is larger than total chunks', async () => {
      // Create only 2 files with large batch size
      await writeFile(join(sourceDir, 'file1.txt'), 'First file content.');
      await writeFile(join(sourceDir, 'file2.txt'), 'Second file content.');

      const addChunksSpy = vi.spyOn(lanceModule, 'addChunks');

      vi.mocked(configModule.loadConfig).mockResolvedValue({ ...DEFAULT_CONFIG, dbBatchSize: 250 });

      const result = await runIndexCommand(sourceDir, {
        name: 'large-batch-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);

      // Should call addChunks only once at the end (flush)
      expect(addChunksSpy.mock.calls.length).toBe(1);

      // Verify chunks were written
      const dbPath = join(testDir, 'db');
      const db = await openDatabase(dbPath);
      const handle = await getIndex(db, 'large-batch-test');
      const { getChunkCount } = await import('../../storage/lance.js');
      const count = await getChunkCount(db, handle!);
      expect(count).toBeGreaterThanOrEqual(2);

      await db.close();
    });

    it('should maintain same total chunk count with batching', async () => {
      // Create several files
      for (let i = 0; i < 5; i++) {
        await writeFile(
          join(sourceDir, `test${i}.txt`),
          `Testing that batching does not lose chunks. File ${i}.`
        );
      }

      vi.mocked(configModule.loadConfig).mockResolvedValue({ ...DEFAULT_CONFIG, dbBatchSize: 2 });

      const result = await runIndexCommand(sourceDir, {
        name: 'consistency-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);

      const dbPath = join(testDir, 'db');
      const db = await openDatabase(dbPath);
      const handle = await getIndex(db, 'consistency-test');
      const { getChunkCount } = await import('../../storage/lance.js');
      const actualCount = await getChunkCount(db, handle!);

      // Reported count should match actual DB count
      expect(result.chunksCreated).toBe(actualCount);

      await db.close();
    });
  });

  describe('batch size edge cases', () => {
    it('should handle batch size of 1 (write each chunk immediately)', async () => {
      await writeFile(join(sourceDir, 'file1.txt'), 'Content one.');
      await writeFile(join(sourceDir, 'file2.txt'), 'Content two.');

      const addChunksSpy = vi.spyOn(lanceModule, 'addChunks');

      vi.mocked(configModule.loadConfig).mockResolvedValue({ ...DEFAULT_CONFIG, dbBatchSize: 1 });

      const result = await runIndexCommand(sourceDir, {
        name: 'batch-one-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);
      // With batch size 1, each chunk should trigger a write
      expect(addChunksSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty directory gracefully', async () => {
      // Empty source directory
      vi.mocked(configModule.loadConfig).mockResolvedValue({ ...DEFAULT_CONFIG, dbBatchSize: 10 });

      const result = await runIndexCommand(sourceDir, {
        name: 'empty-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(0);
      expect(result.chunksCreated).toBe(0);
    });
  });
});
