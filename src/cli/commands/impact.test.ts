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

import { runImpactCommand, type ImpactOptions } from './impact.js';
import { runIndexCommand } from './index.js';
import { runAnalyzeCommand } from './analyze.js';

describe('impact command', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-impact-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(join(sourceDir, 'auth'), { recursive: true });
    await mkdir(join(sourceDir, 'api'), { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    // Create test files with transitive dependencies
    await writeFile(
      join(sourceDir, 'auth', 'validate.ts'),
      `export function validateUser(user: string) { return user.length > 0; }`
    );
    await writeFile(
      join(sourceDir, 'auth', 'middleware.ts'),
      `import { validateUser } from './validate';
export function checkAuth() { return validateUser('test'); }`
    );
    await writeFile(
      join(sourceDir, 'api', 'login.ts'),
      `import { checkAuth } from '../auth/middleware';
export function handleLogin() { return checkAuth(); }`
    );
    await writeFile(
      join(sourceDir, 'api', 'register.ts'),
      `import { validateUser } from '../auth/validate';
export function handleRegister() { return validateUser('user'); }`
    );
    await writeFile(
      join(sourceDir, 'api', 'index.ts'),
      `import { handleLogin } from './login';
import { handleRegister } from './register';
export { handleLogin, handleRegister };`
    );
    await writeFile(
      join(sourceDir, 'server.ts'),
      `import * as api from './api';
export function startServer() { return api; }`
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
    it('should find direct callers of a function', async () => {
      const result = await runImpactCommand('validateUser', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.symbol).toBe('validateUser');
      expect(result.directCallers).toBeDefined();
      expect(result.directCallers!.length).toBeGreaterThan(0);
    });

    it('should find transitive impact beyond direct callers', async () => {
      const result = await runImpactCommand('validateUser', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.transitiveFiles).toBeDefined();
      expect(result.totalFiles).toBeGreaterThanOrEqual(result.directCallers!.length);
    });

    it('should include file paths and line numbers for direct callers', async () => {
      const result = await runImpactCommand('validateUser', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.directCallers!.length).toBeGreaterThan(0);

      const firstCaller = result.directCallers![0];
      expect(firstCaller).toHaveProperty('file');
      expect(firstCaller).toHaveProperty('line');
      expect(typeof firstCaller.file).toBe('string');
      expect(typeof firstCaller.line).toBe('number');
    });

    it('should list transitive files affected', async () => {
      const result = await runImpactCommand('validateUser', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.transitiveFiles)).toBe(true);
    });

    it('should calculate total impacted files', async () => {
      const result = await runImpactCommand('validateUser', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBeGreaterThan(0);
      expect(typeof result.totalFiles).toBe('number');
    });

    it('should return minimal impact for function with no callers', async () => {
      await writeFile(
        join(sourceDir, 'unused.ts'),
        'function neverCalled() { return true; }'
      );
      await runAnalyzeCommand(sourceDir, { index: 'test-index' });

      const result = await runImpactCommand('neverCalled', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.directCallers).toEqual([]);
      expect(result.transitiveFiles).toEqual([]);
      expect(result.totalFiles).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should fail for non-existent index', async () => {
      await expect(
        runImpactCommand('someFunction', { index: 'nonexistent-index' })
      ).rejects.toThrow(/not found/i);
    });

    it('should return empty results for non-existent symbol', async () => {
      const result = await runImpactCommand('nonExistentFunction', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.directCallers).toEqual([]);
      expect(result.transitiveFiles).toEqual([]);
      expect(result.totalFiles).toBe(0);
    });
  });

  describe('json output', () => {
    it('should support json flag', async () => {
      const result = await runImpactCommand('validateUser', {
        index: 'test-index',
        json: true
      });

      expect(result.success).toBe(true);
      expect(result).toHaveProperty('symbol');
      expect(result).toHaveProperty('directCallers');
      expect(result).toHaveProperty('transitiveFiles');
      expect(result).toHaveProperty('totalFiles');
      expect(result).toHaveProperty('indexName');
    });
  });

  describe('auto-detect index', () => {
    it('should fail when index is not specified and cannot be auto-detected', async () => {
      // Without changing to the source directory, auto-detect should fail
      await expect(
        runImpactCommand('validateUser')
      ).rejects.toThrow(/No index found/);
    });
  });
});
