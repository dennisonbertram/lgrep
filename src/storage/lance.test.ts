import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  openDatabase,
  createIndex,
  getIndex,
  deleteIndex,
  listIndexes,
  addChunks,
  searchChunks,
  getChunkCount,
  updateIndexStatus,
  type IndexDatabase,
  type IndexHandle,
  type DocumentChunk,
} from './lance.js';

describe('lance storage', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-lance-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('openDatabase', () => {
    it('should create database directory if it does not exist', async () => {
      const dbPath = join(testDir, 'new-db');
      const db = await openDatabase(dbPath);

      expect(db).toBeDefined();
      expect(db.path).toBe(dbPath);

      const entries = await readdir(dbPath);
      expect(entries).toBeDefined();

      await db.close();
    });

    it('should open existing database', async () => {
      const dbPath = join(testDir, 'existing-db');
      await mkdir(dbPath, { recursive: true });

      const db = await openDatabase(dbPath);
      expect(db).toBeDefined();
      expect(db.path).toBe(dbPath);

      await db.close();
    });
  });

  describe('createIndex', () => {
    let db: IndexDatabase;

    beforeEach(async () => {
      db = await openDatabase(join(testDir, 'db'));
    });

    afterEach(async () => {
      await db.close();
    });

    it('should create a new index with metadata', async () => {
      const handle = await createIndex(db, {
        name: 'test-index',
        rootPath: '/path/to/project',
        model: 'mxbai-embed-large',
        modelDimensions: 1024,
      });

      expect(handle).toBeDefined();
      expect(handle.name).toBe('test-index');
      expect(handle.metadata.status).toBe('building');
      expect(handle.metadata.model).toBe('mxbai-embed-large');
      expect(handle.metadata.modelDimensions).toBe(1024);
      expect(handle.metadata.rootPath).toBe('/path/to/project');
      expect(handle.metadata.schemaVersion).toBe(1);
    });

    it('should throw if index already exists', async () => {
      await createIndex(db, {
        name: 'dupe-index',
        rootPath: '/path',
        model: 'model',
        modelDimensions: 512,
      });

      await expect(
        createIndex(db, {
          name: 'dupe-index',
          rootPath: '/another',
          model: 'model',
          modelDimensions: 512,
        })
      ).rejects.toThrow(/already exists/i);
    });

    it('should create index directory with meta.json', async () => {
      await createIndex(db, {
        name: 'meta-test',
        rootPath: '/test',
        model: 'test-model',
        modelDimensions: 768,
      });

      const indexDir = join(db.path, 'meta-test');
      const metaPath = join(indexDir, 'meta.json');

      const metaContent = await readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent);

      expect(meta.name).toBe('meta-test');
      expect(meta.model).toBe('test-model');
      expect(meta.modelDimensions).toBe(768);
      expect(meta.status).toBe('building');
    });
  });

  describe('getIndex', () => {
    let db: IndexDatabase;

    beforeEach(async () => {
      db = await openDatabase(join(testDir, 'db'));
    });

    afterEach(async () => {
      await db.close();
    });

    it('should retrieve an existing index', async () => {
      await createIndex(db, {
        name: 'get-test',
        rootPath: '/test',
        model: 'test-model',
        modelDimensions: 1024,
      });

      const handle = await getIndex(db, 'get-test');

      expect(handle).toBeDefined();
      expect(handle?.name).toBe('get-test');
      expect(handle?.metadata.model).toBe('test-model');
    });

    it('should return null for non-existent index', async () => {
      const handle = await getIndex(db, 'nonexistent');
      expect(handle).toBeNull();
    });
  });

  describe('deleteIndex', () => {
    let db: IndexDatabase;

    beforeEach(async () => {
      db = await openDatabase(join(testDir, 'db'));
    });

    afterEach(async () => {
      await db.close();
    });

    it('should delete an existing index', async () => {
      await createIndex(db, {
        name: 'delete-me',
        rootPath: '/test',
        model: 'test-model',
        modelDimensions: 512,
      });

      const deleted = await deleteIndex(db, 'delete-me');
      expect(deleted).toBe(true);

      const handle = await getIndex(db, 'delete-me');
      expect(handle).toBeNull();
    });

    it('should return false for non-existent index', async () => {
      const deleted = await deleteIndex(db, 'not-there');
      expect(deleted).toBe(false);
    });

    it('should remove index directory', async () => {
      await createIndex(db, {
        name: 'cleanup-test',
        rootPath: '/test',
        model: 'test-model',
        modelDimensions: 512,
      });

      const indexDir = join(db.path, 'cleanup-test');

      // Verify directory exists
      const entriesBefore = await readdir(db.path);
      expect(entriesBefore).toContain('cleanup-test');

      await deleteIndex(db, 'cleanup-test');

      // Verify directory is gone
      const entriesAfter = await readdir(db.path);
      expect(entriesAfter).not.toContain('cleanup-test');
    });
  });

  describe('listIndexes', () => {
    let db: IndexDatabase;

    beforeEach(async () => {
      db = await openDatabase(join(testDir, 'db'));
    });

    afterEach(async () => {
      await db.close();
    });

    it('should return empty array when no indexes exist', async () => {
      const indexes = await listIndexes(db);
      expect(indexes).toEqual([]);
    });

    it('should list all indexes with metadata', async () => {
      await createIndex(db, {
        name: 'index-a',
        rootPath: '/a',
        model: 'model-a',
        modelDimensions: 512,
      });

      await createIndex(db, {
        name: 'index-b',
        rootPath: '/b',
        model: 'model-b',
        modelDimensions: 1024,
      });

      const indexes = await listIndexes(db);

      expect(indexes).toHaveLength(2);
      expect(indexes.map(i => i.name).sort()).toEqual(['index-a', 'index-b']);

      const indexA = indexes.find(i => i.name === 'index-a');
      expect(indexA?.metadata.model).toBe('model-a');

      const indexB = indexes.find(i => i.name === 'index-b');
      expect(indexB?.metadata.model).toBe('model-b');
    });
  });

  describe('chunk operations', () => {
    let db: IndexDatabase;
    let handle: IndexHandle;
    const DIMENSIONS = 4; // Small for testing

    beforeEach(async () => {
      db = await openDatabase(join(testDir, 'db'));
      handle = await createIndex(db, {
        name: 'chunk-test',
        rootPath: '/test',
        model: 'test-model',
        modelDimensions: DIMENSIONS,
      });
    });

    afterEach(async () => {
      await db.close();
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

    describe('addChunks', () => {
      it('should add chunks to the index', async () => {
        const chunks = [
          makeChunk({ id: 'chunk-1', content: 'First chunk' }),
          makeChunk({ id: 'chunk-2', content: 'Second chunk' }),
        ];

        const count = await addChunks(db, handle, chunks);
        expect(count).toBe(2);
      });

      it('should create LanceDB table if not exists', async () => {
        const chunks = [makeChunk()];
        await addChunks(db, handle, chunks);

        // Verify table was created by checking chunk count
        const count = await getChunkCount(db, handle);
        expect(count).toBe(1);
      });

      it('should append to existing chunks', async () => {
        const batch1 = [makeChunk({ id: 'batch1-1' })];
        const batch2 = [makeChunk({ id: 'batch2-1' }), makeChunk({ id: 'batch2-2' })];

        await addChunks(db, handle, batch1);
        await addChunks(db, handle, batch2);

        const count = await getChunkCount(db, handle);
        expect(count).toBe(3);
      });
    });

    describe('searchChunks', () => {
      it('should return matching chunks by vector similarity', async () => {
        // Add chunks with distinct vectors
        const chunks = [
          makeChunk({
            id: 'similar',
            content: 'Matching content',
            vector: new Float32Array([0.9, 0.1, 0.1, 0.1]),
          }),
          makeChunk({
            id: 'different',
            content: 'Different content',
            vector: new Float32Array([0.1, 0.9, 0.1, 0.1]),
          }),
        ];

        await addChunks(db, handle, chunks);

        // Search with vector similar to 'similar' chunk
        const queryVector = new Float32Array([0.9, 0.1, 0.1, 0.1]);
        const results = await searchChunks(db, handle, queryVector, { limit: 1 });

        expect(results).toHaveLength(1);
        expect(results[0].content).toBe('Matching content');
      });

      it('should respect limit option', async () => {
        const chunks = [
          makeChunk({ id: 'c1' }),
          makeChunk({ id: 'c2' }),
          makeChunk({ id: 'c3' }),
        ];

        await addChunks(db, handle, chunks);

        const queryVector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        const results = await searchChunks(db, handle, queryVector, { limit: 2 });

        expect(results).toHaveLength(2);
      });

      it('should return empty array for empty index', async () => {
        const queryVector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        const results = await searchChunks(db, handle, queryVector, { limit: 10 });

        expect(results).toEqual([]);
      });

      it('should include score in results', async () => {
        const chunks = [makeChunk()];
        await addChunks(db, handle, chunks);

        const queryVector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        const results = await searchChunks(db, handle, queryVector, { limit: 1 });

        expect(results[0]).toHaveProperty('_score');
        expect(typeof results[0]._score).toBe('number');
      });
    });

    describe('getChunkCount', () => {
      it('should return 0 for empty index', async () => {
        const count = await getChunkCount(db, handle);
        expect(count).toBe(0);
      });

      it('should return correct count after adding chunks', async () => {
        const chunks = [makeChunk(), makeChunk(), makeChunk()];
        await addChunks(db, handle, chunks);

        const count = await getChunkCount(db, handle);
        expect(count).toBe(3);
      });
    });

    describe('updateIndexStatus', () => {
      it('should update status to ready', async () => {
        await addChunks(db, handle, [makeChunk()]);
        await updateIndexStatus(db, handle, 'ready');

        const updated = await getIndex(db, handle.name);
        expect(updated?.metadata.status).toBe('ready');
      });

      it('should update status to failed', async () => {
        await updateIndexStatus(db, handle, 'failed');

        const updated = await getIndex(db, handle.name);
        expect(updated?.metadata.status).toBe('failed');
      });

      it('should update chunk count in metadata', async () => {
        const chunks = [makeChunk(), makeChunk()];
        await addChunks(db, handle, chunks);
        await updateIndexStatus(db, handle, 'ready');

        const updated = await getIndex(db, handle.name);
        expect(updated?.metadata.chunkCount).toBe(2);
      });
    });
  });
});
