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

    await db.close();

    // Run clean with force and only zombies (no prompt)
    const output = await runCleanCommand({ force: true, zombies: true });

    // New format shows counts, not individual names
    expect(output).toContain('Zombies deleted: 1');
    expect(output).toContain('Total: 1 index(es) deleted');

    // Verify zombie is gone
    const db2 = await openDatabase(dbPath);
    const zombieCheck = await getIndex(db2, 'zombie-index');
    expect(zombieCheck).toBeNull();

    // Verify ready index is still there
    const readyCheck = await getIndex(db2, 'ready-index');
    expect(readyCheck).not.toBeNull();

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

    // Only clean zombies - should find nothing
    const output = await runCleanCommand({ force: true, zombies: true });

    // New format shows "Nothing to clean." when nothing matches
    expect(output).toBe('Nothing to clean.');
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

    // Run in dry-run mode (only zombies to avoid stale path issues)
    const output = await runCleanCommand({ dryRun: true, zombies: true });

    // New format shows names in dry-run mode with "Would clean:" header
    expect(output).toContain('zombie-index');
    expect(output).toContain('Would clean:');
    expect(output).toContain('Run without --dry-run to clean.');

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

    // Only clean zombies to avoid stale path issues
    const output = await runCleanCommand({ force: true, json: true, zombies: true });

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

    // Only clean zombies to avoid stale path issues
    const output = await runCleanCommand({ dryRun: true, zombies: true });

    expect(output).toContain('zombie-index');
    // Dry-run shows age in hours format like "(0h old)"
    expect(output).toMatch(/\d+(\.\d+)?h old/);
    // Should show time information (createdAt is available in metadata)
    expect(zombieHandle.metadata.createdAt).toBeDefined();
  });

  it('should handle empty database gracefully', async () => {
    const output = await runCleanCommand({ force: true });

    // New format shows specific message when no indexes exist
    expect(output).toBe('No indexes found to clean.');
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

    // Only clean zombies to avoid stale path issues
    const output = await runCleanCommand({ force: true, zombies: true });

    // New format shows counts, not individual names
    expect(output).toContain('Zombies deleted: 3');
    expect(output).toContain('Total: 3 index(es) deleted');

    // Verify all are gone
    const db2 = await openDatabase(dbPath);
    expect(await getIndex(db2, 'zombie-1')).toBeNull();
    expect(await getIndex(db2, 'zombie-2')).toBeNull();
    expect(await getIndex(db2, 'zombie-3')).toBeNull();

    await db2.close();
  });
});
