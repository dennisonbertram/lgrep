import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface SharedChunkRow {
  content_hash: string;
  chunk_index: number;
  model: string;
  content: string;
  vector: string;
  language: string | null;
  line_start: number | null;
  line_end: number | null;
  file_type: string;
  created_at: string;
}

interface SharedSymbolRow {
  id: number;
  content_hash: string;
  name: string;
  kind: string;
  line_start: number;
  line_end: number;
  column_start: number;
  column_end: number;
  is_exported: number;
  is_default_export: number;
  documentation: string;
  signature: string;
  parent_id: string;
  modifiers: string;
  summary: string;
  summary_model: string;
  body_hash: string;
  created_at: string;
}

interface SharedDependencyRow {
  id: number;
  content_hash: string;
  target_module: string;
  resolved_path: string;
  kind: string;
  names: string;
  line: number;
  is_external: number;
  created_at: string;
}

interface SharedCallRow {
  id: number;
  content_hash: string;
  caller_name: string;
  callee_name: string;
  callee_file: string;
  line: number;
  column: number;
  is_method_call: number;
  receiver: string;
  argument_count: number;
  created_at: string;
}

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

const state = vi.hoisted(() => ({
  tables: new Set<string>(),
  metadata: new Map<string, MetadataRow>(),
  sharedChunks: [] as SharedChunkRow[],
  sharedSymbols: [] as SharedSymbolRow[],
  sharedDependencies: [] as SharedDependencyRow[],
  sharedCalls: [] as SharedCallRow[],
  autoId: 0,
}));

function parseVectorLiteral(value: string): number[] {
  const trimmed = value.trim();
  const literal = trimmed.startsWith('[') ? trimmed.slice(1, -1) : trimmed;
  if (!literal) return [];
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
  if (denominator === 0) return 1;
  return 1 - dot / denominator;
}

function clearState(): void {
  state.tables.clear();
  state.metadata.clear();
  state.sharedChunks.length = 0;
  state.sharedSymbols.length = 0;
  state.sharedDependencies.length = 0;
  state.sharedCalls.length = 0;
  state.autoId = 0;
}

