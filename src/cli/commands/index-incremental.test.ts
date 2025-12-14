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

import { runIndexCommand, type IndexResult } from './index.js';
import { openDatabase, getIndex, getChunkCount, getFileContentHashes } from '../../storage/lance.js';
import { hashContent } from '../../core/hash.js';

describe('index command - incremental indexing', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-incremental-cmd-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['MGREP_HOME'] = testDir;

    // Create initial test files
    await writeFile(join(sourceDir, 'file1.txt'), 'Initial content for file one.');
    await writeFile(join(sourceDir, 'file2.ts'), 'function hello() { return "world"; }');
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('reindexing with unchanged files', () => {
    it('should skip files with unchanged content hash', async () => {
      // Initial index
      const result1 = await runIndexCommand(sourceDir, { name: 'test-index' });
      expect(result1.success).toBe(true);
      expect(result1.filesProcessed).toBe(2);
      expect(result1.chunksCreated).toBeGreaterThan(0);

      const initialChunks = result1.chunksCreated;

      // Reindex without changes - should use 'update' mode
      const result2 = await runIndexCommand(sourceDir, { name: 'test-index', mode: 'update' });

      expect(result2.success).toBe(true);
      expect(result2.filesProcessed).toBe(2);
      expect(result2.filesSkipped).toBe(2); // Both files unchanged
      expect(result2.filesUpdated).toBe(0);
      expect(result2.chunksCreated).toBe(0); // No new chunks needed
    });

    it('should report stats correctly for unchanged files', async () => {
      await runIndexCommand(sourceDir, { name: 'stats-test' });

      const result = await runIndexCommand(sourceDir, { name: 'stats-test', mode: 'update' });

      expect(result).toHaveProperty('filesSkipped');
      expect(result).toHaveProperty('filesUpdated');
      expect(result).toHaveProperty('filesAdded');
      expect(result.filesSkipped).toBe(2);
      expect(result.filesUpdated).toBe(0);
      expect(result.filesAdded).toBe(0);
    });
  });

  describe('reindexing with changed files', () => {
    it('should reindex files with changed content hash', async () => {
      // Initial index
      await runIndexCommand(sourceDir, { name: 'changed-test' });

      // Modify file1
      await writeFile(join(sourceDir, 'file1.txt'), 'MODIFIED content for file one - this is different!');

      // Reindex
      const result = await runIndexCommand(sourceDir, { name: 'changed-test', mode: 'update' });

      expect(result.success).toBe(true);
      expect(result.filesSkipped).toBe(1); // file2.ts unchanged
      expect(result.filesUpdated).toBe(1); // file1.txt changed
      expect(result.chunksCreated).toBeGreaterThan(0); // New chunks for file1.txt
    });

    it('should replace old chunks with new chunks for changed files', async () => {
      const file1Content = 'Original content';
      await writeFile(join(sourceDir, 'file1.txt'), file1Content);

      await runIndexCommand(sourceDir, { name: 'replace-test' });

      const dbPath = join(testDir, 'db');
      const db = await openDatabase(dbPath);
      const handle = await getIndex(db, 'replace-test');

      const originalHash = hashContent(file1Content);
      const hashes1 = await getFileContentHashes(db, handle!);
      expect(hashes1.get(join(sourceDir, 'file1.txt'))).toBe(originalHash);

      await db.close();

      // Modify file
      const newContent = 'COMPLETELY NEW CONTENT THAT IS DIFFERENT';
      await writeFile(join(sourceDir, 'file1.txt'), newContent);

      await runIndexCommand(sourceDir, { name: 'replace-test', mode: 'update' });

      const db2 = await openDatabase(dbPath);
      const handle2 = await getIndex(db2, 'replace-test');

      const newHash = hashContent(newContent);
      const hashes2 = await getFileContentHashes(db2, handle2!);
      expect(hashes2.get(join(sourceDir, 'file1.txt'))).toBe(newHash);
      expect(hashes2.get(join(sourceDir, 'file1.txt'))).not.toBe(originalHash);

      await db2.close();
    });
  });

  describe('reindexing with new files', () => {
    it('should index new files added after initial indexing', async () => {
      // Initial index
      await runIndexCommand(sourceDir, { name: 'new-files-test' });

      // Add new file
      await writeFile(join(sourceDir, 'file3.md'), '# New markdown file\n\nWith some content.');

      // Reindex
      const result = await runIndexCommand(sourceDir, { name: 'new-files-test', mode: 'update' });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(3); // Now 3 files total
      expect(result.filesSkipped).toBe(2); // file1, file2 unchanged
      expect(result.filesAdded).toBe(1); // file3 is new
      expect(result.chunksCreated).toBeGreaterThan(0); // Chunks for new file
    });
  });

  describe('reindexing with deleted files', () => {
    it('should remove chunks for deleted files', async () => {
      // Initial index
      await runIndexCommand(sourceDir, { name: 'delete-test' });

      const dbPath = join(testDir, 'db');
      const db1 = await openDatabase(dbPath);
      const handle1 = await getIndex(db1, 'delete-test');
      const initialCount = await getChunkCount(db1, handle1!);
      expect(initialCount).toBeGreaterThan(0);
      await db1.close();

      // Delete file1
      await rm(join(sourceDir, 'file1.txt'));

      // Reindex
      const result = await runIndexCommand(sourceDir, { name: 'delete-test', mode: 'update' });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(1); // Only file2 remains
      expect(result.filesDeleted).toBe(1); // file1 was deleted

      // Verify chunks for deleted file are gone
      const db2 = await openDatabase(dbPath);
      const handle2 = await getIndex(db2, 'delete-test');
      const finalCount = await getChunkCount(db2, handle2!);
      expect(finalCount).toBeLessThan(initialCount);

      const hashes = await getFileContentHashes(db2, handle2!);
      expect(hashes.has(join(sourceDir, 'file1.txt'))).toBe(false);

      await db2.close();
    });

    it('should report deleted file count correctly', async () => {
      // Create multiple files
      await writeFile(join(sourceDir, 'file3.txt'), 'File 3 content');
      await writeFile(join(sourceDir, 'file4.txt'), 'File 4 content');

      await runIndexCommand(sourceDir, { name: 'multi-delete-test' });

      // Delete multiple files
      await rm(join(sourceDir, 'file1.txt'));
      await rm(join(sourceDir, 'file3.txt'));

      const result = await runIndexCommand(sourceDir, { name: 'multi-delete-test', mode: 'update' });

      expect(result.filesDeleted).toBe(2);
      expect(result.filesProcessed).toBe(2); // file2 and file4 remain
    });
  });

  describe('mixed operations', () => {
    it('should handle unchanged, changed, new, and deleted files in one reindex', async () => {
      // Initial setup
      await writeFile(join(sourceDir, 'unchanged.txt'), 'This will not change');
      await writeFile(join(sourceDir, 'will-change.txt'), 'Original content');
      await writeFile(join(sourceDir, 'will-delete.txt'), 'To be deleted');

      await runIndexCommand(sourceDir, { name: 'mixed-test' });

      // Make changes
      await writeFile(join(sourceDir, 'will-change.txt'), 'MODIFIED CONTENT');
      await rm(join(sourceDir, 'will-delete.txt'));
      await writeFile(join(sourceDir, 'new-file.txt'), 'Brand new file');

      const result = await runIndexCommand(sourceDir, { name: 'mixed-test', mode: 'update' });

      expect(result.success).toBe(true);
      expect(result.filesSkipped).toBeGreaterThanOrEqual(1); // unchanged.txt + original file1/file2
      expect(result.filesUpdated).toBe(1); // will-change.txt
      expect(result.filesAdded).toBe(1); // new-file.txt
      expect(result.filesDeleted).toBe(1); // will-delete.txt
    });
  });

  describe('mode parameter', () => {
    it('should fail on reindex without mode=update if index exists', async () => {
      await runIndexCommand(sourceDir, { name: 'mode-test' });

      // Try to reindex without mode
      await expect(
        runIndexCommand(sourceDir, { name: 'mode-test' })
      ).rejects.toThrow(/already exists/i);
    });

    it('should accept mode=update for existing index', async () => {
      await runIndexCommand(sourceDir, { name: 'update-mode-test' });

      const result = await runIndexCommand(sourceDir, { name: 'update-mode-test', mode: 'update' });
      expect(result.success).toBe(true);
    });

    it('should fail with mode=update if index does not exist', async () => {
      await expect(
        runIndexCommand(sourceDir, { name: 'nonexistent', mode: 'update' })
      ).rejects.toThrow(/does not exist/i);
    });
  });
});
