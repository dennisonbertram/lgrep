import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openDatabase, type IndexDatabase } from './lance.js';
import type { CodeSymbol, CodeDependency, CallEdge } from '../types/code-intel.js';
import {
  addSymbols,
  getSymbols,
  searchSymbols,
  deleteSymbolsByFile,
  addDependencies,
  getDependencies,
  getDependencyGraph,
  deleteDependenciesByFile,
  addCalls,
  getCalls,
  getCallGraph,
  deleteCallsByFile,
  clearCodeIntel,
  getCodeIntelStats,
} from './code-intel.js';

describe('code-intel storage', () => {
  let testDir: string;
  let db: IndexDatabase;
  const indexName = 'test-index';

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-code-intel-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    db = await openDatabase(testDir);
  });

  afterEach(async () => {
    await db.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Symbols', () => {
    it('should add and retrieve symbols', async () => {
      const symbols: CodeSymbol[] = [
        {
          id: 'sym1',
          name: 'myFunction',
          kind: 'function',
          filePath: '/project/src/utils.ts',
          relativePath: 'src/utils.ts',
          range: {
            start: { line: 10, column: 0 },
            end: { line: 20, column: 1 },
          },
          isExported: true,
          isDefaultExport: false,
          modifiers: ['export'],
        },
      ];

      await addSymbols(db, indexName, symbols);

      const retrieved = await getSymbols(db, indexName);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]).toMatchObject({
        id: 'sym1',
        name: 'myFunction',
        kind: 'function',
        filePath: '/project/src/utils.ts',
        relativePath: 'src/utils.ts',
        isExported: true,
        isDefaultExport: false,
      });
      expect(retrieved[0].range.start.line).toBe(10);
      expect(retrieved[0].range.start.column).toBe(0);
      expect(retrieved[0].range.end.line).toBe(20);
      expect(retrieved[0].range.end.column).toBe(1);
      expect(retrieved[0].modifiers).toEqual(['export']);
    });

    it('should filter symbols by kind', async () => {
      const symbols: CodeSymbol[] = [
        {
          id: 'sym1',
          name: 'myFunction',
          kind: 'function',
          filePath: '/project/src/utils.ts',
          relativePath: 'src/utils.ts',
          range: { start: { line: 10, column: 0 }, end: { line: 20, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
        {
          id: 'sym2',
          name: 'MyClass',
          kind: 'class',
          filePath: '/project/src/utils.ts',
          relativePath: 'src/utils.ts',
          range: { start: { line: 30, column: 0 }, end: { line: 50, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
      ];

      await addSymbols(db, indexName, symbols);

      const functions = await getSymbols(db, indexName, { kind: 'function' });
      const classes = await getSymbols(db, indexName, { kind: 'class' });

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('myFunction');
      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('MyClass');
    });

    it('should filter symbols by file', async () => {
      const symbols: CodeSymbol[] = [
        {
          id: 'sym1',
          name: 'funcA',
          kind: 'function',
          filePath: '/project/src/a.ts',
          relativePath: 'src/a.ts',
          range: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
        {
          id: 'sym2',
          name: 'funcB',
          kind: 'function',
          filePath: '/project/src/b.ts',
          relativePath: 'src/b.ts',
          range: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
      ];

      await addSymbols(db, indexName, symbols);

      const aSymbols = await getSymbols(db, indexName, { file: '/project/src/a.ts' });

      expect(aSymbols).toHaveLength(1);
      expect(aSymbols[0].name).toBe('funcA');
    });

    it('should search symbols by name', async () => {
      const symbols: CodeSymbol[] = [
        {
          id: 'sym1',
          name: 'calculateTotal',
          kind: 'function',
          filePath: '/project/src/utils.ts',
          relativePath: 'src/utils.ts',
          range: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
        {
          id: 'sym2',
          name: 'calculateAverage',
          kind: 'function',
          filePath: '/project/src/utils.ts',
          relativePath: 'src/utils.ts',
          range: { start: { line: 5, column: 0 }, end: { line: 7, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
        {
          id: 'sym3',
          name: 'formatDate',
          kind: 'function',
          filePath: '/project/src/utils.ts',
          relativePath: 'src/utils.ts',
          range: { start: { line: 10, column: 0 }, end: { line: 12, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
      ];

      await addSymbols(db, indexName, symbols);

      const results = await searchSymbols(db, indexName, 'calculate');

      expect(results.length).toBeGreaterThanOrEqual(2);
      const names = results.map((s) => s.name);
      expect(names).toContain('calculateTotal');
      expect(names).toContain('calculateAverage');
    });

    it('should delete symbols by file', async () => {
      const symbols: CodeSymbol[] = [
        {
          id: 'sym1',
          name: 'funcA',
          kind: 'function',
          filePath: '/project/src/a.ts',
          relativePath: 'src/a.ts',
          range: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
        {
          id: 'sym2',
          name: 'funcB',
          kind: 'function',
          filePath: '/project/src/b.ts',
          relativePath: 'src/b.ts',
          range: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
      ];

      await addSymbols(db, indexName, symbols);
      await deleteSymbolsByFile(db, indexName, '/project/src/a.ts');

      const remaining = await getSymbols(db, indexName);

      expect(remaining).toHaveLength(1);
      expect(remaining[0].name).toBe('funcB');
    });
  });

  describe('Dependencies', () => {
    it('should add and retrieve dependencies', async () => {
      const deps: CodeDependency[] = [
        {
          id: 'dep1',
          sourceFile: '/project/src/index.ts',
          targetModule: './utils',
          resolvedPath: '/project/src/utils.ts',
          kind: 'import',
          names: [{ name: 'helper' }],
          line: 1,
          isExternal: false,
        },
      ];

      await addDependencies(db, indexName, deps);

      const retrieved = await getDependencies(db, indexName);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]).toMatchObject({
        id: 'dep1',
        sourceFile: '/project/src/index.ts',
        targetModule: './utils',
        resolvedPath: '/project/src/utils.ts',
        kind: 'import',
        line: 1,
        isExternal: false,
      });
      expect(retrieved[0].names).toEqual([{ name: 'helper' }]);
    });

    it('should filter dependencies by file', async () => {
      const deps: CodeDependency[] = [
        {
          id: 'dep1',
          sourceFile: '/project/src/a.ts',
          targetModule: './utils',
          kind: 'import',
          names: [],
          line: 1,
          isExternal: false,
        },
        {
          id: 'dep2',
          sourceFile: '/project/src/b.ts',
          targetModule: './helper',
          kind: 'import',
          names: [],
          line: 1,
          isExternal: false,
        },
      ];

      await addDependencies(db, indexName, deps);

      const aDeps = await getDependencies(db, indexName, { file: '/project/src/a.ts' });

      expect(aDeps).toHaveLength(1);
      expect(aDeps[0].sourceFile).toBe('/project/src/a.ts');
    });

    it('should filter external vs local dependencies', async () => {
      const deps: CodeDependency[] = [
        {
          id: 'dep1',
          sourceFile: '/project/src/index.ts',
          targetModule: 'react',
          kind: 'import',
          names: [],
          line: 1,
          isExternal: true,
        },
        {
          id: 'dep2',
          sourceFile: '/project/src/index.ts',
          targetModule: './utils',
          kind: 'import',
          names: [],
          line: 2,
          isExternal: false,
        },
      ];

      await addDependencies(db, indexName, deps);

      const external = await getDependencies(db, indexName, { external: true });
      const local = await getDependencies(db, indexName, { external: false });

      expect(external).toHaveLength(1);
      expect(external[0].targetModule).toBe('react');
      expect(local).toHaveLength(1);
      expect(local[0].targetModule).toBe('./utils');
    });

    it('should build dependency graph', async () => {
      const deps: CodeDependency[] = [
        {
          id: 'dep1',
          sourceFile: '/project/src/a.ts',
          targetModule: '/project/src/b.ts',
          kind: 'import',
          names: [],
          line: 1,
          isExternal: false,
        },
        {
          id: 'dep2',
          sourceFile: '/project/src/b.ts',
          targetModule: '/project/src/c.ts',
          kind: 'import',
          names: [],
          line: 1,
          isExternal: false,
        },
      ];

      await addDependencies(db, indexName, deps);

      const graph = await getDependencyGraph(db, indexName);

      expect(graph.imports.get('/project/src/a.ts')).toEqual(['/project/src/b.ts']);
      expect(graph.imports.get('/project/src/b.ts')).toEqual(['/project/src/c.ts']);
      expect(graph.importedBy.get('/project/src/b.ts')).toEqual(['/project/src/a.ts']);
      expect(graph.importedBy.get('/project/src/c.ts')).toEqual(['/project/src/b.ts']);
    });

    it('should delete dependencies by file', async () => {
      const deps: CodeDependency[] = [
        {
          id: 'dep1',
          sourceFile: '/project/src/a.ts',
          targetModule: './utils',
          kind: 'import',
          names: [],
          line: 1,
          isExternal: false,
        },
        {
          id: 'dep2',
          sourceFile: '/project/src/b.ts',
          targetModule: './helper',
          kind: 'import',
          names: [],
          line: 1,
          isExternal: false,
        },
      ];

      await addDependencies(db, indexName, deps);
      await deleteDependenciesByFile(db, indexName, '/project/src/a.ts');

      const remaining = await getDependencies(db, indexName);

      expect(remaining).toHaveLength(1);
      expect(remaining[0].sourceFile).toBe('/project/src/b.ts');
    });
  });

  describe('Calls', () => {
    it('should add and retrieve calls', async () => {
      const calls: CallEdge[] = [
        {
          id: 'call1',
          callerId: 'sym1',
          callerFile: '/project/src/index.ts',
          calleeName: 'helper',
          calleeId: 'sym2',
          calleeFile: '/project/src/utils.ts',
          position: { line: 10, column: 5 },
          isMethodCall: false,
          argumentCount: 2,
        },
      ];

      await addCalls(db, indexName, calls);

      const retrieved = await getCalls(db, indexName);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]).toMatchObject({
        id: 'call1',
        callerId: 'sym1',
        callerFile: '/project/src/index.ts',
        calleeName: 'helper',
        calleeId: 'sym2',
        calleeFile: '/project/src/utils.ts',
        isMethodCall: false,
        argumentCount: 2,
      });
      expect(retrieved[0].position.line).toBe(10);
      expect(retrieved[0].position.column).toBe(5);
    });

    it('should filter calls by caller', async () => {
      const calls: CallEdge[] = [
        {
          id: 'call1',
          callerId: 'symA',
          callerFile: '/project/src/a.ts',
          calleeName: 'helper',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
        {
          id: 'call2',
          callerId: 'symB',
          callerFile: '/project/src/b.ts',
          calleeName: 'utils',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
      ];

      await addCalls(db, indexName, calls);

      const callsFromA = await getCalls(db, indexName, { caller: 'symA' });

      expect(callsFromA).toHaveLength(1);
      expect(callsFromA[0].callerId).toBe('symA');
    });

    it('should filter calls by callee', async () => {
      const calls: CallEdge[] = [
        {
          id: 'call1',
          callerId: 'symA',
          callerFile: '/project/src/a.ts',
          calleeName: 'helper',
          calleeId: 'symHelper',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
        {
          id: 'call2',
          callerId: 'symB',
          callerFile: '/project/src/b.ts',
          calleeName: 'utils',
          calleeId: 'symUtils',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
      ];

      await addCalls(db, indexName, calls);

      const callsToHelper = await getCalls(db, indexName, { callee: 'symHelper' });

      expect(callsToHelper).toHaveLength(1);
      expect(callsToHelper[0].calleeId).toBe('symHelper');
    });

    it('should build call graph', async () => {
      const calls: CallEdge[] = [
        {
          id: 'call1',
          callerId: 'symA',
          callerFile: '/project/src/a.ts',
          calleeName: 'funcB',
          calleeId: 'symB',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
        {
          id: 'call2',
          callerId: 'symB',
          callerFile: '/project/src/b.ts',
          calleeName: 'funcC',
          calleeId: 'symC',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
      ];

      await addCalls(db, indexName, calls);

      const graph = await getCallGraph(db, indexName);

      expect(graph.calls.get('symA')).toEqual(['symB']);
      expect(graph.calls.get('symB')).toEqual(['symC']);
      expect(graph.calledBy.get('symB')).toEqual(['symA']);
      expect(graph.calledBy.get('symC')).toEqual(['symB']);
    });

    it('should delete calls by file', async () => {
      const calls: CallEdge[] = [
        {
          id: 'call1',
          callerFile: '/project/src/a.ts',
          calleeName: 'helper',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
        {
          id: 'call2',
          callerFile: '/project/src/b.ts',
          calleeName: 'utils',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
      ];

      await addCalls(db, indexName, calls);
      await deleteCallsByFile(db, indexName, '/project/src/a.ts');

      const remaining = await getCalls(db, indexName);

      expect(remaining).toHaveLength(1);
      expect(remaining[0].callerFile).toBe('/project/src/b.ts');
    });
  });

  describe('Utilities', () => {
    it('should clear all code intel data', async () => {
      const symbols: CodeSymbol[] = [
        {
          id: 'sym1',
          name: 'test',
          kind: 'function',
          filePath: '/project/src/test.ts',
          relativePath: 'src/test.ts',
          range: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
      ];
      const deps: CodeDependency[] = [
        {
          id: 'dep1',
          sourceFile: '/project/src/test.ts',
          targetModule: './utils',
          kind: 'import',
          names: [],
          line: 1,
          isExternal: false,
        },
      ];
      const calls: CallEdge[] = [
        {
          id: 'call1',
          callerFile: '/project/src/test.ts',
          calleeName: 'helper',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
      ];

      await addSymbols(db, indexName, symbols);
      await addDependencies(db, indexName, deps);
      await addCalls(db, indexName, calls);

      await clearCodeIntel(db, indexName);

      const remainingSymbols = await getSymbols(db, indexName);
      const remainingDeps = await getDependencies(db, indexName);
      const remainingCalls = await getCalls(db, indexName);

      expect(remainingSymbols).toHaveLength(0);
      expect(remainingDeps).toHaveLength(0);
      expect(remainingCalls).toHaveLength(0);
    });

    it('should get stats about code intel data', async () => {
      const symbols: CodeSymbol[] = [
        {
          id: 'sym1',
          name: 'func1',
          kind: 'function',
          filePath: '/project/src/a.ts',
          relativePath: 'src/a.ts',
          range: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
        {
          id: 'sym2',
          name: 'func2',
          kind: 'function',
          filePath: '/project/src/a.ts',
          relativePath: 'src/a.ts',
          range: { start: { line: 3, column: 0 }, end: { line: 4, column: 1 } },
          isExported: true,
          isDefaultExport: false,
          modifiers: [],
        },
      ];
      const deps: CodeDependency[] = [
        {
          id: 'dep1',
          sourceFile: '/project/src/a.ts',
          targetModule: './b',
          kind: 'import',
          names: [],
          line: 1,
          isExternal: false,
        },
      ];
      const calls: CallEdge[] = [
        {
          id: 'call1',
          callerFile: '/project/src/a.ts',
          calleeName: 'helper',
          position: { line: 1, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
        {
          id: 'call2',
          callerFile: '/project/src/a.ts',
          calleeName: 'utils',
          position: { line: 2, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
        {
          id: 'call3',
          callerFile: '/project/src/a.ts',
          calleeName: 'format',
          position: { line: 3, column: 0 },
          isMethodCall: false,
          argumentCount: 0,
        },
      ];

      await addSymbols(db, indexName, symbols);
      await addDependencies(db, indexName, deps);
      await addCalls(db, indexName, calls);

      const stats = await getCodeIntelStats(db, indexName);

      expect(stats.symbols).toBe(2);
      expect(stats.dependencies).toBe(1);
      expect(stats.calls).toBe(3);
    });
  });
});