vi.mock('pg', () => {
  class MockPool {
    async query(sql: string, params: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

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

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_shared_chunks"')) {
        state.tables.add('lgrep_shared_chunks');
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_shared_symbols"')) {
        state.tables.add('lgrep_shared_symbols');
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_shared_dependencies"')) {
        state.tables.add('lgrep_shared_dependencies');
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_shared_calls"')) {
        state.tables.add('lgrep_shared_calls');
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

      // Shared chunks INSERT ... ON CONFLICT DO NOTHING
      if (normalized.startsWith('INSERT INTO "lgrep_shared_chunks"') && normalized.includes('ON CONFLICT')) {
        for (let index = 0; index < params.length; index += 10) {
          const row: SharedChunkRow = {
            content_hash: params[index] as string,
            chunk_index: params[index + 1] as number,
            model: params[index + 2] as string,
            content: params[index + 3] as string,
            vector: params[index + 4] as string,
            language: params[index + 5] as string | null,
            line_start: params[index + 6] as number | null,
            line_end: params[index + 7] as number | null,
            file_type: params[index + 8] as string,
            created_at: params[index + 9] as string,
          };
          // ON CONFLICT DO NOTHING: skip if exists
          const exists = state.sharedChunks.some(
            (existing) =>
              existing.content_hash === row.content_hash &&
              existing.chunk_index === row.chunk_index &&
              existing.model === row.model
          );
          if (!exists) {
            state.sharedChunks.push(row);
          }
        }
        return { rows: [] };
      }

      // Shared chunks SELECT by content_hash
      if (normalized.includes('FROM "lgrep_shared_chunks"') && normalized.includes('content_hash IN')) {
        const modelParam = normalized.includes('AND model =');
        const hashParams = modelParam ? params.slice(0, -1) : params;
        const model = modelParam ? (params[params.length - 1] as string) : undefined;

        let rows = state.sharedChunks.filter((row) =>
          (hashParams as string[]).includes(row.content_hash)
        );
        if (model) {
          rows = rows.filter((row) => row.model === model);
        }

        if (normalized.includes('ORDER BY')) {
          rows.sort(
            (a, b) => a.content_hash.localeCompare(b.content_hash) || a.chunk_index - b.chunk_index
          );
        }

        return { rows };
      }

      // Shared chunks DISTINCT content_hash (contentHashesExist)
      if (
        normalized.includes('SELECT DISTINCT content_hash') &&
        normalized.includes('FROM "lgrep_shared_chunks"')
      ) {
        const model = params[params.length - 1] as string;
        const hashes = params.slice(0, -1) as string[];

        const matchingHashes = new Set<string>();
        for (const row of state.sharedChunks) {
          if (hashes.includes(row.content_hash) && row.model === model) {
            matchingHashes.add(row.content_hash);
          }
        }
        return {
          rows: [...matchingHashes].map((h) => ({ content_hash: h })),
        };
      }

      // Shared chunks vector search
      if (
        normalized.includes('FROM "lgrep_shared_chunks"') &&
        normalized.includes('ORDER BY vector <=> $1::vector')
      ) {
        const queryVector = parseVectorLiteral(params[0] as string);
        const limit = params[params.length - 1] as number;

        let rows = [...state.sharedChunks];

        // Apply model filter if present
        if (normalized.includes('model =')) {
          const modelIdx = params.findIndex(
            (p, i) => i > 0 && i < params.length - 1 && typeof p === 'string' && !p.startsWith('[')
          );
          if (modelIdx >= 0) {
            const model = params[modelIdx] as string;
            rows = rows.filter((row) => row.model === model);
          }
        }

        // Apply hash filter if present
        if (normalized.includes('content_hash IN')) {
          const hashParams = params.slice(1, -1).filter((p) => typeof p === 'string' && !p.startsWith('['));
          if (hashParams.length > 0) {
            rows = rows.filter((row) => (hashParams as string[]).includes(row.content_hash));
          }
        }

        return {
          rows: rows
            .map((row) => ({
              ...row,
              _distance: cosineDistance(parseVectorLiteral(row.vector), queryVector),
            }))
            .sort((a, b) => a._distance - b._distance)
            .slice(0, limit),
        };
      }

      // Shared symbols INSERT
      if (normalized.startsWith('INSERT INTO "lgrep_shared_symbols"') && normalized.includes('ON CONFLICT')) {
        for (let index = 0; index < params.length; index += 16) {
          const row: SharedSymbolRow = {
            id: ++state.autoId,
            content_hash: params[index] as string,
            name: params[index + 1] as string,
            kind: params[index + 2] as string,
            line_start: params[index + 3] as number,
            line_end: params[index + 4] as number,
            column_start: params[index + 5] as number,
            column_end: params[index + 6] as number,
            is_exported: params[index + 7] as number,
            is_default_export: params[index + 8] as number,
            documentation: params[index + 9] as string,
            signature: params[index + 10] as string,
            parent_id: params[index + 11] as string,
            modifiers: params[index + 12] as string,
            summary: params[index + 13] as string,
            summary_model: params[index + 14] as string,
            body_hash: params[index + 15] as string,
          };
          const exists = state.sharedSymbols.some(
            (existing) =>
              existing.content_hash === row.content_hash &&
              existing.name === row.name &&
              existing.kind === row.kind &&
              existing.line_start === row.line_start
          );
          if (!exists) {
            state.sharedSymbols.push(row);
          }
        }
        return { rows: [] };
      }

      // Shared symbols SELECT by content_hash
      if (normalized.includes('FROM "lgrep_shared_symbols"') && normalized.includes('content_hash IN')) {
        const hashes = params as string[];
        return {
          rows: state.sharedSymbols.filter((row) => hashes.includes(row.content_hash)),
        };
      }

      // Shared dependencies INSERT
      if (normalized.startsWith('INSERT INTO "lgrep_shared_dependencies"') && normalized.includes('ON CONFLICT')) {
        for (let index = 0; index < params.length; index += 7) {
          const row: SharedDependencyRow = {
            id: ++state.autoId,
            content_hash: params[index] as string,
            target_module: params[index + 1] as string,
            resolved_path: params[index + 2] as string,
            kind: params[index + 3] as string,
            names: params[index + 4] as string,
            line: params[index + 5] as number,
            is_external: params[index + 6] as number,
            created_at: new Date().toISOString(),
          };
          const exists = state.sharedDependencies.some(
            (existing) =>
              existing.content_hash === row.content_hash &&
              existing.target_module === row.target_module &&
              existing.line === row.line
          );
          if (!exists) {
            state.sharedDependencies.push(row);
          }
        }
        return { rows: [] };
      }

      // Shared calls INSERT
      if (normalized.startsWith('INSERT INTO "lgrep_shared_calls"') && normalized.includes('ON CONFLICT')) {
        for (let index = 0; index < params.length; index += 9) {
          const row: SharedCallRow = {
            id: ++state.autoId,
            content_hash: params[index] as string,
            caller_name: params[index + 1] as string,
            callee_name: params[index + 2] as string,
            callee_file: params[index + 3] as string,
            line: params[index + 4] as number,
            column: params[index + 5] as number,
            is_method_call: params[index + 6] as number,
            receiver: params[index + 7] as string,
            argument_count: params[index + 8] as number,
            created_at: new Date().toISOString(),
          };
          const exists = state.sharedCalls.some(
            (existing) =>
              existing.content_hash === row.content_hash &&
              existing.callee_name === row.callee_name &&
              existing.line === row.line &&
              existing.column === row.column
          );
          if (!exists) {
            state.sharedCalls.push(row);
          }
        }
        return { rows: [] };
      }

      throw new Error(`Unhandled SQL in mock pool: ${normalized}`);
    }

    async end() {
      return undefined;
    }
  }

  return { Pool: MockPool };
});

