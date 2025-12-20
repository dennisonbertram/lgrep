import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Mock the embeddings module before importing
vi.mock('../../core/embeddings.js', () => ({
  createEmbeddingClient: vi.fn().mockReturnValue({
    model: 'test-model',
    embed: vi.fn().mockImplementation(async (input: string | string[]) => {
      const texts = Array.isArray(input) ? input : [input];
      return {
        embeddings: texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        model: 'test-model',
      };
    }),
    embedQuery: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3, 0.4]],
      model: 'test-model',
    }),
    healthCheck: vi.fn().mockResolvedValue({ ok: true, model: 'test-model', dimensions: 4 }),
    getModelDimensions: vi.fn().mockResolvedValue(4),
  }),
}));

import { runDepsCommand, type DepsOptions } from './deps.js';
import { runIndexCommand } from './index.js';
import { runAnalyzeCommand } from './analyze.js';

describe('deps command', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-deps-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(join(sourceDir, 'auth'), { recursive: true });
    await mkdir(join(sourceDir, 'api'), { recursive: true });
    await mkdir(join(sourceDir, 'middleware'), { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    // Create test files with dependencies
    await writeFile(
      join(sourceDir, 'auth', 'index.ts'),
      `export function validateUser(user: string) { return user.length > 0; }
export function createSession() { return { id: 'session' }; }`
    );
    await writeFile(
      join(sourceDir, 'api', 'login.ts'),
      `import { validateUser, createSession } from '../auth';
export function handleLogin() { validateUser('test'); createSession(); }`
    );
    await writeFile(
      join(sourceDir, 'api', 'register.ts'),
      `import { validateUser } from '../auth';
export function handleRegister() { validateUser('user'); }`
    );
    await writeFile(
      join(sourceDir, 'middleware', 'auth.ts'),
      `import * as auth from '../auth';
export function checkAuth() { return auth.validateUser('test'); }`
    );

    // Create an index and analyze for code intelligence
    await runIndexCommand(sourceDir, { name: 'test-index' });
    await runAnalyzeCommand(sourceDir, { index: 'test-index' });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('successful queries', () => {
    it('should find all dependents of a module', async () => {
      const result = await runDepsCommand('../auth', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.module).toContain('auth');
      expect(result.dependents).toBeDefined();
      expect(result.dependents!.length).toBeGreaterThan(0);
    });

    it('should include file path and imported names in results', async () => {
      const result = await runDepsCommand('../auth', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.dependents!.length).toBeGreaterThan(0);

      const firstDependent = result.dependents![0];
      expect(firstDependent).toHaveProperty('file');
      expect(firstDependent).toHaveProperty('imports');
      expect(typeof firstDependent.file).toBe('string');
      expect(Array.isArray(firstDependent.imports)).toBe(true);
    });

    it('should show specific imported names', async () => {
      const result = await runDepsCommand('../auth', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.dependents!.length).toBeGreaterThan(0);
      const dependentWithImports = result.dependents!.find(d => d.imports.length > 0);
      expect(dependentWithImports).toBeDefined();
    });

    it('should handle namespace imports', async () => {
      const result = await runDepsCommand('../auth', { index: 'test-index' });

      expect(result.success).toBe(true);
      // Should find import from middleware/auth.ts (import * as auth from '../auth')
      // Depending on how dependencies are stored, this might show as '*' or actual names
      const middlewareImport = result.dependents!.find(d =>
        d.file.includes('middleware')
      );
      expect(middlewareImport).toBeDefined();
      expect(middlewareImport!.imports.length).toBeGreaterThan(0);
    });

    it('should return empty array for module with no dependents', async () => {
      // Create a module that is never imported
      await writeFile(
        join(sourceDir, 'unused.ts'),
        'export function neverImported() { return true; }'
      );
      await runAnalyzeCommand(sourceDir, { index: 'test-index' });

      const result = await runDepsCommand('unused.ts', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.dependents).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should fail for non-existent index', async () => {
      await expect(
        runDepsCommand('some/module.ts', { index: 'nonexistent-index' })
      ).rejects.toThrow(/not found/i);
    });

    it('should return empty results for non-existent module', async () => {
      const result = await runDepsCommand('nonexistent/module.ts', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.dependents).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  describe('json output', () => {
    it('should support json flag', async () => {
      const result = await runDepsCommand('auth/index.ts', {
        index: 'test-index',
        json: true
      });

      expect(result.success).toBe(true);
      expect(result).toHaveProperty('module');
      expect(result).toHaveProperty('dependents');
      expect(result).toHaveProperty('count');
      expect(result).toHaveProperty('indexName');
    });
  });

  describe('auto-detect index', () => {
    it('should fail when index is not specified and cannot be auto-detected', async () => {
      // Without changing to the source directory, auto-detect should fail
      await expect(
        runDepsCommand('auth/index.ts')
      ).rejects.toThrow(/No index found/);
    });
  });
});
