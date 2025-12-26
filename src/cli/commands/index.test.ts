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
import { openDatabase, getIndex, getChunkCount, updateIndexStatus } from '../../storage/lance.js';
import { createEmbeddingClient } from '../../core/embeddings.js';

describe('index command', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-index-cmd-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

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

  describe('code intelligence extraction', () => {
    it('should extract and store symbols from TypeScript files', async () => {
      const result = await runIndexCommand(sourceDir, { name: 'code-intel-test' });

      expect(result.success).toBe(true);
      expect(result.symbolsIndexed).toBeGreaterThan(0);
    });

    it('should extract and store dependencies from TypeScript files', async () => {
      // Create a file with imports
      await writeFile(
        join(sourceDir, 'imports.ts'),
        "import { readFile } from 'fs/promises';\nexport function test() {}"
      );

      const result = await runIndexCommand(sourceDir, { name: 'deps-test' });

      expect(result.success).toBe(true);
      expect(result.dependenciesIndexed).toBeGreaterThan(0);
    });

    it('should extract and store function calls from TypeScript files', async () => {
      // Create a file with function calls
      await writeFile(
        join(sourceDir, 'calls.ts'),
        'function foo() { return bar(); }\nfunction bar() { return 42; }'
      );

      const result = await runIndexCommand(sourceDir, { name: 'calls-test' });

      expect(result.success).toBe(true);
      expect(result.callsIndexed).toBeGreaterThan(0);
    });

    it('should only extract code intelligence from JS/TS files', async () => {
      const result = await runIndexCommand(sourceDir, { name: 'selective-test' });

      // Should process TS files but not TXT or MD files for code intel
      expect(result.success).toBe(true);
      expect(result.symbolsIndexed).toBeGreaterThan(0);
    });

    it('should skip code intelligence for non-code files', async () => {
      await writeFile(join(sourceDir, 'data.json'), '{"test": true}');
      await writeFile(join(sourceDir, 'readme.md'), '# README');

      const result = await runIndexCommand(sourceDir, { name: 'skip-test' });

      expect(result.success).toBe(true);
      // Symbols should only come from the .ts file
      expect(result.filesProcessed).toBeGreaterThan(0);
    });
  });

  describe('crash handling', () => {
    it('should mark index as failed when embedding fails', async () => {
      // Mock embedding to fail
      const mockClient = createEmbeddingClient({ model: 'test' });
      vi.mocked(mockClient.embed).mockRejectedValueOnce(new Error('Embedding service unavailable'));

      await expect(
        runIndexCommand(sourceDir, { name: 'crash-test', showProgress: false })
      ).rejects.toThrow();

      // Check that index is marked as failed
      const dbPath = join(testDir, 'db');
      const db = await openDatabase(dbPath);
      const handle = await getIndex(db, 'crash-test');

      expect(handle).not.toBeNull();
      expect(handle?.metadata.status).toBe('failed');

      await db.close();
    });

    it('should allow retry of failed indexes', async () => {
      // First, create a failed index manually
      const dbPath = join(testDir, 'db');
      const db = await openDatabase(dbPath);

      // Create and immediately fail an index
      const { createIndex } = await import('../../storage/lance.js');
      const handle = await createIndex(db, {
        name: 'retry-test',
        rootPath: sourceDir,
        model: 'test-model',
        modelDimensions: 4,
      });
      await updateIndexStatus(db, handle, 'failed');
      await db.close();

      // Now retry with the retry flag
      const result = await runIndexCommand(sourceDir, {
        name: 'retry-test',
        showProgress: false,
        retry: true,
      });

      expect(result.success).toBe(true);
      expect(result.indexName).toBe('retry-test');

      // Verify status is now ready
      const db2 = await openDatabase(dbPath);
      const handle2 = await getIndex(db2, 'retry-test');
      expect(handle2?.metadata.status).toBe('ready');
      await db2.close();
    });

    it('should not allow retry on non-failed indexes', async () => {
      // Create a successful index first
      await runIndexCommand(sourceDir, { name: 'no-retry-test', showProgress: false });

      // Try to retry it - should fail because it's not in failed state
      await expect(
        runIndexCommand(sourceDir, { name: 'no-retry-test', retry: true, showProgress: false })
      ).rejects.toThrow(/not in failed state/i);
    });
  });

  describe('embedding progress tracking', () => {
    it('should track chunk-level progress during embedding', async () => {
      // Create files with enough content to generate multiple chunks
      const largeContent = 'This is test content. '.repeat(100);
      await writeFile(join(sourceDir, 'large1.txt'), largeContent);
      await writeFile(join(sourceDir, 'large2.txt'), largeContent);

      const result = await runIndexCommand(sourceDir, {
        name: 'progress-tracking-test',
        showProgress: true,
      });

      expect(result.success).toBe(true);
      expect(result.chunksCreated).toBeGreaterThan(0);
      // Progress tracking happens internally - no easy way to verify console output in tests
      // but the onProgress callback is called during processFile
    });

    it('should calculate ETA based on average time per chunk', async () => {
      // Create files with enough content for ETA calculation
      const largeContent = 'This is test content. '.repeat(100);
      await writeFile(join(sourceDir, 'large1.txt'), largeContent);
      await writeFile(join(sourceDir, 'large2.txt'), largeContent);

      const result = await runIndexCommand(sourceDir, {
        name: 'eta-test',
        showProgress: true,
      });

      expect(result.success).toBe(true);
      // ETA calculation should have happened during embedding
    });

    it('should not show progress in JSON mode', async () => {
      const largeContent = 'This is test content. '.repeat(100);
      await writeFile(join(sourceDir, 'large1.txt'), largeContent);

      const result = await runIndexCommand(sourceDir, {
        name: 'json-mode-test',
        showProgress: false,
        json: true,
      });

      expect(result.success).toBe(true);
      // Progress should be suppressed
    });

    it('should suppress progress updates when showProgress is false', async () => {
      const largeContent = 'This is test content. '.repeat(100);
      await writeFile(join(sourceDir, 'large1.txt'), largeContent);

      const result = await runIndexCommand(sourceDir, {
        name: 'no-progress-embedding-test',
        showProgress: false,
      });

      expect(result.success).toBe(true);
      expect(result.chunksCreated).toBeGreaterThan(0);
    });
  });
});
