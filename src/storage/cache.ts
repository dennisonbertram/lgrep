import * as lancedb from '@lancedb/lancedb';
import { mkdir } from 'node:fs/promises';
import { createCacheKey } from '../core/hash.js';

const TABLE_NAME = 'embeddings';

/**
 * Embedding cache handle.
 */
export interface EmbeddingCache {
  path: string;
  connection: lancedb.Connection;
  close(): Promise<void>;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  count: number;
}

/**
 * Open or create an embedding cache at the specified path.
 */
export async function openEmbeddingCache(cachePath: string): Promise<EmbeddingCache> {
  await mkdir(cachePath, { recursive: true });
  const connection = await lancedb.connect(cachePath);

  return {
    path: cachePath,
    connection,
    close: async () => {
      // LanceDB doesn't require explicit close
    },
  };
}

/**
 * Get a cached embedding by model and content.
 */
export async function getEmbedding(
  cache: EmbeddingCache,
  model: string,
  content: string
): Promise<Float32Array | null> {
  const tableNames = await cache.connection.tableNames();

  if (!tableNames.includes(TABLE_NAME)) {
    return null;
  }

  const key = createCacheKey(model, content);
  const table = await cache.connection.openTable(TABLE_NAME);

  const results = await table
    .query()
    .where(`cache_key = '${key}'`)
    .limit(1)
    .toArray();

  if (results.length === 0) {
    return null;
  }

  const record = results[0] as Record<string, unknown>;
  return new Float32Array(record['vector'] as number[]);
}

/**
 * Store an embedding in the cache.
 */
export async function setEmbedding(
  cache: EmbeddingCache,
  model: string,
  content: string,
  vector: Float32Array
): Promise<void> {
  const key = createCacheKey(model, content);
  const tableNames = await cache.connection.tableNames();

  const record = {
    cache_key: key,
    vector: Array.from(vector),
    created_at: new Date().toISOString(),
  };

  if (!tableNames.includes(TABLE_NAME)) {
    // Create table with first record
    await cache.connection.createTable(TABLE_NAME, [record]);
    return;
  }

  const table = await cache.connection.openTable(TABLE_NAME);

  // Check if key already exists
  const existing = await table
    .query()
    .where(`cache_key = '${key}'`)
    .limit(1)
    .toArray();

  if (existing.length > 0) {
    // Delete existing and insert new (LanceDB doesn't have upsert by key)
    await table.delete(`cache_key = '${key}'`);
  }

  await table.add([record]);
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(cache: EmbeddingCache): Promise<CacheStats> {
  const tableNames = await cache.connection.tableNames();

  if (!tableNames.includes(TABLE_NAME)) {
    return { count: 0 };
  }

  const table = await cache.connection.openTable(TABLE_NAME);
  const count = await table.countRows();

  return { count };
}

/**
 * Clear all cached embeddings.
 */
export async function clearCache(cache: EmbeddingCache): Promise<void> {
  const tableNames = await cache.connection.tableNames();

  if (!tableNames.includes(TABLE_NAME)) {
    return;
  }

  await cache.connection.dropTable(TABLE_NAME);
}
