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

import { runSearchCommand, type SearchOptions } from './search.js';
import { runIndexCommand, type IndexOptions } from './index.js';
import { runListCommand } from './list.js';
import { runDeleteCommand } from './delete.js';
import { runConfigCommand } from './config.js';

/**
 * Extended options with json flag
 */
interface JsonOptions {
  json?: boolean;
}

describe('JSON flag integration', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-json-integration-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    await writeFile(join(sourceDir, 'test.ts'), 'function test() {}');
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('search command with --json flag', () => {
    it('should accept --json flag in SearchOptions', async () => {
      // First create an index
      await runIndexCommand(sourceDir, { name: 'test-index' });

      // This test verifies the type accepts json option
      const options: SearchOptions & JsonOptions = {
        index: 'test-index',
        json: true,
      };

      const result = await runSearchCommand('test', options);
      expect(result).toBeDefined();
    });

    it('should accept -j short flag in SearchOptions', async () => {
      await runIndexCommand(sourceDir, { name: 'test-index' });

      const options: SearchOptions & JsonOptions = {
        index: 'test-index',
        json: true, // -j would be parsed to json: true by commander
      };

      const result = await runSearchCommand('test', options);
      expect(result).toBeDefined();
    });
  });

  describe('index command with --json flag', () => {
    it('should accept --json flag in IndexOptions', async () => {
      const options: IndexOptions & JsonOptions = {
        name: 'test-index',
        json: true,
      };

      const result = await runIndexCommand(sourceDir, options);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should accept -j short flag in IndexOptions', async () => {
      const options: IndexOptions & JsonOptions = {
        name: 'test-index-2',
        json: true,
      };

      const result = await runIndexCommand(sourceDir, options);
      expect(result).toBeDefined();
    });
  });

  describe('list command with --json flag', () => {
    it('should accept json flag parameter', async () => {
      // runListCommand should accept optional json parameter
      const output = await runListCommand(true);
      expect(output).toBeDefined();
    });

    it('should work without json flag', async () => {
      const output = await runListCommand();
      expect(output).toBeDefined();
    });
  });

  describe('delete command with --json flag', () => {
    it('should accept json flag in options', async () => {
      // First create an index
      await runIndexCommand(sourceDir, { name: 'test-index' });

      const options = { json: true };
      const output = await runDeleteCommand('test-index', options);
      expect(output).toBeDefined();
    });
  });

  describe('config command with --json flag', () => {
    it('should accept json flag parameter', async () => {
      const output = await runConfigCommand(undefined, undefined, true);
      expect(output).toBeDefined();
    });

    it('should accept json flag when getting a key', async () => {
      const output = await runConfigCommand('model', undefined, true);
      expect(output).toBeDefined();
    });

    it('should accept json flag when setting a key', async () => {
      const output = await runConfigCommand('model', 'test-model', true);
      expect(output).toBeDefined();
    });
  });
});

describe('JSON output content validation', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-json-content-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    await writeFile(join(sourceDir, 'test.ts'), 'function test() {}');
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('list command JSON output', () => {
    it('should return valid JSON when json flag is true', async () => {
      // Create an index first
      await runIndexCommand(sourceDir, { name: 'json-test' });

      const output = await runListCommand(true);

      // Should be valid JSON
      expect(() => JSON.parse(output)).not.toThrow();

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('indexes');
      expect(Array.isArray(parsed.indexes)).toBe(true);
    });

    it('should return text when json flag is false', async () => {
      await runIndexCommand(sourceDir, { name: 'text-test' });

      const output = await runListCommand(false);

      // Should contain text indicators
      expect(output).toContain('Indexes:');
    });
  });

  describe('config command JSON output', () => {
    it('should return valid JSON when json flag is true', async () => {
      const output = await runConfigCommand(undefined, undefined, true);

      expect(() => JSON.parse(output)).not.toThrow();

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('config');
    });

    it('should return text when json flag is false', async () => {
      const output = await runConfigCommand(undefined, undefined, false);

      // Should contain text format
      expect(output).toContain(':');
    });
  });

  describe('delete command JSON output', () => {
    it('should return valid JSON when json flag is true', async () => {
      await runIndexCommand(sourceDir, { name: 'delete-test' });

      const output = await runDeleteCommand('delete-test', { json: true });

      expect(() => JSON.parse(output)).not.toThrow();

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('deleted');
      expect(parsed).toHaveProperty('success');
    });
  });
});
