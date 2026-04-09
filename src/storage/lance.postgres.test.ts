import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MetadataRow {
  index_name: string;
  root_path: string;
  status: 'building' | 'ready' | 'failed';
  model: string;
  model_dimensions: number;
  created_at: string;
  updated_at: string;
  document_count: number;
  chunk_count: number;
  generation_id: number;
  schema_version: number;
}

interface ChunkRow {
  id: string;
  file_path: string;
  relative_path: string;
  content_hash: string;
  chunk_index: number;
  content: string;
  vector: string;
  language: string | null;
  line_start: number | null;
  line_end: number | null;
  file_type: string;
  created_at: string;
}

interface FileMetadataRow {
  file_path: string;
  content_hash: string;
  chunk_count: number;
  updated_at: string;
}

const state = vi.hoisted(() => ({
  tables: new Set<string>(),
  metadata: new Map<string, MetadataRow>(),
  chunks: new Map<string, Map<string, ChunkRow>>(),
  files: new Map<string, Map<string, FileMetadataRow>>(),
}));

function extractQuotedIdentifier(sql: string): string {
  const match = sql.match(/"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error(`Unable to extract identifier from SQL: ${sql}`);
  }
  return match[1];
}

function parseVectorLiteral(value: string): number[] {
  const trimmed = value.trim();
  const literal = trimmed.startsWith('[') ? trimmed.slice(1, -1) : trimmed;
  if (!literal) {
    return [];
  }
  return literal.split(',').map((entry) => Number(entry.trim()));
}

function cosineDistance(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  if (denominator === 0) {
    return 1;
  }

  return 1 - dot / denominator;
}

function getChunkTable(tableName: string): Map<string, ChunkRow> {
  let table = state.chunks.get(tableName);
  if (!table) {
    table = new Map<string, ChunkRow>();
    state.chunks.set(tableName, table);
  }
  state.tables.add(tableName);
  return table;
}

function getFileTable(tableName: string): Map<string, FileMetadataRow> {
  let table = state.files.get(tableName);
  if (!table) {
    table = new Map<string, FileMetadataRow>();
    state.files.set(tableName, table);
  }
  state.tables.add(tableName);
  return table;
}

function clearState(): void {
  state.tables.clear();
  state.metadata.clear();
  state.chunks.clear();
  state.files.clear();
}

