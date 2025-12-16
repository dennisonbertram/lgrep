import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  openDatabase,
  createIndex,
  addChunks,
  getFileContentHashes,
  getChunksByFilePath,
  deleteChunksByFilePath,
  type IndexDatabase,
  type IndexHandle,
  type DocumentChunk,
} from './lance.js';

describe('lance incremental indexing', () => {
  let testDir: string;
  let db: IndexDatabase;
  let handle: IndexHandle;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-incremental-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    db = await openDatabase(join(testDir, 'db'));
    handle = await createIndex(db, {
      name: 'incremental-test',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 4,
    });
  });

  afterEach(async () => {
    await db.close();
    await rm(testDir, { recursive: true, force: true });
  });

  function makeChunk(overrides: Partial<DocumentChunk> = {}): DocumentChunk {
    return {
      id: randomUUID(),
      filePath: '/test/file.ts',
      relativePath: 'file.ts',
      contentHash: 'abc123',
      chunkIndex: 0,
      content: 'Test content',
      vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      fileType: '.ts',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('getFileContentHashes', () => {
    it('should return empty map for empty index', async () => {
      const hashes = await getFileContentHashes(db, handle);
      expect(hashes).toEqual(new Map());
    });

    it('should return content hashes for all files in index', async () => {
      const chunks = [
        makeChunk({ filePath: '/test/file1.ts', contentHash: 'hash1' }),
        makeChunk({ filePath: '/test/file1.ts', contentHash: 'hash1', chunkIndex: 1 }),
        makeChunk({ filePath: '/test/file2.ts', contentHash: 'hash2' }),
      ];

      await addChunks(db, handle, chunks);
      const hashes = await getFileContentHashes(db, handle);

      expect(hashes.size).toBe(2);
      expect(hashes.get('/test/file1.ts')).toBe('hash1');
      expect(hashes.get('/test/file2.ts')).toBe('hash2');
    });

    it('should handle multiple chunks from same file correctly', async () => {
      const chunks = [
        makeChunk({ filePath: '/test/multi.ts', contentHash: 'multihash', chunkIndex: 0 }),
        makeChunk({ filePath: '/test/multi.ts', contentHash: 'multihash', chunkIndex: 1 }),
        makeChunk({ filePath: '/test/multi.ts', contentHash: 'multihash', chunkIndex: 2 }),
      ];

      await addChunks(db, handle, chunks);
      const hashes = await getFileContentHashes(db, handle);

      expect(hashes.size).toBe(1);
      expect(hashes.get('/test/multi.ts')).toBe('multihash');
    });
  });

  describe('getChunksByFilePath', () => {
    it('should return empty array for non-existent file', async () => {
      const chunks = await getChunksByFilePath(db, handle, '/test/nonexistent.ts');
      expect(chunks).toEqual([]);
    });

    it('should return all chunks for a specific file', async () => {
      const fileChunks = [
        makeChunk({ id: 'chunk1', filePath: '/test/target.ts', chunkIndex: 0 }),
        makeChunk({ id: 'chunk2', filePath: '/test/target.ts', chunkIndex: 1 }),
      ];
      const otherChunk = makeChunk({ filePath: '/test/other.ts' });

      await addChunks(db, handle, [...fileChunks, otherChunk]);
      const result = await getChunksByFilePath(db, handle, '/test/target.ts');

      expect(result).toHaveLength(2);
      expect(result.map(c => c.id).sort()).toEqual(['chunk1', 'chunk2']);
    });

    it('should return chunks in correct order', async () => {
      const chunks = [
        makeChunk({ filePath: '/test/ordered.ts', chunkIndex: 2 }),
        makeChunk({ filePath: '/test/ordered.ts', chunkIndex: 0 }),
        makeChunk({ filePath: '/test/ordered.ts', chunkIndex: 1 }),
      ];

      await addChunks(db, handle, chunks);
      const result = await getChunksByFilePath(db, handle, '/test/ordered.ts');

      expect(result.map(c => c.chunkIndex)).toEqual([0, 1, 2]);
    });
  });

  describe('deleteChunksByFilePath', () => {
    it('should return 0 for non-existent file', async () => {
      const deleted = await deleteChunksByFilePath(db, handle, '/test/nonexistent.ts');
      expect(deleted).toBe(0);
    });

    it('should delete all chunks for a specific file', async () => {
      const chunks = [
        makeChunk({ filePath: '/test/delete-me.ts', chunkIndex: 0 }),
        makeChunk({ filePath: '/test/delete-me.ts', chunkIndex: 1 }),
        makeChunk({ filePath: '/test/keep-me.ts', chunkIndex: 0 }),
      ];

      await addChunks(db, handle, chunks);

      const deleted = await deleteChunksByFilePath(db, handle, '/test/delete-me.ts');
      expect(deleted).toBe(2);

      // Verify deletion
      const remaining = await getChunksByFilePath(db, handle, '/test/delete-me.ts');
      expect(remaining).toHaveLength(0);

      // Verify other files untouched
      const kept = await getChunksByFilePath(db, handle, '/test/keep-me.ts');
      expect(kept).toHaveLength(1);
    });

    it('should handle deletion of files with many chunks', async () => {
      const chunks = Array.from({ length: 10 }, (_, i) =>
        makeChunk({ filePath: '/test/many.ts', chunkIndex: i })
      );

      await addChunks(db, handle, chunks);
      const deleted = await deleteChunksByFilePath(db, handle, '/test/many.ts');

      expect(deleted).toBe(10);
    });
  });
});
