import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runListCommand } from './list.js';
import { openDatabase, createIndex } from '../../storage/lance.js';

describe('list command', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-list-cmd-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['MGREP_HOME'] = testDir;
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
});
