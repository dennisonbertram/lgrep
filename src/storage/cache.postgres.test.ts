import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StoredRecord {
  model: string;
  vector: Buffer;
  createdAt: string;
  writeOrder: number;
}

const mockTables = vi.hoisted(() => new Map<string, Map<string, StoredRecord>>());
const mockWriteOrder = vi.hoisted(() => ({ value: 0 }));

function extractTableName(sql: string): string {
  const match = sql.match(/"(.*?)"/);
  if (!match?.[1]) {
    throw new Error(`Unable to extract table name from SQL: ${sql}`);
  }
  return match[1];
}

function getTable(tableName: string): Map<string, StoredRecord> {
  let table = mockTables.get(tableName);
  if (!table) {
    table = new Map<string, StoredRecord>();
    mockTables.set(tableName, table);
  }
  return table;
}

vi.mock('pg', () => {
  class MockPool {
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith('CREATE TABLE')) {
        getTable(extractTableName(sql));
        return { rows: [] };
      }

      if (sql.startsWith('CREATE SEQUENCE')) {
        return { rows: [] };
      }

      if (sql.startsWith('CREATE INDEX')) {
        return { rows: [] };
      }

      if (sql.startsWith('INSERT INTO')) {
        const table = getTable(extractTableName(sql));
        for (let index = 0; index < params.length; index += 4) {
          const cacheKey = params[index] as string;
          table.set(cacheKey, {
            model: params[index + 1] as string,
            vector: params[index + 2] as Buffer,
            createdAt: params[index + 3] as string,
            writeOrder: ++mockWriteOrder.value,
          });
        }
        return { rows: [] };
      }

      if (sql.includes('SELECT cache_key, vector, created_at')) {
        const table = getTable(extractTableName(sql));
        const cacheKeys = params[0] as string[];
        return {
          rows: cacheKeys
            .map((cacheKey) => {
              const record = table.get(cacheKey);
              if (!record) {
                return null;
              }
              return {
                cache_key: cacheKey,
                vector: record.vector,
                created_at: record.createdAt,
              };
            })
            .filter((record): record is { cache_key: string; vector: Buffer; created_at: string } => record !== null),
        };
      }

      if (sql.includes('SELECT vector, created_at')) {
        const table = getTable(extractTableName(sql));
        const cacheKey = params[0] as string;
        const record = table.get(cacheKey);
        return {
          rows: record ? [{
            vector: record.vector,
            created_at: record.createdAt,
          }] : [],
        };
      }

      if (sql.startsWith('DELETE FROM') && sql.includes('cache_key = $1')) {
        const table = getTable(extractTableName(sql));
        table.delete(params[0] as string);
        return { rows: [] };
      }

      if (sql.startsWith('DELETE FROM') && sql.includes('cache_key = ANY($1::text[])')) {
        const table = getTable(extractTableName(sql));
        for (const cacheKey of params[0] as string[]) {
          table.delete(cacheKey);
        }
        return { rows: [] };
      }

      if (sql.startsWith('DELETE FROM') && sql.includes('created_at <= $1')) {
        const table = getTable(extractTableName(sql));
        const cutoff = Date.parse(params[0] as string);
        for (const [cacheKey, record] of table.entries()) {
          if (Date.parse(record.createdAt) <= cutoff) {
            table.delete(cacheKey);
          }
        }
        return { rows: [] };
      }

      if (sql.startsWith('WITH overflow AS')) {
        const table = getTable(extractTableName(sql));
        const maxEntries = params[0] as number;
        const overflow = [...table.entries()]
          .sort((left, right) => right[1].writeOrder - left[1].writeOrder)
          .slice(maxEntries);
        for (const [cacheKey] of overflow) {
          table.delete(cacheKey);
        }
        return { rows: [] };
      }

      if (sql.startsWith('SELECT COUNT(*)::text AS count') && sql.includes('WHERE created_at > $1')) {
        const table = getTable(extractTableName(sql));
        const cutoff = Date.parse(params[0] as string);
        const count = [...table.values()].filter((record) => Date.parse(record.createdAt) > cutoff).length;
        return { rows: [{ count: String(count) }] };
      }

      if (sql.startsWith('SELECT COUNT(*)::text AS count')) {
        const table = getTable(extractTableName(sql));
        return { rows: [{ count: String(table.size) }] };
      }

      if (sql.startsWith('TRUNCATE TABLE')) {
        getTable(extractTableName(sql)).clear();
        return { rows: [] };
      }

      throw new Error(`Unhandled SQL in mock pool: ${sql}`);
    }

    async end() {
      return undefined;
    }
  }

  return { Pool: MockPool };
});

import {
  clearCache,
  getCacheStats,
  getEmbedding,
  getEmbeddings,
  openEmbeddingCache,
  setEmbedding,
  setEmbeddings,
  type EmbeddingCache,
} from './cache.js';

describe('embedding cache postgres backend', () => {
  let cache: EmbeddingCache;

  beforeEach(async () => {
    mockTables.clear();
    mockWriteOrder.value = 0;
    cache = await openEmbeddingCache('postgres://cache-user:secret@example.com:5432/lgrep', {
      settings: {
        mode: 'postgres',
        location: 'postgres://cache-user:secret@example.com:5432/lgrep',
        tableName: 'embedding_cache',
      },
    });
  });

  afterEach(async () => {
    await cache.close();
    mockTables.clear();
    mockWriteOrder.value = 0;
  });

  it('stores and retrieves embeddings remotely', async () => {
    const vector = new Float32Array([0.1, 0.2, 0.3]);

    await setEmbedding(cache, 'test-model', 'hello world', vector);

    const retrieved = await getEmbedding(cache, 'test-model', 'hello world');
    expect(Array.from(retrieved ?? [])).toEqual(Array.from(vector));
  });

  it('batch stores and retrieves embeddings remotely', async () => {
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

  it('applies maxEntries eviction for remote cache tables', async () => {
    const limitedCache = await openEmbeddingCache('postgres://cache-user:secret@example.com:5432/lgrep', {
      maxEntries: 2,
      settings: {
        mode: 'postgres',
        location: 'postgres://cache-user:secret@example.com:5432/lgrep',
        tableName: 'embedding_cache',
      },
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

  it('treats expired remote entries as cache misses', async () => {
    const ttlCache = await openEmbeddingCache('postgres://cache-user:secret@example.com:5432/lgrep', {
      ttlHours: 1,
      settings: {
        mode: 'postgres',
        location: 'postgres://cache-user:secret@example.com:5432/lgrep',
        tableName: 'embedding_cache',
      },
    });

    try {
      await setEmbedding(ttlCache, 'model', 'stale-content', new Float32Array([0.4]));

      const table = getTable('embedding_cache');
      const [cacheKey, record] = [...table.entries()][0] ?? [];
      if (!cacheKey || !record) {
        throw new Error('Expected a stored cache record');
      }

      table.set(cacheKey, {
        ...record,
        createdAt: '2000-01-01T00:00:00.000Z',
      });

      const retrieved = await getEmbedding(ttlCache, 'model', 'stale-content');
      expect(retrieved).toBeNull();
      expect(table.size).toBe(0);
    } finally {
      await ttlCache.close();
    }
  });

  it('reports stats and clears remote cache entries', async () => {
    await setEmbedding(cache, 'model', 'content-1', new Float32Array([0.1]));
    await setEmbedding(cache, 'model', 'content-2', new Float32Array([0.2]));

    expect((await getCacheStats(cache)).count).toBe(2);

    await clearCache(cache);

    expect((await getCacheStats(cache)).count).toBe(0);
  });
});
