import * as lancedb from '@lancedb/lancedb';
import { mkdir } from 'node:fs/promises';
import { createCacheKey } from '../core/hash.js';

const TABLE_NAME = 'embeddings';

/**
 * Options for the local embedding cache.
 */
export interface EmbeddingCacheOptions {
  enabled?: boolean;
  maxEntries?: number;
  ttlHours?: number;
}

/**
 * Embedding cache handle.
 */
export interface EmbeddingCache {
  path: string;
  enabled: boolean;
  connection: lancedb.Connection | null;
  maxEntries: number;
  ttlHours: number;
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
export async function openEmbeddingCache(
  cachePath: string,
  options: EmbeddingCacheOptions = {}
): Promise<EmbeddingCache> {
  const enabled = options.enabled ?? true;
  const maxEntries = normalizeLimit(options.maxEntries);
  const ttlHours = normalizeLimit(options.ttlHours);

  if (!enabled) {
    return {
      path: cachePath,
      enabled: false,
      connection: null,
      maxEntries,
      ttlHours,
      close: async () => {
        // LanceDB doesn't require explicit close
      },
    };
  }

  await mkdir(cachePath, { recursive: true });
  const connection = await lancedb.connect(cachePath);

  return {
    path: cachePath,
    enabled,
    connection,
    maxEntries,
    ttlHours,
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
  const connection = cache.connection;
  if (!cache.enabled || !connection) {
    return null;
  }

  const tableNames = await connection.tableNames();

  if (!tableNames.includes(TABLE_NAME)) {
    return null;
  }

  const key = createCacheKey(model, content);
  const table = await connection.openTable(TABLE_NAME);

  const results = await table
    .query()
    .where(`cache_key = '${key}'`)
    .limit(1)
    .toArray();

  if (results.length === 0) {
    return null;
  }

  const record = results[0] as Record<string, unknown>;
  if (isExpired(record['created_at'], cache.ttlHours)) {
    await table.delete(`cache_key = '${key}'`);
    return null;
  }

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
  const connection = cache.connection;
  if (!cache.enabled || !connection) {
    return;
  }

  const key = createCacheKey(model, content);
  const tableNames = await connection.tableNames();

  const record = {
    cache_key: key,
    vector: Array.from(vector),
    created_at: new Date().toISOString(),
  };

  if (!tableNames.includes(TABLE_NAME)) {
    // Create table with first record
    await connection.createTable(TABLE_NAME, [record]);
    return;
  }

  const table = await connection.openTable(TABLE_NAME);

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
  await enforceCachePolicies(cache, table);
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(cache: EmbeddingCache): Promise<CacheStats> {
  const connection = cache.connection;
  if (!cache.enabled || !connection) {
    return { count: 0 };
  }

  const tableNames = await connection.tableNames();

  if (!tableNames.includes(TABLE_NAME)) {
    return { count: 0 };
  }

  const table = await connection.openTable(TABLE_NAME);
  const metadata = await loadCacheMetadata(table);
  const activeEntries = filterActiveEntries(metadata, cache.ttlHours);

  return { count: activeEntries.length };
}

/**
 * Clear all cached embeddings.
 */
export async function clearCache(cache: EmbeddingCache): Promise<void> {
  const connection = cache.connection;
  if (!cache.enabled || !connection) {
    return;
  }

  const tableNames = await connection.tableNames();

  if (!tableNames.includes(TABLE_NAME)) {
    return;
  }

  await connection.dropTable(TABLE_NAME);
}

interface CacheMetadataRecord {
  cache_key: string;
  created_at?: string;
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isExpired(createdAt: unknown, ttlHours: number): boolean {
  if (ttlHours <= 0) {
    return false;
  }

  return parseTimestamp(createdAt) <= Date.now() - ttlHours * 60 * 60 * 1000;
}

function filterActiveEntries(
  metadata: CacheMetadataRecord[],
  ttlHours: number
): CacheMetadataRecord[] {
  return metadata.filter((record) => !isExpired(record.created_at, ttlHours));
}

async function loadCacheMetadata(
  table: lancedb.Table
): Promise<CacheMetadataRecord[]> {
  return (await table
    .query()
    .select(['cache_key', 'created_at'])
    .toArray()) as CacheMetadataRecord[];
}

async function deleteKeys(
  table: lancedb.Table,
  cacheKeys: string[]
): Promise<void> {
  for (const cacheKey of cacheKeys) {
    await table.delete(`cache_key = '${cacheKey}'`);
  }
}

async function enforceCachePolicies(
  cache: EmbeddingCache,
  table: lancedb.Table
): Promise<void> {
  if (cache.ttlHours <= 0 && cache.maxEntries <= 0) {
    return;
  }

  const metadata = await loadCacheMetadata(table);
  const expiredKeys = metadata
    .filter((record) => isExpired(record.created_at, cache.ttlHours))
    .map((record) => record.cache_key);

  if (expiredKeys.length > 0) {
    await deleteKeys(table, expiredKeys);
  }

  if (cache.maxEntries <= 0) {
    return;
  }

  const activeEntries = filterActiveEntries(metadata, cache.ttlHours);
  if (activeEntries.length <= cache.maxEntries) {
    return;
  }

  const keysToDelete = activeEntries
    .sort((left, right) => parseTimestamp(left.created_at) - parseTimestamp(right.created_at))
    .slice(0, activeEntries.length - cache.maxEntries)
    .map((record) => record.cache_key);

  await deleteKeys(table, keysToDelete);
}