vi.mock('pg', () => {
  class MockPool {
    async query(sql: string, params: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT pg_advisory_lock') || normalized.startsWith('SELECT pg_advisory_unlock')) {
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE EXTENSION')) {
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE INDEX')) {
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_indexes"')) {
        state.tables.add('lgrep_indexes');
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_chunks_')) {
        getChunkTable(extractQuotedIdentifier(normalized));
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_files_')) {
        getFileTable(extractQuotedIdentifier(normalized));
        return { rows: [] };
      }

      if (normalized.startsWith('SELECT EXISTS')) {
        const tableName = params[0] as string;
        return {
          rows: [{ exists: state.tables.has(tableName) }],
        };
      }

      if (normalized.startsWith('INSERT INTO "lgrep_indexes"')) {
        const indexName = String(params[0]);
        const row: MetadataRow = {
          index_name: indexName,
          root_path: params[1] as string,
          status: params[2] as MetadataRow['status'],
          model: params[3] as string,
          model_dimensions: params[4] as number,
          created_at: params[5] as string,
          updated_at: params[6] as string,
          document_count: params[7] as number,
          chunk_count: params[8] as number,
          generation_id: params[9] as number,
          schema_version: params[10] as number,
        };
        state.metadata.set(row.index_name, row);
        state.tables.add('lgrep_indexes');
        return { rows: [] };
      }

      if (normalized.includes('FROM "lgrep_indexes" WHERE index_name = $1')) {
        const row = state.metadata.get(String(params[0]));
        return { rows: row ? [row] : [] };
      }

      if (normalized.includes('FROM "lgrep_indexes" ORDER BY index_name ASC')) {
        return {
          rows: [...state.metadata.values()].sort((left, right) =>
            left.index_name.localeCompare(right.index_name)
          ),
        };
      }

      if (normalized.includes('DELETE FROM "lgrep_indexes"')) {
        const indexName = String(params[0]);
        state.metadata.delete(indexName);
        if (state.metadata.has(indexName)) {
          state.metadata.clear();
        }
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO "lgrep_chunks_')) {
        const table = getChunkTable(extractQuotedIdentifier(normalized));
        for (let index = 0; index < params.length; index += 12) {
          const row: ChunkRow = {
            id: params[index] as string,
            file_path: params[index + 1] as string,
            relative_path: params[index + 2] as string,
            content_hash: params[index + 3] as string,
            chunk_index: params[index + 4] as number,
            content: params[index + 5] as string,
            vector: params[index + 6] as string,
            language: params[index + 7] as string | null,
            line_start: params[index + 8] as number | null,
            line_end: params[index + 9] as number | null,
            file_type: params[index + 10] as string,
            created_at: params[index + 11] as string,
          };
          table.set(row.id, row);
        }
        return { rows: [] };
      }

      if (normalized.startsWith('SELECT COUNT(*)::text AS count FROM "lgrep_chunks_')) {
        const table = getChunkTable(extractQuotedIdentifier(normalized));
        if (normalized.includes('WHERE file_path = $1')) {
          const filePath = params[0] as string;
          const count = [...table.values()].filter((row) => row.file_path === filePath).length;
          return { rows: [{ count: String(count) }] };
        }

        return { rows: [{ count: String(table.size) }] };
      }

      if (normalized.startsWith('SELECT COUNT(DISTINCT file_path)::text AS count FROM "lgrep_chunks_')) {
        const table = getChunkTable(extractQuotedIdentifier(normalized));
        const count = new Set([...table.values()].map((row) => row.file_path)).size;
        return { rows: [{ count: String(count) }] };
      }

      if (normalized.includes('SELECT DISTINCT ON (file_path) file_path, content_hash')) {
        const table = getChunkTable(extractQuotedIdentifier(normalized));
        const byFile = new Map<string, ChunkRow>();
        for (const row of [...table.values()].sort((left, right) =>
          left.file_path.localeCompare(right.file_path) || left.chunk_index - right.chunk_index
        )) {
          if (!byFile.has(row.file_path)) {
            byFile.set(row.file_path, row);
          }
        }
        return {
          rows: [...byFile.values()].map((row) => ({
            file_path: row.file_path,
            content_hash: row.content_hash,
          })),
        };
      }

      if (normalized.includes('ORDER BY vector <=> $1::vector LIMIT $2')) {
        const table = getChunkTable(extractQuotedIdentifier(normalized));
        const queryVector = parseVectorLiteral(params[0] as string);
        const limit = params[1] as number;
        const rows = [...table.values()]
          .map((row) => ({
            ...row,
            _distance: cosineDistance(parseVectorLiteral(row.vector), queryVector),
          }))
          .sort((left, right) => left._distance - right._distance)
          .slice(0, limit)
          .map((row) => ({
            ...row,
            vector: row.vector,
          }));
        return { rows };
      }

      if (
        normalized.startsWith('SELECT id, file_path, relative_path, content_hash, chunk_index, content, vector::text AS vector') &&
        normalized.includes('WHERE file_path = $1')
      ) {
        const table = getChunkTable(extractQuotedIdentifier(normalized));
        const filePath = params[0] as string;
        return {
          rows: [...table.values()]
            .filter((row) => row.file_path === filePath)
            .sort((left, right) => left.chunk_index - right.chunk_index),
        };
      }

      if (normalized.startsWith('DELETE FROM "lgrep_chunks_')) {
        const table = getChunkTable(extractQuotedIdentifier(normalized));
        const filePath = params[0] as string;
        for (const [id, row] of table.entries()) {
          if (row.file_path === filePath) {
            table.delete(id);
          }
        }
        return { rows: [] };
      }

      if (normalized.startsWith('TRUNCATE TABLE "lgrep_chunks_')) {
        getChunkTable(extractQuotedIdentifier(normalized)).clear();
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO "lgrep_files_')) {
        const table = getFileTable(extractQuotedIdentifier(normalized));
        const row: FileMetadataRow = {
          file_path: params[0] as string,
          content_hash: params[1] as string,
          chunk_count: params[2] as number,
          updated_at: params[3] as string,
        };
        table.set(row.file_path, row);
        return { rows: [] };
      }

      if (normalized.startsWith('SELECT file_path, content_hash FROM "lgrep_files_')) {
        const table = getFileTable(extractQuotedIdentifier(normalized));
        return {
          rows: [...table.values()].map((row) => ({
            file_path: row.file_path,
            content_hash: row.content_hash,
          })),
        };
      }

      if (normalized.startsWith('DELETE FROM "lgrep_files_')) {
        getFileTable(extractQuotedIdentifier(normalized)).delete(params[0] as string);
        return { rows: [] };
      }

      if (normalized.startsWith('DROP TABLE IF EXISTS "')) {
        const tableName = extractQuotedIdentifier(normalized);
        state.tables.delete(tableName);
        state.chunks.delete(tableName);
        state.files.delete(tableName);
        return { rows: [] };
      }

      throw new Error(`Unhandled SQL in mock pool: ${normalized}`);
    }

    async connect() {
      return {
        query: this.query.bind(this),
        release: () => undefined,
      };
    }

    async end() {
      return undefined;
    }
  }

  return { Pool: MockPool };
});

