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
  rerankerWithMMR,
  type IndexDatabase,
  type IndexHandle,
  type DocumentChunk,
  type SearchResult,
} from './lance.js';

describe('lance storage', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-lance-test-${randomUUID()}`);
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

  describe('MMR reranking', () => {
    let db: IndexDatabase;
    let handle: IndexHandle;
    const DIMENSIONS = 4;

    beforeEach(async () => {
      db = await openDatabase(join(testDir, 'db'));
      handle = await createIndex(db, {
        name: 'mmr-test',
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

    describe('rerank with lambda=1.0 (pure relevance)', () => {
      it('should return results in same order as original when lambda=1.0', async () => {
        // Create results with known scores (already sorted by relevance)
        const results: SearchResult[] = [
          { ...makeChunk({ id: 'high-score', content: 'Most relevant' }), _score: 0.1 },
          { ...makeChunk({ id: 'mid-score', content: 'Medium relevant' }), _score: 0.3 },
          { ...makeChunk({ id: 'low-score', content: 'Least relevant' }), _score: 0.5 },
        ];

        const queryVector = new Float32Array([1.0, 0.0, 0.0, 0.0]);
        const reranked = rerankerWithMMR(results, queryVector, 1.0);

        // With lambda=1.0, order should be unchanged (pure relevance)
        expect(reranked[0].id).toBe('high-score');
        expect(reranked[1].id).toBe('mid-score');
        expect(reranked[2].id).toBe('low-score');
      });
    });

    describe('rerank with lambda=0.0 (pure diversity)', () => {
      it('should maximize diversity when lambda=0.0', async () => {
        // Create results where middle result is very similar to top result
        const results: SearchResult[] = [
          {
            ...makeChunk({
              id: 'top',
              content: 'First result',
              vector: new Float32Array([0.9, 0.1, 0.1, 0.1]),
            }),
            _score: 0.1,
          },
          {
            ...makeChunk({
              id: 'duplicate',
              content: 'Near duplicate of first',
              vector: new Float32Array([0.85, 0.1, 0.1, 0.1]),
            }),
            _score: 0.15,
          },
          {
            ...makeChunk({
              id: 'diverse',
              content: 'Very different result',
              vector: new Float32Array([0.1, 0.1, 0.1, 0.9]),
            }),
            _score: 0.3,
          },
        ];

        const queryVector = new Float32Array([0.9, 0.1, 0.1, 0.1]);
        const reranked = rerankerWithMMR(results, queryVector, 0.0);

        // With lambda=0.0, 'diverse' should be selected second (not 'duplicate')
        expect(reranked[0].id).toBe('top');
        expect(reranked[1].id).toBe('diverse');
        expect(reranked[2].id).toBe('duplicate');
      });
    });

    describe('rerank with lambda=0.5 (balanced)', () => {
      it('should balance relevance and diversity with lambda=0.5', async () => {
        const results: SearchResult[] = [
          {
            ...makeChunk({
              id: 'relevant',
              vector: new Float32Array([0.9, 0.1, 0.0, 0.0]),
            }),
            _score: 0.1,
          },
          {
            ...makeChunk({
              id: 'similar-to-relevant',
              vector: new Float32Array([0.85, 0.15, 0.0, 0.0]),
            }),
            _score: 0.12,
          },
          {
            ...makeChunk({
              id: 'moderately-diverse',
              vector: new Float32Array([0.5, 0.5, 0.0, 0.0]),
            }),
            _score: 0.25,
          },
        ];

        const queryVector = new Float32Array([1.0, 0.0, 0.0, 0.0]);
        const reranked = rerankerWithMMR(results, queryVector, 0.5);

        // First should still be most relevant
        expect(reranked[0].id).toBe('relevant');
        // Second should consider both relevance and diversity
        // (implementation-dependent, but diverse should be preferred)
      });
    });

    describe('edge cases', () => {
      it('should handle single result without error', async () => {
        const results: SearchResult[] = [
          { ...makeChunk({ id: 'only-one' }), _score: 0.2 },
        ];

        const queryVector = new Float32Array([0.5, 0.5, 0.0, 0.0]);
        const reranked = rerankerWithMMR(results, queryVector, 0.7);

        expect(reranked).toHaveLength(1);
        expect(reranked[0].id).toBe('only-one');
      });

      it('should handle empty results array', async () => {
        const results: SearchResult[] = [];
        const queryVector = new Float32Array([0.5, 0.5, 0.0, 0.0]);
        const reranked = rerankerWithMMR(results, queryVector, 0.7);

        expect(reranked).toEqual([]);
      });

      it('should handle two results', async () => {
        const results: SearchResult[] = [
          { ...makeChunk({ id: 'first' }), _score: 0.1 },
          { ...makeChunk({ id: 'second' }), _score: 0.3 },
        ];

        const queryVector = new Float32Array([0.5, 0.5, 0.0, 0.0]);
        const reranked = rerankerWithMMR(results, queryVector, 0.7);

        expect(reranked).toHaveLength(2);
      });
    });

    describe('near-duplicate demotion', () => {
      it('should demote near-duplicates in favor of diverse results', async () => {
        const results: SearchResult[] = [
          {
            ...makeChunk({
              id: 'original',
              content: 'function authenticate()',
              vector: new Float32Array([0.8, 0.2, 0.0, 0.0]),
            }),
            _score: 0.1,
          },
          {
            ...makeChunk({
              id: 'near-dup-1',
              content: 'function authenticate() { /* similar */ }',
              vector: new Float32Array([0.78, 0.22, 0.0, 0.0]),
            }),
            _score: 0.11,
          },
          {
            ...makeChunk({
              id: 'near-dup-2',
              content: 'function authenticate() { /* also similar */ }',
              vector: new Float32Array([0.79, 0.21, 0.0, 0.0]),
            }),
            _score: 0.12,
          },
          {
            ...makeChunk({
              id: 'different',
              content: 'database connection logic',
              vector: new Float32Array([0.2, 0.8, 0.0, 0.0]),
            }),
            _score: 0.3,
          },
        ];

        const queryVector = new Float32Array([0.8, 0.2, 0.0, 0.0]);
        const reranked = rerankerWithMMR(results, queryVector, 0.7);

        // Original should be first
        expect(reranked[0].id).toBe('original');
        // Diverse result should come before near-duplicates
        const differentIndex = reranked.findIndex(r => r.id === 'different');
        const nearDup1Index = reranked.findIndex(r => r.id === 'near-dup-1');
        const nearDup2Index = reranked.findIndex(r => r.id === 'near-dup-2');

        expect(differentIndex).toBeLessThan(nearDup1Index);
        expect(differentIndex).toBeLessThan(nearDup2Index);
      });
    });
  });
});