import {
  ensureSharedTables,
  addSharedChunks,
  getSharedChunksByHash,
  searchSharedChunks,
  contentHashesExist,
  openDatabase,
} from './lance.js';
import {
  ensureSharedCodeIntelTables,
  addSharedSymbols,
  addSharedDependencies,
  addSharedCalls,
  getSharedSymbolsByHash,
} from './code-intel.js';

describe('shared content-addressable store (postgres)', () => {
  beforeEach(() => {
    clearState();
  });

  afterEach(() => {
    clearState();
  });

  it('creates shared tables without error', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      await ensureSharedTables(db, 4);
      expect(state.tables.has('lgrep_shared_chunks')).toBe(true);

      await ensureSharedCodeIntelTables(db);
      expect(state.tables.has('lgrep_shared_symbols')).toBe(true);
      expect(state.tables.has('lgrep_shared_dependencies')).toBe(true);
      expect(state.tables.has('lgrep_shared_calls')).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('deduplicates chunks with same content hash', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      await ensureSharedTables(db, 4);

      const chunks = [
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
      ];

      // Insert first time
      await addSharedChunks(db, 'test-model', chunks);
      expect(state.sharedChunks).toHaveLength(1);

      // Insert again with same content hash - should deduplicate
      await addSharedChunks(db, 'test-model', [
        {
          ...chunks[0]!,
          id: 'chunk-1-duplicate',
          filePath: '/project2/src/a.ts',
        },
      ]);
      expect(state.sharedChunks).toHaveLength(1);

      // Insert with different model - should NOT deduplicate
      await addSharedChunks(db, 'different-model', chunks);
      expect(state.sharedChunks).toHaveLength(2);
    } finally {
      await db.close();
    }
  });

  it('retrieves shared chunks by content hash', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      await ensureSharedTables(db, 4);

      await addSharedChunks(db, 'test-model', [
        {
          id: 'c1',
          filePath: '/p/a.ts',
          relativePath: 'a.ts',
          contentHash: 'hash-a',
          chunkIndex: 0,
          content: 'alpha',
          vector: new Float32Array([0.9, 0.1, 0.0, 0.0]),
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'c2',
          filePath: '/p/a.ts',
          relativePath: 'a.ts',
          contentHash: 'hash-a',
          chunkIndex: 1,
          content: 'alpha-part2',
          vector: new Float32Array([0.8, 0.2, 0.0, 0.0]),
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'c3',
          filePath: '/p/b.ts',
          relativePath: 'b.ts',
          contentHash: 'hash-b',
          chunkIndex: 0,
          content: 'beta',
          vector: new Float32Array([0.1, 0.9, 0.0, 0.0]),
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ]);

      const result = await getSharedChunksByHash(db, ['hash-a'], 'test-model');
      expect(result).toHaveLength(2);
      expect(result[0]?.content).toBe('alpha');
      expect(result[1]?.content).toBe('alpha-part2');

      const both = await getSharedChunksByHash(db, ['hash-a', 'hash-b'], 'test-model');
      expect(both).toHaveLength(3);
    } finally {
      await db.close();
    }
  });

  it('checks which content hashes exist', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      await ensureSharedTables(db, 4);

      await addSharedChunks(db, 'test-model', [
        {
          id: 'c1',
          filePath: '/p/a.ts',
          relativePath: 'a.ts',
          contentHash: 'hash-a',
          chunkIndex: 0,
          content: 'alpha',
          vector: new Float32Array([0.9, 0.1, 0.0, 0.0]),
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ]);

      const existing = await contentHashesExist(db, ['hash-a', 'hash-b', 'hash-c'], 'test-model');
      expect(existing).toEqual(new Set(['hash-a']));

      // Different model should return empty
      const otherModel = await contentHashesExist(db, ['hash-a'], 'other-model');
      expect(otherModel).toEqual(new Set());
    } finally {
      await db.close();
    }
  });

  it('performs vector search on shared chunks', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      await ensureSharedTables(db, 4);

      await addSharedChunks(db, 'test-model', [
        {
          id: 'c1',
          filePath: '/p/a.ts',
          relativePath: 'a.ts',
          contentHash: 'hash-a',
          chunkIndex: 0,
          content: 'alpha',
          vector: new Float32Array([0.9, 0.1, 0.0, 0.0]),
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'c2',
          filePath: '/p/b.ts',
          relativePath: 'b.ts',
          contentHash: 'hash-b',
          chunkIndex: 0,
          content: 'beta',
          vector: new Float32Array([0.1, 0.9, 0.0, 0.0]),
          fileType: '.ts',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ]);

      const results = await searchSharedChunks(
        db,
        new Float32Array([1.0, 0.0, 0.0, 0.0]),
        { limit: 1 }
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('alpha');
    } finally {
      await db.close();
    }
  });

  it('deduplicates shared symbols with ON CONFLICT', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      await ensureSharedCodeIntelTables(db);

      const symbol = {
        id: 'sym-1',
        name: 'myFunction',
        kind: 'function' as const,
        filePath: '/p/a.ts',
        relativePath: 'a.ts',
        range: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
        isExported: true,
        isDefaultExport: false,
        modifiers: [],
      };

      await addSharedSymbols(db, 'hash-a', [symbol]);
      expect(state.sharedSymbols).toHaveLength(1);

      // Duplicate insert should be ignored
      await addSharedSymbols(db, 'hash-a', [symbol]);
      expect(state.sharedSymbols).toHaveLength(1);

      // Different content hash should add new row
      await addSharedSymbols(db, 'hash-b', [symbol]);
      expect(state.sharedSymbols).toHaveLength(2);
    } finally {
      await db.close();
    }
  });

  it('retrieves shared symbols by content hash', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      await ensureSharedCodeIntelTables(db);

      await addSharedSymbols(db, 'hash-a', [
        {
          id: 'sym-1',
          name: 'funcA',
          kind: 'function',
          filePath: '/p/a.ts',
          relativePath: 'a.ts',
          range: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: ['async'],
        },
      ]);
      await addSharedSymbols(db, 'hash-b', [
        {
          id: 'sym-2',
          name: 'funcB',
          kind: 'function',
          filePath: '/p/b.ts',
          relativePath: 'b.ts',
          range: { start: { line: 10, column: 0 }, end: { line: 15, column: 1 } },
          isExported: false,
          isDefaultExport: false,
          modifiers: [],
        },
      ]);

      const result = await getSharedSymbolsByHash(db, ['hash-a']);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('funcA');
      expect(result[0]?.isExported).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('deduplicates shared dependencies and calls', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      await ensureSharedCodeIntelTables(db);

      const dep = {
        id: 'dep-1',
        sourceFile: '/p/a.ts',
        targetModule: './b',
        resolvedPath: '/p/b.ts',
        kind: 'import' as const,
        names: [{ name: 'foo', alias: undefined, isDefault: false, isNamespace: false }],
        line: 1,
        isExternal: false,
      };

      await addSharedDependencies(db, 'hash-a', [dep]);
      expect(state.sharedDependencies).toHaveLength(1);

      // Duplicate - should be ignored
      await addSharedDependencies(db, 'hash-a', [dep]);
      expect(state.sharedDependencies).toHaveLength(1);

      const call = {
        id: 'call-1',
        callerId: 'sym-1',
        callerFile: '/p/a.ts',
        calleeName: 'foo',
        calleeFile: '/p/b.ts',
        position: { line: 3, column: 4 },
        isMethodCall: false,
        argumentCount: 2,
      };

      await addSharedCalls(db, 'hash-a', [call]);
      expect(state.sharedCalls).toHaveLength(1);

      // Duplicate - should be ignored
      await addSharedCalls(db, 'hash-a', [call]);
      expect(state.sharedCalls).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  it('indexes same content from two worktrees with deduplication', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      await ensureSharedTables(db, 4);
      await ensureSharedCodeIntelTables(db);

      const sharedChunk = {
        id: 'c1',
        filePath: '/worktree-1/src/a.ts',
        relativePath: 'src/a.ts',
        contentHash: 'hash-shared',
        chunkIndex: 0,
        content: 'shared code',
        vector: new Float32Array([0.5, 0.5, 0.0, 0.0]),
        fileType: '.ts',
        createdAt: '2025-01-01T00:00:00.000Z',
      };

      // First worktree indexes the file
      await addSharedChunks(db, 'test-model', [sharedChunk]);
      expect(state.sharedChunks).toHaveLength(1);

      // Second worktree indexes the same file content (different path)
      await addSharedChunks(db, 'test-model', [
        { ...sharedChunk, id: 'c2', filePath: '/worktree-2/src/a.ts' },
      ]);
      // Should still be 1 because ON CONFLICT DO NOTHING
      expect(state.sharedChunks).toHaveLength(1);

      // Verify both can look up the shared chunk
      const existing = await contentHashesExist(db, ['hash-shared'], 'test-model');
      expect(existing.has('hash-shared')).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('returns empty results for non-postgres databases', async () => {
    // Test with a local mode database mock
    const db = {
      path: '/tmp/test',
      mode: 'local' as const,
      connection: null,
      pool: null,
      tableExistence: new Map(),
      close: async () => {},
    };

    // All shared functions should gracefully return empty for non-postgres
    await ensureSharedTables(db, 4); // no-op
    expect(await addSharedChunks(db, 'model', [])).toBe(0);
    expect(await getSharedChunksByHash(db, ['hash'])).toEqual([]);
    expect(await searchSharedChunks(db, new Float32Array([1, 0, 0, 0]), { limit: 10 })).toEqual([]);
    expect(await contentHashesExist(db, ['hash'], 'model')).toEqual(new Set());
  });
});
