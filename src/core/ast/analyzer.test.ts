/**
 * Tests for AST analyzer
 */

import { describe, it, expect } from 'vitest';
import { analyzeFile, analyzeProject } from './analyzer.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('analyzeFile', () => {
  it('should analyze a TypeScript file and return FileAnalysis', async () => {
    // Create temp file
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));
    const testFile = join(tmpDir, 'test.ts');

    const code = `
export function hello(name: string): string {
  return \`Hello, \${name}\`;
}

export class Greeter {
  greet(name: string) {
    return hello(name);
  }
}
`;

    await writeFile(testFile, code);

    try {
      const result = await analyzeFile(testFile, tmpDir);

      // Should have correct file info
      expect(result.filePath).toBe(testFile);
      expect(result.extension).toBe('.ts');
      expect(result.contentHash).toBeTruthy();
      expect(result.analyzedAt).toBeTruthy();

      // Should extract symbols (hello function + Greeter class + greet method)
      expect(result.symbols.length).toBeGreaterThanOrEqual(2);
      expect(result.symbols.some(s => s.name === 'hello' && s.kind === 'function')).toBe(true);
      expect(result.symbols.some(s => s.name === 'Greeter' && s.kind === 'class')).toBe(true);

      // Should extract dependencies (none in this simple file)
      expect(Array.isArray(result.dependencies)).toBe(true);

      // Should extract calls
      expect(result.calls).toBeTruthy();
      expect(Array.isArray(result.calls)).toBe(true);

      // Should have no errors
      expect(result.errors).toEqual([]);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should handle files with imports', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));
    const testFile = join(tmpDir, 'test.ts');

    const code = `
import { readFile } from 'node:fs/promises';
import { join } from './utils';

export async function loadData(path: string) {
  const fullPath = join(path);
  return await readFile(fullPath, 'utf-8');
}
`;

    await writeFile(testFile, code);

    try {
      const result = await analyzeFile(testFile, tmpDir);

      // Should have dependencies
      expect(result.dependencies.length).toBeGreaterThan(0);

      // Should identify external vs local imports
      const externalDep = result.dependencies.find(d => d.targetModule === 'node:fs/promises');
      const localDep = result.dependencies.find(d => d.targetModule === './utils');

      expect(externalDep?.isExternal).toBe(true);
      expect(localDep?.isExternal).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should extract function calls', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));
    const testFile = join(tmpDir, 'test.ts');

    const code = `
function helper() {
  console.log('helper');
}

export function main() {
  helper();
  console.log('main');
}
`;

    await writeFile(testFile, code);

    try {
      const result = await analyzeFile(testFile, tmpDir);

      // Should have calls
      expect(result.calls.length).toBeGreaterThan(0);

      // Should have helper() call
      const helperCall = result.calls.find(c => c.calleeName === 'helper');
      expect(helperCall).toBeTruthy();
      expect(helperCall?.callerId).toContain('main');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should handle parse errors gracefully', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));
    const testFile = join(tmpDir, 'test.ts');

    const invalidCode = `
export function broken( {
  // Missing closing brace
`;

    await writeFile(testFile, invalidCode);

    try {
      const result = await analyzeFile(testFile, tmpDir);

      // Should still return a result
      expect(result).toBeTruthy();
      expect(result.filePath).toBe(testFile);

      // Symbols might be empty or partial
      expect(Array.isArray(result.symbols)).toBe(true);
      expect(Array.isArray(result.dependencies)).toBe(true);
      expect(Array.isArray(result.calls)).toBe(true);

      // May have errors
      expect(Array.isArray(result.errors)).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

describe('analyzeProject', () => {
  it('should analyze all files in a directory', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));

    // Create multiple files
    await writeFile(join(tmpDir, 'file1.ts'), 'export function fn1() {}');
    await writeFile(join(tmpDir, 'file2.ts'), 'export function fn2() {}');
    await writeFile(join(tmpDir, 'file3.js'), 'export function fn3() {}');

    try {
      const result = await analyzeProject(tmpDir);

      expect(result.success).toBe(true);
      expect(result.filesAnalyzed).toBe(3);

      // Should have stats
      expect(result.stats).toBeTruthy();
      expect(result.stats.totalSymbols).toBeGreaterThan(0);
      expect(result.stats.byKind).toBeTruthy();
      expect(result.stats.byKind.function).toBeGreaterThan(0);

      expect(result.errors).toEqual([]);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should filter results by --symbols option', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));

    await writeFile(join(tmpDir, 'test.ts'), 'export function hello() {}');

    try {
      const result = await analyzeProject(tmpDir, { symbols: true });

      expect(result.symbols).toBeTruthy();
      expect(result.symbols!.length).toBeGreaterThan(0);
      expect(result.symbols![0]!.name).toBe('hello');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should filter results by --deps option', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));

    await writeFile(join(tmpDir, 'test.ts'), "import { x } from './other';\nexport { x };");

    try {
      const result = await analyzeProject(tmpDir, { deps: true });

      expect(result.dependencies).toBeTruthy();
      expect(result.dependencies!.length).toBeGreaterThan(0);
      expect(result.stats.totalDependencies).toBeGreaterThan(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should filter results by --calls option', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));

    await writeFile(join(tmpDir, 'test.ts'), 'function a() {} function b() { a(); }');

    try {
      const result = await analyzeProject(tmpDir, { calls: true });

      expect(result.calls).toBeTruthy();
      expect(result.calls!.length).toBeGreaterThan(0);
      expect(result.stats.totalCalls).toBeGreaterThan(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should analyze single file when --file option is provided', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));

    await writeFile(join(tmpDir, 'target.ts'), 'export function target() {}');
    await writeFile(join(tmpDir, 'other.ts'), 'export function other() {}');

    try {
      const targetFile = join(tmpDir, 'target.ts');
      const result = await analyzeProject(tmpDir, { file: targetFile, symbols: true });

      expect(result.filesAnalyzed).toBe(1);
      expect(result.symbols).toBeTruthy();
      expect(result.symbols!.some(s => s.name === 'target')).toBe(true);
      expect(result.symbols!.some(s => s.name === 'other')).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should calculate stats by symbol kind', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'lgrep-test-'));

    const code = `
export function fn() {}
export class MyClass {}
export interface MyInterface {}
export type MyType = string;
`;

    await writeFile(join(tmpDir, 'test.ts'), code);

    try {
      const result = await analyzeProject(tmpDir);

      expect(result.stats.byKind.function).toBe(1);
      expect(result.stats.byKind.class).toBe(1);
      expect(result.stats.byKind.interface).toBe(1);
      expect(result.stats.byKind.type_alias).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should handle non-existent directory', async () => {
    const result = await analyzeProject('/nonexistent/path');

    expect(result.success).toBe(false);
    expect(result.filesAnalyzed).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
