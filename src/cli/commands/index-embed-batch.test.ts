import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Track how many times embed is called and with what batch sizes
let embedCallCount = 0;
let embedBatchSizes: number[] = [];

// Mock the embeddings module before importing
vi.mock('../../core/embeddings.js', () => ({
  createEmbeddingClient: vi.fn().mockReturnValue({
    model: 'test-model',
    embed: vi.fn().mockImplementation(async (input: string | string[]) => {
      embedCallCount++;
      const texts = Array.isArray(input) ? input : [input];
      embedBatchSizes.push(texts.length);
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

// Mock config module
vi.mock('../../storage/config.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../storage/config.js')>();
  return {
    ...mod,
    loadConfig: vi.fn(async () => ({ ...mod.DEFAULT_CONFIG })),
  };
});

import { runIndexCommand } from './index.js';
import { openDatabase, getIndex } from '../../storage/lance.js';
import * as configModule from '../../storage/config.js';
import { DEFAULT_CONFIG } from '../../storage/config.js';

describe('index command - embedding batch processing', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-embed-batch-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    // Reset tracking
    embedCallCount = 0;
    embedBatchSizes = [];

    // Reset config mock to default for each test
    vi.mocked(configModule.loadConfig).mockResolvedValue({ ...DEFAULT_CONFIG });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('batched embedding generation', () => {
    it('should batch embeddings with embedBatchSize=10 for multiple chunks', async () => {
      // Create multiple files to ensure we get more than 10 chunks total
      for (let fileNum = 0; fileNum < 5; fileNum++) {
        const lines: string[] = [];
        for (let i = 0; i < 250; i++) {
          lines.push(`File ${fileNum} Line ${i}: This is some test content for batching embeddings.`);
        }
        await writeFile(join(sourceDir, `large-file-${fileNum}.txt`), lines.join('\n'));
      }

      // Use default embedBatchSize=10
      const result = await runIndexCommand(sourceDir, {
        name: 'embed-batch-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);

      // Should have multiple embedding calls, each with batch size <= 10
      expect(embedCallCount).toBeGreaterThan(1);

      // All batch sizes should be <= 10
      for (const batchSize of embedBatchSizes) {
        expect(batchSize).toBeLessThanOrEqual(10);
        expect(batchSize).toBeGreaterThan(0);
      }

      // Total embeddings should match chunks created
      const totalEmbeddings = embedBatchSizes.reduce((sum, size) => sum + size, 0);
      expect(totalEmbeddings).toBe(result.chunksCreated);
    });

    it('should batch multiple chunks into fewer calls with embedBatchSize=10', async () => {
      // Create multiple files that together produce ~10-15 chunks
      for (let fileNum = 0; fileNum < 3; fileNum++) {
        const lines: string[] = [];
        for (let i = 0; i < 200; i++) {
          lines.push(`File ${fileNum} Line ${i}: This is test content for batching.`);
        }
        await writeFile(join(sourceDir, `batch-file-${fileNum}.txt`), lines.join('\n'));
      }

      const result = await runIndexCommand(sourceDir, {
        name: 'single-batch-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);

      // With embedBatchSize=10, we should batch efficiently
      expect(embedCallCount).toBeGreaterThan(0);

      // All batch sizes should be <= 10
      for (const batchSize of embedBatchSizes) {
        expect(batchSize).toBeLessThanOrEqual(10);
      }

      // Total embeddings should match chunks created
      const totalEmbeddings = embedBatchSizes.reduce((sum, size) => sum + size, 0);
      expect(totalEmbeddings).toBe(result.chunksCreated);
    });

    it('should handle embedBatchSize=1 (no batching)', async () => {
      // Create a file with 5 small chunks
      const lines: string[] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(`Line ${i}: Content.`);
      }
      await writeFile(join(sourceDir, 'file.txt'), lines.join('\n'));

      // Set embedBatchSize to 1 (disabled batching)
      vi.mocked(configModule.loadConfig).mockResolvedValue({
        ...DEFAULT_CONFIG,
        embedBatchSize: 1,
      });

      const result = await runIndexCommand(sourceDir, {
        name: 'no-batch-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);

      // Each chunk should be embedded individually
      expect(embedCallCount).toBe(result.chunksCreated);

      // All batches should be size 1
      for (const batchSize of embedBatchSizes) {
        expect(batchSize).toBe(1);
      }
    });

    it('should handle remainders correctly with embedBatchSize=3', async () => {
      // Create multiple files to generate at least 10 chunks (not divisible by 3)
      for (let fileNum = 0; fileNum < 5; fileNum++) {
        const lines: string[] = [];
        for (let i = 0; i < 100; i++) {
          lines.push(`File ${fileNum} Line ${i}: Testing remainder handling.`);
        }
        await writeFile(join(sourceDir, `remainder-file-${fileNum}.txt`), lines.join('\n'));
      }

      vi.mocked(configModule.loadConfig).mockResolvedValue({
        ...DEFAULT_CONFIG,
        embedBatchSize: 3,
      });

      const result = await runIndexCommand(sourceDir, {
        name: 'remainder-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);

      // With batch size 3, should have batched efficiently
      expect(embedCallCount).toBeGreaterThan(1);

      // All batch sizes should be <= 3
      for (const batchSize of embedBatchSizes) {
        expect(batchSize).toBeLessThanOrEqual(3);
        expect(batchSize).toBeGreaterThan(0);
      }

      // Total should still match
      const totalEmbeddings = embedBatchSizes.reduce((sum, size) => sum + size, 0);
      expect(totalEmbeddings).toBe(result.chunksCreated);
    });

    it('should skip cached embeddings and only batch uncached', async () => {
      // First indexing run - all chunks will be embedded
      const content = Array(50).fill(0).map((_, i) => `Line ${i}: Content.`).join('\n');
      await writeFile(join(sourceDir, 'cached-file.txt'), content);

      const firstResult = await runIndexCommand(sourceDir, {
        name: 'cache-test',
        showProgress: false,
        summarize: false,
      });

      expect(firstResult.success).toBe(true);
      const firstEmbedCount = embedCallCount;
      expect(firstEmbedCount).toBeGreaterThan(0);

      // Reset tracking
      embedCallCount = 0;
      embedBatchSizes = [];

      // Second run with update mode - should use cache, no new embeddings
      const secondResult = await runIndexCommand(sourceDir, {
        name: 'cache-test',
        mode: 'update',
        showProgress: false,
        summarize: false,
      });

      expect(secondResult.success).toBe(true);

      // Should have 0 embedding calls (all cached)
      expect(embedCallCount).toBe(0);
      expect(embedBatchSizes).toHaveLength(0);
    });

    it('should batch mixed cached and uncached chunks', async () => {
      // Create initial files
      for (let i = 0; i < 3; i++) {
        await writeFile(
          join(sourceDir, `file${i}.txt`),
          Array(100).fill(0).map((_, j) => `Original file ${i} line ${j}`).join('\n')
        );
      }

      // First index - embed all chunks
      const firstResult = await runIndexCommand(sourceDir, {
        name: 'mixed-cache-test',
        showProgress: false,
        summarize: false,
      });

      expect(firstResult.success).toBe(true);
      const firstChunkCount = firstResult.chunksCreated;

      // Reset tracking
      embedCallCount = 0;
      embedBatchSizes = [];

      // Add new files with different content
      for (let i = 3; i < 6; i++) {
        await writeFile(
          join(sourceDir, `file${i}.txt`),
          Array(100).fill(0).map((_, j) => `New file ${i} line ${j}`).join('\n')
        );
      }

      // Update index - should only embed new files
      const secondResult = await runIndexCommand(sourceDir, {
        name: 'mixed-cache-test',
        mode: 'update',
        showProgress: false,
        summarize: false,
      });

      expect(secondResult.success).toBe(true);

      // Should only embed chunks from the new files
      expect(embedCallCount).toBeGreaterThan(0);
      const totalNewEmbeddings = embedBatchSizes.reduce((sum, size) => sum + size, 0);

      // New embeddings should match new chunks created
      expect(totalNewEmbeddings).toBeGreaterThan(0);
      expect(totalNewEmbeddings).toBe(secondResult.chunksCreated);

      // Verify we added 3 new files
      expect(secondResult.filesAdded).toBe(3);

      // Verify batching occurred (not one call per chunk)
      if (totalNewEmbeddings > 10) {
        expect(embedCallCount).toBeLessThan(totalNewEmbeddings);
      }
    });

    it('should handle large batch size exceeding chunk count', async () => {
      // Create small file with 3 chunks
      const lines: string[] = [];
      for (let i = 0; i < 30; i++) {
        lines.push(`Line ${i}: Small file.`);
      }
      await writeFile(join(sourceDir, 'small-file.txt'), lines.join('\n'));

      // Set very large batch size
      vi.mocked(configModule.loadConfig).mockResolvedValue({
        ...DEFAULT_CONFIG,
        embedBatchSize: 100,
      });

      const result = await runIndexCommand(sourceDir, {
        name: 'large-batch-size-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);

      // Should have exactly 1 call with all chunks
      expect(embedCallCount).toBe(1);
      expect(embedBatchSizes[0]).toBe(result.chunksCreated);
    });
  });

  describe('embedding batching across multiple files', () => {
    it('should batch chunks from multiple files efficiently', async () => {
      // Create 10 small files, each producing 1-2 chunks
      for (let i = 0; i < 10; i++) {
        await writeFile(
          join(sourceDir, `file${i}.txt`),
          Array(50).fill(0).map((_, j) => `File ${i} line ${j}: some content here`).join('\n')
        );
      }

      vi.mocked(configModule.loadConfig).mockResolvedValue({
        ...DEFAULT_CONFIG,
        embedBatchSize: 3,
      });

      const result = await runIndexCommand(sourceDir, {
        name: 'cross-file-batch-test',
        showProgress: false,
        summarize: false,
      });

      expect(result.success).toBe(true);

      // With batch size 3, should batch chunks together
      expect(embedCallCount).toBeGreaterThan(1);

      // All batches should be <= 3
      for (const batchSize of embedBatchSizes) {
        expect(batchSize).toBeLessThanOrEqual(3);
      }

      // Total embeddings should match chunks
      const totalEmbeddings = embedBatchSizes.reduce((sum, size) => sum + size, 0);
      expect(totalEmbeddings).toBe(result.chunksCreated);
    });
  });
});
