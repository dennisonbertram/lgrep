import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  openEmbeddingCache,
  getEmbedding,
  setEmbedding,
  getCacheStats,
  clearCache,
  type EmbeddingCache,
} from './cache.js';

describe('embedding cache', () => {
  let testDir: string;
  let cache: EmbeddingCache;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-cache-test-${randomUUID()}`);
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
