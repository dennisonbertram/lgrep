import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallEdge, CodeDependency, CodeSymbol } from '../types/code-intel.js';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: new Set<string>(),
  symbols: new Map<string, Map<string, Row>>(),
  dependencies: new Map<string, Map<string, Row>>(),
  calls: new Map<string, Map<string, Row>>(),
  queries: [] as string[],
}));

function extractQuotedIdentifier(sql: string): string {
  const match = sql.match(/"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error(`Unable to extract identifier from SQL: ${sql}`);
  }
  return match[1];
}

function getTable(
  storage: Map<string, Map<string, Row>>,
  tableName: string
): Map<string, Row> {
  let table = storage.get(tableName);
  if (!table) {
    table = new Map<string, Row>();
    storage.set(tableName, table);
  }
  state.tables.add(tableName);
  return table;
}

function clearState(): void {
  state.tables.clear();
  state.symbols.clear();
  state.dependencies.clear();
  state.calls.clear();
  state.queries.length = 0;
}

vi.mock('pg', () => {
  class MockPool {
    async query(sql: string, params: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      state.queries.push(normalized);

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

      if (normalized.startsWith('INSERT INTO "lgrep_indexes"')) {
        state.tables.add('lgrep_indexes');
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_symbols_')) {
        getTable(state.symbols, extractQuotedIdentifier(normalized));
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_dependencies_')) {
        getTable(state.dependencies, extractQuotedIdentifier(normalized));
        return { rows: [] };
      }

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "lgrep_calls_')) {
        getTable(state.calls, extractQuotedIdentifier(normalized));
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO "lgrep_symbols_')) {
        const table = getTable(state.symbols, extractQuotedIdentifier(normalized));
        for (let index = 0; index < params.length; index += 21) {
          table.set(params[index] as string, {
            id: params[index],
            name: params[index + 1],
            kind: params[index + 2],
            file_path: params[index + 3],
            relative_path: params[index + 4],
            line_start: params[index + 5],
            line_end: params[index + 6],
            column_start: params[index + 7],
            column_end: params[index + 8],
            is_exported: params[index + 9],
            is_default_export: params[index + 10],
            documentation: params[index + 11],
            signature: params[index + 12],
            parent_id: params[index + 13],
            modifiers: params[index + 14],
            summary: params[index + 15],
            summary_model: params[index + 16],
            summary_generated_at: params[index + 17],
            body_hash: params[index + 18],
            index_name: params[index + 19],
            created_at: params[index + 20],
          });
        }
        return { rows: [] };
      }

      if (normalized.startsWith('SELECT * FROM "lgrep_symbols_')) {
        const table = getTable(state.symbols, extractQuotedIdentifier(normalized));
        let rows = [...table.values()];

        if (normalized.includes('WHERE LOWER(name) LIKE $1')) {
          const query = String(params[0] ?? '').toLowerCase().replaceAll('%', '');
          rows = rows.filter((row) => String(row.name).toLowerCase().includes(query));
        } else if (normalized.includes("WHERE summary = '' OR summary IS NULL")) {
          rows = rows.filter((row) => !row.summary);
        } else {
          let paramIndex = 0;
          if (normalized.includes('kind = $1')) {
            rows = rows.filter((row) => row.kind === params[paramIndex]);
            paramIndex += 1;
          }
          if (normalized.includes('file_path = $')) {
            rows = rows.filter((row) => row.file_path === params[paramIndex]);
          }
        }

        return { rows };
      }

      if (normalized.startsWith('DELETE FROM "lgrep_symbols_')) {
        const table = getTable(state.symbols, extractQuotedIdentifier(normalized));
        for (const [id, row] of table.entries()) {
          if (row.file_path === params[0]) {
            table.delete(id);
          }
        }
        return { rows: [] };
      }

      if (normalized.startsWith('UPDATE "lgrep_symbols_')) {
        const table = getTable(state.symbols, extractQuotedIdentifier(normalized));
        const symbol = table.get(params[3] as string);
        if (!symbol) {
          return { rows: [], rowCount: 0 };
        }
        symbol.summary = params[0];
        symbol.summary_model = params[1];
        symbol.summary_generated_at = params[2];
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith('INSERT INTO "lgrep_dependencies_')) {
        const table = getTable(state.dependencies, extractQuotedIdentifier(normalized));
        for (let index = 0; index < params.length; index += 10) {
          table.set(params[index] as string, {
            id: params[index],
            source_file: params[index + 1],
            target_module: params[index + 2],
            resolved_path: params[index + 3],
            kind: params[index + 4],
            names: params[index + 5],
            line: params[index + 6],
            is_external: params[index + 7],
            index_name: params[index + 8],
            created_at: params[index + 9],
          });
        }
        return { rows: [] };
      }

      if (normalized.startsWith('SELECT * FROM "lgrep_dependencies_')) {
        const table = getTable(state.dependencies, extractQuotedIdentifier(normalized));
        let rows = [...table.values()];
        let paramIndex = 0;

        if (normalized.includes('source_file = $1')) {
          rows = rows.filter((row) => row.source_file === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalized.includes('is_external = $')) {
          rows = rows.filter((row) => row.is_external === params[paramIndex]);
        }

        return { rows };
      }

      if (normalized.startsWith('DELETE FROM "lgrep_dependencies_')) {
        const table = getTable(state.dependencies, extractQuotedIdentifier(normalized));
        for (const [id, row] of table.entries()) {
          if (row.source_file === params[0]) {
            table.delete(id);
          }
        }
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO "lgrep_calls_')) {
        const table = getTable(state.calls, extractQuotedIdentifier(normalized));
        for (let index = 0; index < params.length; index += 13) {
          table.set(params[index] as string, {
            id: params[index],
            caller_id: params[index + 1],
            caller_file: params[index + 2],
            callee_name: params[index + 3],
            callee_id: params[index + 4],
            callee_file: params[index + 5],
            line: params[index + 6],
            column: params[index + 7],
            is_method_call: params[index + 8],
            receiver: params[index + 9],
            argument_count: params[index + 10],
            index_name: params[index + 11],
            created_at: params[index + 12],
          });
        }
        return { rows: [] };
      }

      if (normalized.startsWith('SELECT * FROM "lgrep_calls_')) {
        const table = getTable(state.calls, extractQuotedIdentifier(normalized));
        let rows = [...table.values()];
        let paramIndex = 0;

        if (normalized.includes('caller_id = $1')) {
          rows = rows.filter((row) => row.caller_id === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalized.includes('callee_id = $')) {
          rows = rows.filter((row) => row.callee_id === params[paramIndex]);
        }

        return { rows };
      }

      if (normalized.startsWith('DELETE FROM "lgrep_calls_')) {
        const table = getTable(state.calls, extractQuotedIdentifier(normalized));
        for (const [id, row] of table.entries()) {
          if (row.caller_file === params[0]) {
            table.delete(id);
          }
        }
        return { rows: [] };
      }

      if (normalized.startsWith('DROP TABLE IF EXISTS "')) {
        const tableName = extractQuotedIdentifier(normalized);
        state.tables.delete(tableName);
        state.symbols.delete(tableName);
        state.dependencies.delete(tableName);
        state.calls.delete(tableName);
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

import { openDatabase } from './lance.js';
import {
  addCalls,
  addDependencies,
  addSymbols,
  clearCodeIntel,
  createCodeIntelTables,
  deleteCallsByFile,
  deleteDependenciesByFile,
  deleteSymbolsByFile,
  getCallGraph,
  getCalls,
  getCodeIntelStats,
  getDependencies,
  getDependencyGraph,
  getSymbols,
  getSymbolsWithoutSummaries,
  searchSymbols,
  updateSymbolSummary,
} from './code-intel.js';

describe('code-intel postgres backend', () => {
  beforeEach(() => {
    clearState();
  });

  afterEach(() => {
    clearState();
  });

  it('stores and queries symbols, dependencies, and calls in postgres', async () => {
    const db = await openDatabase({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep',
    });

    try {
      const indexName = 'postgres-code-intel';
      await createCodeIntelTables(db, indexName);
      expect(
        state.queries.some((sql) =>
          sql.includes('CREATE TABLE IF NOT EXISTS "lgrep_calls_') && sql.includes('"column" INTEGER NOT NULL')
        )
      ).toBe(true);

      const symbols: CodeSymbol[] = [
        {
          id: 'sym-1',
          name: 'calculateTotal',
          kind: 'function',
          filePath: '/project/src/a.ts',
          relativePath: 'src/a.ts',
          range: {
            start: { line: 1, column: 0 },
            end: { line: 10, column: 1 },
          },
          isExported: true,
          isDefaultExport: false,
          modifiers: ['export'],
          bodyHash: 'hash-a',
        },
        {
          id: 'sym-2',
          name: 'formatTotal',
          kind: 'function',
          filePath: '/project/src/b.ts',
          relativePath: 'src/b.ts',
          range: {
            start: { line: 1, column: 0 },
            end: { line: 5, column: 1 },
          },
          isExported: false,
          isDefaultExport: false,
          modifiers: [],
        },
      ];

      const dependencies: CodeDependency[] = [
        {
          id: 'dep-1',
          sourceFile: '/project/src/a.ts',
          targetModule: './b',
          resolvedPath: '/project/src/b.ts',
          kind: 'import',
          names: [{ name: 'formatTotal' }],
          line: 1,
          isExternal: false,
        },
      ];

      const calls: CallEdge[] = [
        {
          id: 'call-1',
          callerId: 'sym-1',
          callerFile: '/project/src/a.ts',
          calleeName: 'formatTotal',
          calleeId: 'sym-2',
          calleeFile: '/project/src/b.ts',
          position: { line: 8, column: 2 },
          isMethodCall: false,
          argumentCount: 1,
        },
      ];

      await addSymbols(db, indexName, symbols);
      await addDependencies(db, indexName, dependencies);
      await addCalls(db, indexName, calls);
      expect(
        state.queries.some((sql) =>
          sql.includes('INSERT INTO "lgrep_calls_') && sql.includes('"column"')
        )
      ).toBe(true);

      expect((await getSymbols(db, indexName)).map((symbol) => symbol.name)).toEqual([
        'calculateTotal',
        'formatTotal',
      ]);
      expect((await searchSymbols(db, indexName, 'total')).map((symbol) => symbol.name)).toEqual([
        'calculateTotal',
        'formatTotal',
      ]);
      expect((await getDependencies(db, indexName))[0]?.resolvedPath).toBe('/project/src/b.ts');
      expect((await getCalls(db, indexName))[0]?.calleeId).toBe('sym-2');

      const depGraph = await getDependencyGraph(db, indexName);
      expect(depGraph.imports.get('/project/src/a.ts')).toEqual(['./b']);

      const callGraph = await getCallGraph(db, indexName);
      expect(callGraph.calls.get('sym-1')).toEqual(['sym-2']);

      await updateSymbolSummary(db, indexName, 'sym-1', 'Summarizes totals.', 'gpt-4o-mini');
      expect((await getSymbols(db, indexName, { file: '/project/src/a.ts' }))[0]?.summary).toBe(
        'Summarizes totals.'
      );
      expect((await getSymbolsWithoutSummaries(db, indexName)).map((symbol) => symbol.id)).toEqual([
        'sym-2',
      ]);

      expect(await getCodeIntelStats(db, indexName)).toEqual({
        symbols: 2,
        dependencies: 1,
        calls: 1,
      });

      await deleteSymbolsByFile(db, indexName, '/project/src/b.ts');
      await deleteDependenciesByFile(db, indexName, '/project/src/a.ts');
      await deleteCallsByFile(db, indexName, '/project/src/a.ts');

      expect((await getSymbols(db, indexName)).map((symbol) => symbol.id)).toEqual(['sym-1']);
      expect(await getDependencies(db, indexName)).toEqual([]);
      expect(await getCalls(db, indexName)).toEqual([]);

      await clearCodeIntel(db, indexName);

      expect(await getSymbols(db, indexName)).toEqual([]);
      expect(await getDependencies(db, indexName)).toEqual([]);
      expect(await getCalls(db, indexName)).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
