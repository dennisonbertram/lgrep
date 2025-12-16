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

import { runIndexCommand } from './index.js';

describe('index command - integration test', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-integration-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('should demonstrate full incremental indexing workflow', async () => {
    // Step 1: Create initial files
    await writeFile(join(sourceDir, 'file1.ts'), 'export const greeting = "hello";');
    await writeFile(join(sourceDir, 'file2.ts'), 'export const farewell = "goodbye";');
    await writeFile(join(sourceDir, 'file3.ts'), 'export const question = "how are you?";');

    // Step 2: Initial index
    const result1 = await runIndexCommand(sourceDir, { name: 'demo', showProgress: false });

    expect(result1.success).toBe(true);
    expect(result1.filesProcessed).toBe(3);
    expect(result1.chunksCreated).toBe(3);

    // Step 3: Reindex with no changes - everything should be skipped
    const result2 = await runIndexCommand(sourceDir, {
      name: 'demo',
      mode: 'update',
      showProgress: false,
    });

    expect(result2.success).toBe(true);
    expect(result2.filesSkipped).toBe(3);
    expect(result2.filesUpdated).toBe(0);
    expect(result2.filesAdded).toBe(0);
    expect(result2.filesDeleted).toBe(0);
    expect(result2.chunksCreated).toBe(0);

    // Step 4: Modify file1, add file4, delete file3
    await writeFile(join(sourceDir, 'file1.ts'), 'export const greeting = "HELLO WORLD";');
    await writeFile(join(sourceDir, 'file4.ts'), 'export const exclamation = "wow!";');
    await rm(join(sourceDir, 'file3.ts'));

    // Step 5: Reindex - should detect changes
    const result3 = await runIndexCommand(sourceDir, {
      name: 'demo',
      mode: 'update',
      showProgress: false,
    });

    expect(result3.success).toBe(true);
    expect(result3.filesProcessed).toBe(3); // file1, file2, file4
    expect(result3.filesSkipped).toBe(1); // file2 unchanged
    expect(result3.filesUpdated).toBe(1); // file1 modified
    expect(result3.filesAdded).toBe(1); // file4 new
    expect(result3.filesDeleted).toBe(1); // file3 deleted
    expect(result3.chunksCreated).toBe(2); // New chunks for file1 and file4

    // Step 6: Reindex again - everything should be skipped now
    const result4 = await runIndexCommand(sourceDir, {
      name: 'demo',
      mode: 'update',
      showProgress: false,
    });

    expect(result4.success).toBe(true);
    expect(result4.filesSkipped).toBe(3);
    expect(result4.filesUpdated).toBe(0);
    expect(result4.filesAdded).toBe(0);
    expect(result4.filesDeleted).toBe(0);
    expect(result4.chunksCreated).toBe(0);
  });
});