import {
  addChunks,
  createFileMetadataTable,
  createIndex,
  deleteAllChunks,
  deleteChunksByFilePath,
  deleteFileMetadata,
  deleteIndex,
  getChunkCount,
  getChunksByFilePath,
  getFileContentHashes,
  getFileMetadataHashes,
  getIndex,
  listIndexes,
  openDatabase,
  searchChunks,
  updateIndexStatus,
  upsertFileMetadata,
} from './lance.js';
import { getPostgresIndexTableName } from './postgres.js';

describe('lance storage postgres backend', () => {
  beforeEach(() => {
    clearState();
  });

  afterEach(() => {
    clearState();
  });

  it('opens a postgres database without a LanceDB connection', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      expect(db.mode).toBe('postgres');
      expect(db.connection).toBeNull();
      expect(db.pool).toBeTruthy();
    } finally {
      await db.close();
    }
  });

  it('creates, queries, and deletes postgres-backed indexes', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      const handle = await createIndex(db, {
        name: 'postgres-index',
        rootPath: '/project',
        model: 'openai:text-embedding-3-small',
        modelDimensions: 4,
      });

      await addChunks(db, handle, [
        {
          id: 'chunk-1',
          filePath: '/project/src/a.ts',
          relativePath: 'src/a.ts',
          contentHash: 'hash-a',
          chunkIndex: 0,
          content: 'alpha',
          vector: new Float32Array([0.9, 0.1, 0.0, 0.0]),
          language: 'ts',
          lineStart: 1,
          lineEnd: 3,
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'chunk-2',
          filePath: '/project/src/b.ts',
          relativePath: 'src/b.ts',
          contentHash: 'hash-b',
          chunkIndex: 0,
          content: 'beta',
          vector: new Float32Array([0.1, 0.9, 0.0, 0.0]),
          language: 'ts',
          lineStart: 5,
          lineEnd: 8,
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ]);

      await updateIndexStatus(db, handle, 'ready');

      expect(await getChunkCount(db, handle)).toBe(2);
      expect((await listIndexes(db)).map((index) => index.name)).toEqual(['postgres-index']);
      expect((await getIndex(db, 'postgres-index'))?.metadata.status).toBe('ready');

      const results = await searchChunks(
        db,
        handle,
        new Float32Array([1.0, 0.0, 0.0, 0.0]),
        { limit: 1 }
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('alpha');

      const fileChunks = await getChunksByFilePath(db, handle, '/project/src/a.ts');
      expect(fileChunks).toHaveLength(1);
      expect(fileChunks[0]?.contentHash).toBe('hash-a');

      const deleted = await deleteChunksByFilePath(db, handle, '/project/src/a.ts');
      expect(deleted).toBe(1);
      expect(await getChunkCount(db, handle)).toBe(1);

      const deletedAll = await deleteAllChunks(db, handle);
      expect(deletedAll).toBe(1);
      expect(await getChunkCount(db, handle)).toBe(0);

      expect(await deleteIndex(db, 'postgres-index')).toBe(true);
      expect(state.tables.has(getPostgresIndexTableName('postgres-index', 'chunks'))).toBe(false);
      expect(state.tables.has(getPostgresIndexTableName('postgres-index', 'files'))).toBe(false);
    } finally {
      await db.close();
    }
  });

  it('stores and removes file metadata in postgres', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      const handle = await createIndex(db, {
        name: 'file-metadata-index',
        rootPath: '/project',
        model: 'openai:text-embedding-3-small',
        modelDimensions: 4,
      });

      await addChunks(db, handle, [
        {
          id: 'chunk-1',
          filePath: '/project/src/a.ts',
          relativePath: 'src/a.ts',
          contentHash: 'hash-a',
          chunkIndex: 0,
          content: 'alpha',
          vector: new Float32Array([0.9, 0.1, 0.0, 0.0]),
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'chunk-2',
          filePath: '/project/src/b.ts',
          relativePath: 'src/b.ts',
          contentHash: 'hash-b',
          chunkIndex: 0,
          content: 'beta',
          vector: new Float32Array([0.1, 0.9, 0.0, 0.0]),
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ]);

      await createFileMetadataTable(db, handle);
      await upsertFileMetadata(db, handle, '/project/src/a.ts', 'hash-a', 1);
      await upsertFileMetadata(db, handle, '/project/src/b.ts', 'hash-b', 1);

      expect(await getFileContentHashes(db, handle)).toEqual(
        new Map([
          ['/project/src/a.ts', 'hash-a'],
          ['/project/src/b.ts', 'hash-b'],
        ])
      );

      expect(await getFileMetadataHashes(db, handle)).toEqual(
        new Map([
          ['/project/src/a.ts', 'hash-a'],
          ['/project/src/b.ts', 'hash-b'],
        ])
      );

      await deleteFileMetadata(db, handle, '/project/src/a.ts');

      expect(await getFileMetadataHashes(db, handle)).toEqual(
        new Map([['/project/src/b.ts', 'hash-b']])
      );
    } finally {
      await db.close();
    }
  });
});
