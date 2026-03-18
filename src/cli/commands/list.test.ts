import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runListCommand } from './list.js';
import { addChunks, createIndex, openDatabase, type DocumentChunk } from '../../storage/lance.js';

describe('list command', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-list-cmd-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
  });

  it('should show message when no indexes exist', async () => {
    const output = await runListCommand();

    expect(output).toContain('No indexes found');
  });

  it('should list all indexes with metadata', async () => {
    // Create some indexes
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    await createIndex(db, {
      name: 'project-a',
      rootPath: '/path/to/project-a',
      model: 'mxbai-embed-large',
      modelDimensions: 1024,
    });

    await createIndex(db, {
      name: 'project-b',
      rootPath: '/path/to/project-b',
      model: 'mxbai-embed-large',
      modelDimensions: 1024,
    });

    await db.close();

    const output = await runListCommand();

    expect(output).toContain('project-a');
    expect(output).toContain('project-b');
    expect(output).toContain('/path/to/project-a');
    expect(output).toContain('/path/to/project-b');
  });

  it('should show index status', async () => {
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    await createIndex(db, {
      name: 'test-index',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });

    await db.close();

    const output = await runListCommand();

    expect(output).toContain('building');
  });

  it('hydrates file counts for json output when metadata is stale', async () => {
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    const handle = await createIndex(db, {
      name: 'json-index',
      rootPath: '/json-test',
      model: 'test-model',
      modelDimensions: 4,
    });

    const chunk: DocumentChunk = {
      id: randomUUID(),
      filePath: '/json-test/file.ts',
      relativePath: 'file.ts',
      contentHash: 'hash-1',
      chunkIndex: 0,
      content: 'export function test() {}',
      vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      fileType: '.ts',
      createdAt: new Date().toISOString(),
    };

    await addChunks(db, handle, [chunk]);
    await db.close();

    const output = await runListCommand(true);
    const parsed = JSON.parse(output) as { indexes: Array<{ name: string; files: number; chunks: number }> };
    const jsonIndex = parsed.indexes.find((index) => index.name === 'json-index');

    expect(jsonIndex).toBeDefined();
    expect(jsonIndex?.files).toBe(1);
    expect(jsonIndex?.chunks).toBe(1);
  });
});
