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

import { runCallersCommand, type CallersOptions } from './callers.js';
import { runIndexCommand } from './index.js';
import { runAnalyzeCommand } from './analyze.js';

describe('callers command', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-callers-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    // Create test files with function calls
    await writeFile(
      join(sourceDir, 'auth.ts'),
      `function validateUser(user: string) { return user.length > 0; }
export function checkAuth() { return validateUser('test'); }
export function handleLogin() { validateUser('admin'); return true; }`
    );
    await writeFile(
      join(sourceDir, 'register.ts'),
      `import { validateUser } from './auth';
export function handleRegister(user: string) { validateUser(user); return true; }`
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
    it('should find all callers of a function', async () => {
      const result = await runCallersCommand('validateUser', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.symbol).toBe('validateUser');
      expect(result.callers).toBeDefined();
      expect(result.callers!.length).toBeGreaterThan(0);
    });

    it('should include file path and line number in results', async () => {
      const result = await runCallersCommand('validateUser', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.callers!.length).toBeGreaterThan(0);

      const firstCaller = result.callers![0];
      expect(firstCaller).toHaveProperty('file');
      expect(firstCaller).toHaveProperty('line');
      expect(typeof firstCaller.file).toBe('string');
      expect(typeof firstCaller.line).toBe('number');
    });

    it('should include caller function name when available', async () => {
      const result = await runCallersCommand('validateUser', { index: 'test-index' });

      expect(result.success).toBe(true);
      const callersWithNames = result.callers!.filter(c => c.callerName);
      expect(callersWithNames.length).toBeGreaterThan(0);
    });

    it('should return empty array for function with no callers', async () => {
      // Create a function that is never called
      await writeFile(
        join(sourceDir, 'unused.ts'),
        'function neverCalled() { return true; }'
      );
      await runAnalyzeCommand(sourceDir, { index: 'test-index' });

      const result = await runCallersCommand('neverCalled', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.callers).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should fail for non-existent index', async () => {
      await expect(
        runCallersCommand('someFunction', { index: 'nonexistent-index' })
      ).rejects.toThrow(/not found/i);
    });

    it('should return empty results for non-existent symbol', async () => {
      const result = await runCallersCommand('nonExistentFunction', { index: 'test-index' });

      expect(result.success).toBe(true);
      expect(result.callers).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  describe('json output', () => {
    it('should support json flag', async () => {
      const result = await runCallersCommand('validateUser', {
        index: 'test-index',
        json: true
      });

      expect(result.success).toBe(true);
      expect(result).toHaveProperty('symbol');
      expect(result).toHaveProperty('callers');
      expect(result).toHaveProperty('count');
      expect(result).toHaveProperty('indexName');
    });
  });

  describe('auto-detect index', () => {
    it('should fail when index is not specified and cannot be auto-detected', async () => {
      // Without changing to the source directory, auto-detect should fail
      await expect(
        runCallersCommand('validateUser')
      ).rejects.toThrow(/No index found/);
    });
  });
});
