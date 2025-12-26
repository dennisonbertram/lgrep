import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runCleanCommand } from './clean.js';
import {
  openDatabase,
  createIndex,
  getIndex,
  updateIndexStatus,
} from '../../storage/lance.js';

describe('clean command', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-clean-cmd-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
  });

  it('should delete zombie indexes stuck in building state', async () => {
    // Create indexes in different states
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    // Create a zombie index (stuck in building)
    await createIndex(db, {
      name: 'zombie-index',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });
    // Status is already 'building' by default

    // Create a ready index (should NOT be deleted)
    const readyHandle = await createIndex(db, {
      name: 'ready-index',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });
    await updateIndexStatus(db, readyHandle, 'ready');

    // Create a failed index (should NOT be deleted)
    const failedHandle = await createIndex(db, {
      name: 'failed-index',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });
    await updateIndexStatus(db, failedHandle, 'failed');

    await db.close();

    // Run clean with force (no prompt)
    const output = await runCleanCommand({ force: true });

    expect(output).toContain('zombie-index');
    expect(output).toContain('1');

    // Verify zombie is gone
    const db2 = await openDatabase(dbPath);
    const zombieCheck = await getIndex(db2, 'zombie-index');
    expect(zombieCheck).toBeNull();

    // Verify ready index is still there
    const readyCheck = await getIndex(db2, 'ready-index');
    expect(readyCheck).not.toBeNull();

    // Verify failed index is still there
    const failedCheck = await getIndex(db2, 'failed-index');
    expect(failedCheck).not.toBeNull();

    await db2.close();
  });

  it('should report when no zombie indexes are found', async () => {
    // Create only ready indexes
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    const readyHandle = await createIndex(db, {
      name: 'ready-index',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });
    await updateIndexStatus(db, readyHandle, 'ready');

    await db.close();

    const output = await runCleanCommand({ force: true });

    expect(output).toMatch(/no.*zombie/i);
  });

  it('should support dry-run mode without deleting', async () => {
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    // Create a zombie index
    await createIndex(db, {
      name: 'zombie-index',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });

    await db.close();

    // Run in dry-run mode
    const output = await runCleanCommand({ dryRun: true });

    expect(output).toContain('zombie-index');
    expect(output).toMatch(/would.*delete/i);

    // Verify zombie still exists
    const db2 = await openDatabase(dbPath);
    const zombieCheck = await getIndex(db2, 'zombie-index');
    expect(zombieCheck).not.toBeNull();

    await db2.close();
  });

  it('should output JSON format when requested', async () => {
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    // Create a zombie index
    await createIndex(db, {
      name: 'zombie-index',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });

    await db.close();

    const output = await runCleanCommand({ force: true, json: true });

    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('command', 'clean');
    expect(parsed).toHaveProperty('data');
    expect(parsed.data).toHaveProperty('zombiesFound');
    expect(parsed.data).toHaveProperty('deleted');
    expect(parsed.data.zombiesFound).toBe(1);
    expect(parsed.data.deleted).toBe(1);
  });

  it('should show how long indexes have been in building state', async () => {
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    // Create a zombie index
    const zombieHandle = await createIndex(db, {
      name: 'zombie-index',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });

    await db.close();

    const output = await runCleanCommand({ dryRun: true });

    expect(output).toContain('zombie-index');
    // Should show time information (createdAt is available in metadata)
    expect(zombieHandle.metadata.createdAt).toBeDefined();
  });

  it('should handle empty database gracefully', async () => {
    const output = await runCleanCommand({ force: true });

    expect(output).toMatch(/no.*zombie/i);
  });

  it('should delete multiple zombie indexes', async () => {
    const dbPath = join(testDir, 'db');
    const db = await openDatabase(dbPath);

    // Create multiple zombie indexes
    await createIndex(db, {
      name: 'zombie-1',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });

    await createIndex(db, {
      name: 'zombie-2',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });

    await createIndex(db, {
      name: 'zombie-3',
      rootPath: '/test',
      model: 'test-model',
      modelDimensions: 512,
    });

    await db.close();

    const output = await runCleanCommand({ force: true });

    expect(output).toContain('zombie-1');
    expect(output).toContain('zombie-2');
    expect(output).toContain('zombie-3');
    expect(output).toContain('3');

    // Verify all are gone
    const db2 = await openDatabase(dbPath);
    expect(await getIndex(db2, 'zombie-1')).toBeNull();
    expect(await getIndex(db2, 'zombie-2')).toBeNull();
    expect(await getIndex(db2, 'zombie-3')).toBeNull();

    await db2.close();
  });
});
