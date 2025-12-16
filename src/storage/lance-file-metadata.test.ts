import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  openDatabase,
  createIndex,
  addChunks,
  createFileMetadataTable,
  upsertFileMetadata,
  getFileMetadataHashes,
  deleteFileMetadata,
  type IndexDatabase,
  type IndexHandle,
  type DocumentChunk,
} from './lance.js';

describe('lance file metadata', () => {
  let testDir: string;
  let db: IndexDatabase;
  let handle: IndexHandle;
  const DIMENSIONS = 4;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-metadata-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    db = await openDatabase(join(testDir, 'db'));
    handle = await createIndex(db, {
      name: 'metadata-test',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: DIMENSIONS,
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

  describe('createFileMetadataTable', () => {
    it('should create metadata table for an index', async () => {
      await createFileMetadataTable(db, handle);

      // Verify table exists by trying to query it
      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes).toBeInstanceOf(Map);
      expect(hashes.size).toBe(0);
    });

    it('should be idempotent - not fail if table already exists', async () => {
      await createFileMetadataTable(db, handle);
      // Should not throw on second call
      await createFileMetadataTable(db, handle);

      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes.size).toBe(0);
    });
  });

  describe('upsertFileMetadata', () => {
    beforeEach(async () => {
      await createFileMetadataTable(db, handle);
    });

    it('should insert new file metadata', async () => {
      await upsertFileMetadata(db, handle, '/test/file1.ts', 'hash123', 5);

      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes.get('/test/file1.ts')).toBe('hash123');
    });

    it('should update existing file metadata', async () => {
      // Insert initial metadata
      await upsertFileMetadata(db, handle, '/test/file1.ts', 'hash123', 5);

      // Update with new hash and chunk count
      await upsertFileMetadata(db, handle, '/test/file1.ts', 'hash456', 7);

      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes.get('/test/file1.ts')).toBe('hash456');
      expect(hashes.size).toBe(1); // Still only one file
    });

    it('should handle multiple files', async () => {
      await upsertFileMetadata(db, handle, '/test/file1.ts', 'hash1', 3);
      await upsertFileMetadata(db, handle, '/test/file2.ts', 'hash2', 5);
      await upsertFileMetadata(db, handle, '/test/file3.ts', 'hash3', 2);

      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes.size).toBe(3);
      expect(hashes.get('/test/file1.ts')).toBe('hash1');
      expect(hashes.get('/test/file2.ts')).toBe('hash2');
      expect(hashes.get('/test/file3.ts')).toBe('hash3');
    });
  });

  describe('getFileMetadataHashes', () => {
    beforeEach(async () => {
      await createFileMetadataTable(db, handle);
    });

    it('should return empty map for empty metadata table', async () => {
      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes).toBeInstanceOf(Map);
      expect(hashes.size).toBe(0);
    });

    it('should return all file paths and their hashes', async () => {
      await upsertFileMetadata(db, handle, '/test/file1.ts', 'hash1', 3);
      await upsertFileMetadata(db, handle, '/test/file2.ts', 'hash2', 5);

      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes.size).toBe(2);
      expect(hashes.get('/test/file1.ts')).toBe('hash1');
      expect(hashes.get('/test/file2.ts')).toBe('hash2');
    });

    it('should return empty map if metadata table does not exist', async () => {
      // Don't create the table
      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes).toBeInstanceOf(Map);
      expect(hashes.size).toBe(0);
    });

    it('should be much faster than loading all chunks', async () => {
      // This is a performance characteristic test
      // We just verify it works with many files without loading chunks

      // Add file metadata for 100 files
      for (let i = 0; i < 100; i++) {
        await upsertFileMetadata(
          db,
          handle,
          `/test/file${i}.ts`,
          `hash${i}`,
          10
        );
      }

      const start = Date.now();
      const hashes = await getFileMetadataHashes(db, handle);
      const duration = Date.now() - start;

      expect(hashes.size).toBe(100);
      // Should be fast - under 100ms for 100 files
      expect(duration).toBeLessThan(100);
    });
  });

  describe('deleteFileMetadata', () => {
    beforeEach(async () => {
      await createFileMetadataTable(db, handle);
      // Add some test data
      await upsertFileMetadata(db, handle, '/test/file1.ts', 'hash1', 3);
      await upsertFileMetadata(db, handle, '/test/file2.ts', 'hash2', 5);
      await upsertFileMetadata(db, handle, '/test/file3.ts', 'hash3', 2);
    });

    it('should delete file metadata', async () => {
      await deleteFileMetadata(db, handle, '/test/file2.ts');

      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes.size).toBe(2);
      expect(hashes.has('/test/file1.ts')).toBe(true);
      expect(hashes.has('/test/file2.ts')).toBe(false);
      expect(hashes.has('/test/file3.ts')).toBe(true);
    });

    it('should not fail when deleting non-existent file', async () => {
      await deleteFileMetadata(db, handle, '/test/nonexistent.ts');

      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes.size).toBe(3); // All original files still there
    });

    it('should handle deleting all files', async () => {
      await deleteFileMetadata(db, handle, '/test/file1.ts');
      await deleteFileMetadata(db, handle, '/test/file2.ts');
      await deleteFileMetadata(db, handle, '/test/file3.ts');

      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes.size).toBe(0);
    });
  });

  describe('integration with chunk operations', () => {
    it('should maintain metadata alongside chunks', async () => {
      await createFileMetadataTable(db, handle);

      // Add chunks for file1
      const file1Chunks = [
        makeChunk({ filePath: '/test/file1.ts', contentHash: 'hash1', chunkIndex: 0 }),
        makeChunk({ filePath: '/test/file1.ts', contentHash: 'hash1', chunkIndex: 1 }),
      ];
      await addChunks(db, handle, file1Chunks);
      await upsertFileMetadata(db, handle, '/test/file1.ts', 'hash1', 2);

      // Add chunks for file2
      const file2Chunks = [
        makeChunk({ filePath: '/test/file2.ts', contentHash: 'hash2', chunkIndex: 0 }),
      ];
      await addChunks(db, handle, file2Chunks);
      await upsertFileMetadata(db, handle, '/test/file2.ts', 'hash2', 1);

      // Verify metadata
      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes.size).toBe(2);
      expect(hashes.get('/test/file1.ts')).toBe('hash1');
      expect(hashes.get('/test/file2.ts')).toBe('hash2');
    });
  });

  describe('migration scenario', () => {
    it('should handle missing metadata table gracefully', async () => {
      // Simulate old index without metadata table
      // Add chunks without creating metadata table
      const chunks = [
        makeChunk({ filePath: '/test/file1.ts', contentHash: 'hash1' }),
      ];
      await addChunks(db, handle, chunks);

      // getFileMetadataHashes should return empty map
      const hashes = await getFileMetadataHashes(db, handle);
      expect(hashes).toBeInstanceOf(Map);
      expect(hashes.size).toBe(0);

      // Can create table and populate it later
      await createFileMetadataTable(db, handle);
      await upsertFileMetadata(db, handle, '/test/file1.ts', 'hash1', 1);

      const updatedHashes = await getFileMetadataHashes(db, handle);
      expect(updatedHashes.size).toBe(1);
      expect(updatedHashes.get('/test/file1.ts')).toBe('hash1');
    });
  });
});
