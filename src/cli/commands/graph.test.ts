import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, buildFileCallGraph } from './graph.js';
import type { CodeDependency, CallEdge } from '../../types/code-intel.js';

describe('graph command helpers', () => {
  it('buildDependencyGraph excludes external deps by default', () => {
    const deps: CodeDependency[] = [
      {
        id: '1',
        sourceFile: '/repo/src/a.ts',
        targetModule: './b',
        resolvedPath: '/repo/src/b.ts',
        kind: 'import',
        names: [],
        line: 1,
        isExternal: false,
      },
      {
        id: '2',
        sourceFile: '/repo/src/a.ts',
        targetModule: 'react',
        resolvedPath: undefined,
        kind: 'import',
        names: [],
        line: 2,
        isExternal: true,
      },
    ];

    const graph = buildDependencyGraph('idx', deps, false);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['/repo/src/a.ts', '/repo/src/b.ts'].sort());
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.kind).toBe('import');
  });

  it('buildDependencyGraph includes external deps when enabled', () => {
    const deps: CodeDependency[] = [
      {
        id: '1',
        sourceFile: '/repo/src/a.ts',
        targetModule: 'react',
        resolvedPath: undefined,
        kind: 'import',
        names: [],
        line: 2,
        isExternal: true,
      },
    ];

    const graph = buildDependencyGraph('idx', deps, true);
    expect(graph.nodes.map((n) => n.id)).toContain('/repo/src/a.ts');
    expect(graph.nodes.map((n) => n.id)).toContain('react');
    expect(graph.edges).toHaveLength(1);
  });

  it('buildFileCallGraph aggregates repeated edges', () => {
    const calls: CallEdge[] = [
      {
        id: 'c1',
        callerId: 's1',
        callerFile: '/repo/src/a.ts',
        calleeName: 'b',
        calleeId: 's2',
        calleeFile: '/repo/src/b.ts',
        position: { line: 1, column: 1 },
        isMethodCall: false,
        receiver: undefined,
        argumentCount: 1,
      },
      {
        id: 'c2',
        callerId: 's1',
        callerFile: '/repo/src/a.ts',
        calleeName: 'b',
        calleeId: 's2',
        calleeFile: '/repo/src/b.ts',
        position: { line: 2, column: 1 },
        isMethodCall: false,
        receiver: undefined,
        argumentCount: 1,
      },
    ];

    const graph = buildFileCallGraph('idx', calls);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.count).toBe(2);
  });
});

