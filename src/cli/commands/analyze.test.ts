/**
 * Tests for analyze CLI command
 */

import { describe, it, expect } from 'vitest';
import { runAnalyzeCommand } from './analyze.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('runAnalyzeCommand', () => {
  it('should analyze a directory and return results', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mgrep-test-'));

    await writeFile(join(tmpDir, 'test.ts'), 'export function hello() {}');

    try {
      const result = await runAnalyzeCommand(tmpDir, {});

      expect(result.success).toBe(true);
      expect(result.filesAnalyzed).toBe(1);
      expect(result.stats).toBeTruthy();
      expect(result.stats.totalSymbols).toBeGreaterThan(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should return symbols when --symbols flag is set', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mgrep-test-'));

    await writeFile(join(tmpDir, 'test.ts'), 'export function greet() {}');

    try {
      const result = await runAnalyzeCommand(tmpDir, { symbols: true });

      expect(result.symbols).toBeTruthy();
      expect(result.symbols!.length).toBeGreaterThan(0);
      expect(result.symbols![0]!.name).toBe('greet');
      expect(result.symbols![0]!.kind).toBe('function');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should return dependencies when --deps flag is set', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mgrep-test-'));

    await writeFile(
      join(tmpDir, 'test.ts'),
      "import { readFile } from 'node:fs/promises';\nexport { readFile };"
    );

    try {
      const result = await runAnalyzeCommand(tmpDir, { deps: true });

      expect(result.dependencies).toBeTruthy();
      expect(result.dependencies!.length).toBeGreaterThan(0);
      expect(result.stats.totalDependencies).toBeGreaterThan(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should return calls when --calls flag is set', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mgrep-test-'));

    await writeFile(
      join(tmpDir, 'test.ts'),
      'function helper() {} export function main() { helper(); }'
    );

    try {
      const result = await runAnalyzeCommand(tmpDir, { calls: true });

      expect(result.calls).toBeTruthy();
      expect(result.calls!.length).toBeGreaterThan(0);
      expect(result.stats.totalCalls).toBeGreaterThan(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should analyze single file when --file is provided', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mgrep-test-'));

    await writeFile(join(tmpDir, 'target.ts'), 'export function target() {}');
    await writeFile(join(tmpDir, 'other.ts'), 'export function other() {}');

    try {
      const targetFile = join(tmpDir, 'target.ts');
      const result = await runAnalyzeCommand(tmpDir, { file: targetFile });

      expect(result.filesAnalyzed).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should support --json flag', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mgrep-test-'));

    await writeFile(join(tmpDir, 'test.ts'), 'export function test() {}');

    try {
      const result = await runAnalyzeCommand(tmpDir, { json: true });

      // Result should be serializable to JSON
      const json = JSON.stringify(result);
      expect(json).toBeTruthy();

      const parsed = JSON.parse(json);
      expect(parsed.success).toBe(true);
      expect(parsed.filesAnalyzed).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('should handle non-existent path', async () => {
    const result = await runAnalyzeCommand('/nonexistent/path', {});

    expect(result.success).toBe(false);
    expect(result.filesAnalyzed).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should combine multiple flags', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mgrep-test-'));

    await writeFile(
      join(tmpDir, 'test.ts'),
      "import { x } from './y';\nfunction a() {} function b() { a(); }"
    );

    try {
      const result = await runAnalyzeCommand(tmpDir, {
        symbols: true,
        deps: true,
        calls: true,
      });

      expect(result.symbols).toBeTruthy();
      expect(result.dependencies).toBeTruthy();
      expect(result.calls).toBeTruthy();
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});
