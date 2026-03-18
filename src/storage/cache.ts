import * as lancedb from '@lancedb/lancedb';
import { mkdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { createCacheKey } from '../core/hash.js';
import type { CacheSettings } from './cache-config.js';

const LOCAL_TABLE_NAME = 'embeddings';
const DEFAULT_REMOTE_TABLE_NAME = 'embedding_cache';

/**
 * Options for the embedding cache.
 */
export interface EmbeddingCacheOptions {
  enabled?: boolean;
  maxEntries?: number;
  ttlHours?: number;
  settings?: CacheSettings;
}

/**
 * Embedding cache handle.
 */
export interface EmbeddingCache {
  path: string;
  backend: 'local' | 'postgres';
  enabled: boolean;
  connection: lancedb.Connection | null;
  pool: Pool | null;
  tableName: string;
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

export interface CachedEmbedding {
  content: string;
  vector: Float32Array;
}

interface CacheMetadataRecord {
  cache_key: string;
  created_at?: string;
}

interface PostgresCacheRecord {
  cache_key?: string;
  vector: Buffer;
  created_at: Date | string;
}

/**
 * Open or create an embedding cache at the specified path or remote location.
 */
export async function openEmbeddingCache(
  cachePath: string,
  options: EmbeddingCacheOptions = {}
): Promise<EmbeddingCache> {
  const enabled = options.enabled ?? true;
  const maxEntries = normalizeLimit(options.maxEntries);
  const ttlHours = normalizeLimit(options.ttlHours);
  const settings = options.settings ?? {
    mode: 'local' as const,
    location: cachePath,
    tableName: DEFAULT_REMOTE_TABLE_NAME,
  };

  if (!enabled) {
    return {
      path: settings.mode === 'local' ? settings.location : settings.tableName,
      backend: settings.mode,
      enabled: false,
      connection: null,
      pool: null,
      tableName: settings.mode === 'local' ? LOCAL_TABLE_NAME : settings.tableName,
      maxEntries,
      ttlHours,
      close: async () => {
        // Disabled cache has no resources to close.
      },
    };
  }

  if (settings.mode === 'postgres') {
    const pool = new Pool({
      connectionString: settings.location,
    });
    await ensurePostgresTable(pool, settings.tableName);

    return {
      path: settings.tableName,
      backend: 'postgres',
      enabled,
      connection: null,
      pool,
      tableName: settings.tableName,
      maxEntries,
      ttlHours,
      close: async () => {
        await pool.end();
      },
    };
  }

  await mkdir(settings.location, { recursive: true });
  const connection = await lancedb.connect(settings.location);

  return {
    path: settings.location,
    backend: 'local',
    enabled,
    connection,
    pool: null,
    tableName: LOCAL_TABLE_NAME,
    maxEntries,
    ttlHours,
    close: async () => {
      // LanceDB doesn't require explicit close.
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
  if (!cache.enabled) {
    return null;
  }

  if (cache.backend === 'postgres') {
    return await getEmbeddingFromPostgres(cache, model, content);
  }

  return await getEmbeddingFromLocal(cache, model, content);
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
  if (!cache.enabled) {
    return;
  }

  if (cache.backend === 'postgres') {
    await setEmbeddingInPostgres(cache, model, content, vector);
    return;
  }

  await setEmbeddingInLocal(cache, model, content, vector);
}

/**
 * Get multiple cached embeddings for a single model.
 */
export async function getEmbeddings(
  cache: EmbeddingCache,
  model: string,
  contents: string[]
): Promise<Map<string, Float32Array>> {
  if (!cache.enabled || contents.length === 0) {
    return new Map();
  }

  if (cache.backend === 'postgres') {
    return await getEmbeddingsFromPostgres(cache, model, contents);
  }

  return await getEmbeddingsFromLocal(cache, model, contents);
}

/**
 * Store multiple embeddings in the cache.
 */
export async function setEmbeddings(
  cache: EmbeddingCache,
  model: string,
  embeddings: CachedEmbedding[]
): Promise<void> {
  if (!cache.enabled || embeddings.length === 0) {
    return;
  }

  if (cache.backend === 'postgres') {
    await setEmbeddingsInPostgres(cache, model, embeddings);
    return;
  }

  for (const embedding of embeddings) {
    await setEmbeddingInLocal(cache, model, embedding.content, embedding.vector);
  }
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(cache: EmbeddingCache): Promise<CacheStats> {
  if (!cache.enabled) {
    return { count: 0 };
  }

  if (cache.backend === 'postgres') {
    return await getPostgresCacheStats(cache);
  }

  return await getLocalCacheStats(cache);
}

/**
 * Clear all cached embeddings.
 */
export async function clearCache(cache: EmbeddingCache): Promise<void> {
  if (!cache.enabled) {
    return;
  }

  if (cache.backend === 'postgres') {
    const pool = requirePostgresPool(cache);
    await pool.query(`TRUNCATE TABLE ${quoteIdentifier(cache.tableName)}`);
    return;
  }

  const connection = cache.connection;
  if (!connection) {
    return;
  }

  const tableNames = await connection.tableNames();
  if (!tableNames.includes(LOCAL_TABLE_NAME)) {
    return;
  }

  await connection.dropTable(LOCAL_TABLE_NAME);
}

async function getEmbeddingFromLocal(
  cache: EmbeddingCache,
  model: string,
  content: string
): Promise<Float32Array | null> {
  const connection = cache.connection;
  if (!connection) {
    return null;
  }

  const tableNames = await connection.tableNames();
  if (!tableNames.includes(LOCAL_TABLE_NAME)) {
    return null;
  }

  const key = createCacheKey(model, content);
  const table = await connection.openTable(LOCAL_TABLE_NAME);
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

async function getEmbeddingsFromLocal(
  cache: EmbeddingCache,
  model: string,
  contents: string[]
): Promise<Map<string, Float32Array>> {
  const dedupedContents = dedupeContents(contents);
  const results = new Map<string, Float32Array>();

  for (const content of dedupedContents) {
    const embedding = await getEmbeddingFromLocal(cache, model, content);
    if (embedding) {
      results.set(content, embedding);
    }
  }

  return results;
}

async function setEmbeddingInLocal(
  cache: EmbeddingCache,
  model: string,
  content: string,
  vector: Float32Array
): Promise<void> {
  const connection = cache.connection;
  if (!connection) {
    return;
  }

  const key = createCacheKey(model, content);
  const tableNames = await connection.tableNames();
  const record = {
    cache_key: key,
    vector: Array.from(vector),
    created_at: new Date().toISOString(),
  };

  if (!tableNames.includes(LOCAL_TABLE_NAME)) {
    await connection.createTable(LOCAL_TABLE_NAME, [record]);
    return;
  }

  const table = await connection.openTable(LOCAL_TABLE_NAME);
  const existing = await table
    .query()
    .where(`cache_key = '${key}'`)
    .limit(1)
    .toArray();

  if (existing.length > 0) {
    await table.delete(`cache_key = '${key}'`);
  }

  await table.add([record]);
  await enforceLocalCachePolicies(cache, table);
}

async function getLocalCacheStats(cache: EmbeddingCache): Promise<CacheStats> {
  const connection = cache.connection;
  if (!connection) {
    return { count: 0 };
  }

  const tableNames = await connection.tableNames();
  if (!tableNames.includes(LOCAL_TABLE_NAME)) {
    return { count: 0 };
  }

  const table = await connection.openTable(LOCAL_TABLE_NAME);
  const metadata = await loadLocalCacheMetadata(table);
  const activeEntries = filterActiveEntries(metadata, cache.ttlHours);
  return { count: activeEntries.length };
}

async function loadLocalCacheMetadata(
  table: lancedb.Table
): Promise<CacheMetadataRecord[]> {
  return (await table
    .query()
    .select(['cache_key', 'created_at'])
    .toArray()) as CacheMetadataRecord[];
}

async function deleteLocalKeys(
  table: lancedb.Table,
  cacheKeys: string[]
): Promise<void> {
  for (const cacheKey of cacheKeys) {
    await table.delete(`cache_key = '${cacheKey}'`);
  }
}

async function enforceLocalCachePolicies(
  cache: EmbeddingCache,
  table: lancedb.Table
): Promise<void> {
  if (cache.ttlHours <= 0 && cache.maxEntries <= 0) {
    return;
  }

  const metadata = await loadLocalCacheMetadata(table);
  const expiredKeys = metadata
    .filter((record) => isExpired(record.created_at, cache.ttlHours))
    .map((record) => record.cache_key);

  if (expiredKeys.length > 0) {
    await deleteLocalKeys(table, expiredKeys);
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

  await deleteLocalKeys(table, keysToDelete);
}

async function getEmbeddingFromPostgres(
  cache: EmbeddingCache,
  model: string,
  content: string
): Promise<Float32Array | null> {
  const pool = requirePostgresPool(cache);
  const key = createCacheKey(model, content);
  const result = await pool.query<PostgresCacheRecord>(
    `SELECT vector, created_at
       FROM ${quoteIdentifier(cache.tableName)}
      WHERE cache_key = $1
      LIMIT 1`,
    [key]
  );

  const record = result.rows[0];
  if (!record) {
    return null;
  }

  if (isExpired(record.created_at, cache.ttlHours)) {
    await pool.query(
      `DELETE FROM ${quoteIdentifier(cache.tableName)} WHERE cache_key = $1`,
      [key]
    );
    return null;
  }

  return bufferToVector(record.vector);
}

async function getEmbeddingsFromPostgres(
  cache: EmbeddingCache,
  model: string,
  contents: string[]
): Promise<Map<string, Float32Array>> {
  const pool = requirePostgresPool(cache);
  const dedupedContents = dedupeContents(contents);
  const keyToContent = new Map<string, string>();

  for (const content of dedupedContents) {
    keyToContent.set(createCacheKey(model, content), content);
  }

  const keys = [...keyToContent.keys()];
  if (keys.length === 0) {
    return new Map();
  }

  const result = await pool.query<PostgresCacheRecord>(
    `SELECT cache_key, vector, created_at
       FROM ${quoteIdentifier(cache.tableName)}
      WHERE cache_key = ANY($1::text[])`,
    [keys]
  );

  const expiredKeys: string[] = [];
  const embeddings = new Map<string, Float32Array>();

  for (const record of result.rows) {
    const cacheKey = record.cache_key;
    if (!cacheKey) {
      continue;
    }

    if (isExpired(record.created_at, cache.ttlHours)) {
      expiredKeys.push(cacheKey);
      continue;
    }

    const content = keyToContent.get(cacheKey);
    if (content) {
      embeddings.set(content, bufferToVector(record.vector));
    }
  }

  if (expiredKeys.length > 0) {
    await pool.query(
      `DELETE FROM ${quoteIdentifier(cache.tableName)}
        WHERE cache_key = ANY($1::text[])`,
      [expiredKeys]
    );
  }

  return embeddings;
}

async function setEmbeddingInPostgres(
  cache: EmbeddingCache,
  model: string,
  content: string,
  vector: Float32Array
): Promise<void> {
  await setEmbeddingsInPostgres(cache, model, [{ content, vector }]);
}

async function setEmbeddingsInPostgres(
  cache: EmbeddingCache,
  model: string,
  embeddings: CachedEmbedding[]
): Promise<void> {
  const pool = requirePostgresPool(cache);
  const dedupedEmbeddings = dedupeEmbeddings(embeddings);
  if (dedupedEmbeddings.length === 0) {
    return;
  }

  const sequenceName = getPostgresSequenceName(cache.tableName);
  const values: string[] = [];
  const params: unknown[] = [];

  for (const embedding of dedupedEmbeddings) {
    const base = params.length;
    params.push(
      createCacheKey(model, embedding.content),
      model,
      vectorToBuffer(embedding.vector),
      new Date().toISOString()
    );
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, nextval('${escapeLiteral(sequenceName)}'))`
    );
  }

  await pool.query(
    `INSERT INTO ${quoteIdentifier(cache.tableName)} (cache_key, model, vector, created_at, write_order)
     VALUES ${values.join(', ')}
     ON CONFLICT (cache_key)
     DO UPDATE SET
       model = EXCLUDED.model,
       vector = EXCLUDED.vector,
       created_at = EXCLUDED.created_at,
       write_order = nextval('${escapeLiteral(sequenceName)}')`,
    params
  );

  await enforcePostgresCachePolicies(cache, pool);
}

async function getPostgresCacheStats(cache: EmbeddingCache): Promise<CacheStats> {
  const pool = requirePostgresPool(cache);

  if (cache.ttlHours <= 0) {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(cache.tableName)}`
    );
    return { count: Number(result.rows[0]?.count ?? '0') };
  }

  const cutoff = new Date(Date.now() - cache.ttlHours * 60 * 60 * 1000).toISOString();
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM ${quoteIdentifier(cache.tableName)}
      WHERE created_at > $1`,
    [cutoff]
  );
  return { count: Number(result.rows[0]?.count ?? '0') };
}

async function ensurePostgresTable(pool: Pool, tableName: string): Promise<void> {
  const quotedTable = quoteIdentifier(tableName);
  const sequenceName = getPostgresSequenceName(tableName);
  const quotedSequence = quoteIdentifier(sequenceName);
  const quotedCreatedAtIndex = quoteIdentifier(`${tableName}_created_at_idx`);
  const quotedWriteOrderIndex = quoteIdentifier(`${tableName}_write_order_idx`);
  await pool.query(
    `CREATE SEQUENCE IF NOT EXISTS ${quotedSequence}`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${quotedTable} (
      cache_key TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      vector BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      write_order BIGINT NOT NULL DEFAULT nextval('${escapeLiteral(sequenceName)}')
    )`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quotedCreatedAtIndex}
      ON ${quotedTable} (created_at)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quotedWriteOrderIndex}
      ON ${quotedTable} (write_order DESC)`
  );
}

async function enforcePostgresCachePolicies(
  cache: EmbeddingCache,
  pool: Pool
): Promise<void> {
  const quotedTable = quoteIdentifier(cache.tableName);

  if (cache.ttlHours > 0) {
    const cutoff = new Date(Date.now() - cache.ttlHours * 60 * 60 * 1000).toISOString();
    await pool.query(
      `DELETE FROM ${quotedTable}
        WHERE created_at <= $1`,
      [cutoff]
    );
  }

  if (cache.maxEntries <= 0) {
    return;
  }

  await pool.query(
    `WITH overflow AS (
       SELECT cache_key
         FROM ${quotedTable}
        ORDER BY write_order DESC
        OFFSET $1
     )
     DELETE FROM ${quotedTable}
      WHERE cache_key IN (SELECT cache_key FROM overflow)`,
    [cache.maxEntries]
  );
}

function requirePostgresPool(cache: EmbeddingCache): Pool {
  if (!cache.pool) {
    throw new Error('Postgres cache pool is not available');
  }
  return cache.pool;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function getPostgresSequenceName(tableName: string): string {
  return `${tableName}_write_order_seq`;
}

function vectorToBuffer(vector: Float32Array): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  for (let index = 0; index < vector.length; index++) {
    buffer.writeFloatLE(vector[index] ?? 0, index * 4);
  }
  return buffer;
}

function bufferToVector(buffer: Buffer): Float32Array {
  const size = Math.floor(buffer.length / 4);
  const vector = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    vector[index] = buffer.readFloatLE(index * 4);
  }
  return vector;
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function parseTimestamp(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }

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

function dedupeContents(contents: string[]): string[] {
  return [...new Set(contents)];
}

function dedupeEmbeddings(embeddings: CachedEmbedding[]): CachedEmbedding[] {
  const deduped = new Map<string, CachedEmbedding>();

  for (const embedding of embeddings) {
    deduped.set(embedding.content, embedding);
  }

  return [...deduped.values()];
}
