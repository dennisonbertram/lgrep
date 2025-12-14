import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runDeleteCommand } from './delete.js';
import { openDatabase, createIndex, getIndex } from '../../storage/lance.js';

describe('delete command', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-delete-cmd-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['MGREP_HOME'] = testDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
  });

  it('should delete an existing index', async () => {
    // Create an index first
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    await createIndex(db, {
      name: 'to-delete',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });

    await db.close();

    const output = await runDeleteCommand('to-delete');

    expect(output).toContain('Deleted');
    expect(output).toContain('to-delete');

    // Verify it's gone
    const db2 = await openDatabase(dbPath);
    const handle = await getIndex(db2, 'to-delete');
    expect(handle).toBeNull();
    await db2.close();
  });

  it('should fail for non-existent index', async () => {
    await expect(runDeleteCommand('nonexistent')).rejects.toThrow(/not found/i);
  });

  it('should require confirmation option for safety', async () => {
    // Create an index
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    await createIndex(db, {
      name: 'protected',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });

    await db.close();

    // Delete should work with force option
    const output = await runDeleteCommand('protected', { force: true });
    expect(output).toContain('Deleted');
  });
});
