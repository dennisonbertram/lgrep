import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  openEmbeddingCache,
  getEmbedding,
  getEmbeddings,
  setEmbedding,
  setEmbeddings,
  getCacheStats,
  clearCache,
  type EmbeddingCache,
} from './cache.js';

describe('embedding cache', () => {
  let testDir: string;
  let cache: EmbeddingCache;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-cache-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    cache = await openEmbeddingCache(testDir);
  });

  afterEach(async () => {
    await cache.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('openEmbeddingCache', () => {
    it('should create cache directory if it does not exist', async () => {
      const newPath = join(testDir, 'new-cache');
      const newCache = await openEmbeddingCache(newPath);
      expect(newCache).toBeDefined();
      await newCache.close();
    });

    it('should support a disabled cache handle', async () => {
      const disabledCache = await openEmbeddingCache(join(testDir, 'disabled'), {
        enabled: false,
      });

      expect(disabledCache.enabled).toBe(false);
      expect(disabledCache.connection).toBeNull();

      await disabledCache.close();
    });
  });

  describe('setEmbedding / getEmbedding', () => {
    it('should store and retrieve an embedding', async () => {
      const model = 'test-model';
      const content = 'Hello, world!';
      const vector = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      await setEmbedding(cache, model, content, vector);
      const retrieved = await getEmbedding(cache, model, content);

      expect(retrieved).toBeDefined();
      expect(Array.from(retrieved!)).toEqual(Array.from(vector));
    });

    it('should return null for non-existent embedding', async () => {
      const retrieved = await getEmbedding(cache, 'model', 'nonexistent');
      expect(retrieved).toBeNull();
    });

    it('should return different embeddings for different models', async () => {
      const content = 'Same content';
      const vector1 = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const vector2 = new Float32Array([0.5, 0.6, 0.7, 0.8]);

      await setEmbedding(cache, 'model-a', content, vector1);
      await setEmbedding(cache, 'model-b', content, vector2);

      const retrieved1 = await getEmbedding(cache, 'model-a', content);
      const retrieved2 = await getEmbedding(cache, 'model-b', content);

      expect(Array.from(retrieved1!)).toEqual(Array.from(vector1));
      expect(Array.from(retrieved2!)).toEqual(Array.from(vector2));
    });

    it('should return different embeddings for different content', async () => {
      const model = 'test-model';
      const vector1 = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const vector2 = new Float32Array([0.5, 0.6, 0.7, 0.8]);

      await setEmbedding(cache, model, 'content-a', vector1);
      await setEmbedding(cache, model, 'content-b', vector2);

      const retrieved1 = await getEmbedding(cache, model, 'content-a');
      const retrieved2 = await getEmbedding(cache, model, 'content-b');

      expect(Array.from(retrieved1!)).toEqual(Array.from(vector1));
      expect(Array.from(retrieved2!)).toEqual(Array.from(vector2));
    });

    it('should overwrite existing embedding', async () => {
      const model = 'test-model';
      const content = 'test content';
      const vector1 = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const vector2 = new Float32Array([0.5, 0.6, 0.7, 0.8]);

      await setEmbedding(cache, model, content, vector1);
      await setEmbedding(cache, model, content, vector2);

      const retrieved = await getEmbedding(cache, model, content);
      expect(Array.from(retrieved!)).toEqual(Array.from(vector2));
    });

    it('should batch store and retrieve embeddings', async () => {
      await setEmbeddings(cache, 'test-model', [
        { content: 'content-a', vector: new Float32Array([0.1, 0.2]) },
        { content: 'content-b', vector: new Float32Array([0.3, 0.4]) },
      ]);

      const retrieved = await getEmbeddings(cache, 'test-model', [
        'content-a',
        'content-b',
        'missing-content',
      ]);

      expect(retrieved.get('content-a')?.[0]).toBeCloseTo(0.1);
      expect(retrieved.get('content-a')?.[1]).toBeCloseTo(0.2);
      expect(retrieved.get('content-b')?.[0]).toBeCloseTo(0.3);
      expect(retrieved.get('content-b')?.[1]).toBeCloseTo(0.4);
      expect(retrieved.has('missing-content')).toBe(false);
    });

    it('should treat disabled cache as a cache miss and ignore writes', async () => {
      const disabledCache = await openEmbeddingCache(join(testDir, 'disabled-writes'), {
        enabled: false,
      });

      try {
        const vector = new Float32Array([0.1, 0.2]);
        await setEmbedding(disabledCache, 'model', 'content', vector);

        const retrieved = await getEmbedding(disabledCache, 'model', 'content');
        expect(retrieved).toBeNull();
      } finally {
        await disabledCache.close();
      }
    });

    it('should evict the oldest entries when maxEntries is exceeded', async () => {
      const limitedCache = await openEmbeddingCache(join(testDir, 'limited-cache'), {
        maxEntries: 2,
      });

      try {
        await setEmbedding(limitedCache, 'model', 'content-1', new Float32Array([0.1]));
        await setEmbedding(limitedCache, 'model', 'content-2', new Float32Array([0.2]));
        await setEmbedding(limitedCache, 'model', 'content-3', new Float32Array([0.3]));

        expect(await getEmbedding(limitedCache, 'model', 'content-1')).toBeNull();
        expect((await getEmbedding(limitedCache, 'model', 'content-2'))?.[0]).toBeCloseTo(0.2);
        expect((await getEmbedding(limitedCache, 'model', 'content-3'))?.[0]).toBeCloseTo(0.3);
      } finally {
        await limitedCache.close();
      }
    });

    it('should treat expired entries as cache misses when ttlHours is configured', async () => {
      const ttlCache = await openEmbeddingCache(join(testDir, 'ttl-cache'), {
        ttlHours: 1,
      });

      try {
        await setEmbedding(ttlCache, 'model', 'stale-content', new Float32Array([0.4]));

        const table = await ttlCache.connection!.openTable('embeddings');
        const records = await table.query().toArray();
        const staleRecord = records[0]!;

        await table.delete(`cache_key = '${staleRecord['cache_key'] as string}'`);
        await table.add([{
          ...staleRecord,
          created_at: '2000-01-01T00:00:00.000Z',
        }]);

        const retrieved = await getEmbedding(ttlCache, 'model', 'stale-content');
        expect(retrieved).toBeNull();
      } finally {
        await ttlCache.close();
      }
    });
  });

  describe('getCacheStats', () => {
    it('should return zero count for empty cache', async () => {
      const stats = await getCacheStats(cache);
      expect(stats.count).toBe(0);
    });

    it('should return correct count after adding embeddings', async () => {
      await setEmbedding(cache, 'model', 'content1', new Float32Array([0.1]));
      await setEmbedding(cache, 'model', 'content2', new Float32Array([0.2]));
      await setEmbedding(cache, 'model', 'content3', new Float32Array([0.3]));

      const stats = await getCacheStats(cache);
      expect(stats.count).toBe(3);
    });
  });

  describe('clearCache', () => {
    it('should remove all embeddings', async () => {
      await setEmbedding(cache, 'model', 'content1', new Float32Array([0.1]));
      await setEmbedding(cache, 'model', 'content2', new Float32Array([0.2]));

      await clearCache(cache);

      const stats = await getCacheStats(cache);
      expect(stats.count).toBe(0);
    });

    it('should allow adding embeddings after clearing', async () => {
      await setEmbedding(cache, 'model', 'content', new Float32Array([0.1]));
      await clearCache(cache);

      const vector = new Float32Array([0.5, 0.6]);
      await setEmbedding(cache, 'model', 'new-content', vector);

      const retrieved = await getEmbedding(cache, 'model', 'new-content');
      expect(Array.from(retrieved!)).toEqual(Array.from(vector));
    });
  });
});
