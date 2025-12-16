import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runIndexCommand } from './index.js';
import {
  openDatabase,
  getIndex,
  getFileContentHashes,
  getFileMetadataHashes,
  type IndexDatabase,
} from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';

describe('index command - metadata table integration', () => {
  let testDir: string;
  let sourcePath: string;

  // Set timeout for these tests as indexing can take a while
  const TEST_TIMEOUT = 30000;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-metadata-int-test-${randomUUID()}`);
    sourcePath = join(testDir, 'source');
    await mkdir(sourcePath, { recursive: true });

    // Override home directory to use test-specific directory
    process.env.LGREP_HOME = join(testDir, 'lgrep-home');

    // Create test files
    await writeFile(join(sourcePath, 'file1.txt'), 'Content for file 1', 'utf-8');
    await writeFile(join(sourcePath, 'file2.ts'), 'const x = 1;\nexport { x };', 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should create metadata table on initial index', { timeout: TEST_TIMEOUT }, async () => {
    const indexName = 'metadata-create-test';

    // Create initial index
    await runIndexCommand(sourcePath, {
      name: indexName,
      showProgress: false,
    });

    // Verify metadata table exists and has entries
    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const handle = await getIndex(db, indexName);
      expect(handle).not.toBeNull();

      const metadataHashes = await getFileMetadataHashes(db, handle!);
      expect(metadataHashes.size).toBe(2);
      expect(metadataHashes.has(join(sourcePath, 'file1.txt'))).toBe(true);
      expect(metadataHashes.has(join(sourcePath, 'file2.ts'))).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('should use metadata table for faster hash lookup on update', async () => {
    const indexName = 'metadata-lookup-test';

    // Create initial index
    await runIndexCommand(sourcePath, {
      name: indexName,
      showProgress: false,
    });

    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const handle = await getIndex(db, indexName);
      expect(handle).not.toBeNull();

      // Time metadata lookup
      const metadataStart = Date.now();
      const metadataHashes = await getFileMetadataHashes(db, handle!);
      const metadataDuration = Date.now() - metadataStart;

      // Time chunk scan lookup
      const chunkStart = Date.now();
      const chunkHashes = await getFileContentHashes(db, handle!);
      const chunkDuration = Date.now() - chunkStart;

      // Verify both methods return same data
      expect(metadataHashes.size).toBe(chunkHashes.size);
      for (const [path, hash] of metadataHashes.entries()) {
        expect(chunkHashes.get(path)).toBe(hash);
      }

      // Metadata lookup should be faster (or at least not significantly slower)
      // We don't enforce strict timing as it can be flaky, but log for awareness
      console.log(`Metadata lookup: ${metadataDuration}ms, Chunk scan: ${chunkDuration}ms`);
    } finally {
      await db.close();
    }
  });

  it('should maintain metadata consistency on file updates', async () => {
    const indexName = 'metadata-consistency-test';

    // Create initial index
    await runIndexCommand(sourcePath, {
      name: indexName,
      showProgress: false,
    });

    // Update a file
    await writeFile(join(sourcePath, 'file1.txt'), 'UPDATED content for file 1', 'utf-8');

    // Run update
    await runIndexCommand(sourcePath, {
      name: indexName,
      mode: 'update',
      showProgress: false,
    });

    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const handle = await getIndex(db, indexName);
      expect(handle).not.toBeNull();

      // Verify metadata reflects new hash
      const metadataHashes = await getFileMetadataHashes(db, handle!);
      expect(metadataHashes.size).toBe(2);

      const chunkHashes = await getFileContentHashes(db, handle!);
      expect(metadataHashes.get(join(sourcePath, 'file1.txt'))).toBe(
        chunkHashes.get(join(sourcePath, 'file1.txt'))
      );
    } finally {
      await db.close();
    }
  });

  it('should remove metadata when files are deleted', async () => {
    const indexName = 'metadata-deletion-test';

    // Create initial index
    await runIndexCommand(sourcePath, {
      name: indexName,
      showProgress: false,
    });

    // Delete a file
    await rm(join(sourcePath, 'file1.txt'));

    // Run update
    await runIndexCommand(sourcePath, {
      name: indexName,
      mode: 'update',
      showProgress: false,
    });

    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const handle = await getIndex(db, indexName);
      expect(handle).not.toBeNull();

      // Verify metadata only has remaining file
      const metadataHashes = await getFileMetadataHashes(db, handle!);
      expect(metadataHashes.size).toBe(1);
      expect(metadataHashes.has(join(sourcePath, 'file1.txt'))).toBe(false);
      expect(metadataHashes.has(join(sourcePath, 'file2.ts'))).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('should handle migration from old indexes without metadata table', { timeout: TEST_TIMEOUT }, async () => {
    const indexName = 'metadata-migration-test';

    // Create initial index (which creates metadata table)
    await runIndexCommand(sourcePath, {
      name: indexName,
      showProgress: false,
    });

    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const handle = await getIndex(db, indexName);
      expect(handle).not.toBeNull();

      // Simulate old index by dropping metadata table
      const tableName = `${indexName}_files`;
      const tableNames = await db.connection.tableNames();
      if (tableNames.includes(tableName)) {
        await db.connection.dropTable(tableName);
      }

      // Verify metadata table is gone
      const hashesBeforeUpdate = await getFileMetadataHashes(db, handle!);
      expect(hashesBeforeUpdate.size).toBe(0);

      await db.close();

      // Modify a file to trigger processing during update
      await writeFile(join(sourcePath, 'file1.txt'), 'MODIFIED content', 'utf-8');

      // Run update - should recreate metadata table and populate it
      await runIndexCommand(sourcePath, {
        name: indexName,
        mode: 'update',
        showProgress: false,
      });

      const db2 = await openDatabase(dbPath);
      try {
        const handle2 = await getIndex(db2, indexName);
        expect(handle2).not.toBeNull();

        // Verify metadata table is recreated and has entries for processed files
        const hashesAfterUpdate = await getFileMetadataHashes(db2, handle2!);
        // Should have at least the modified file
        expect(hashesAfterUpdate.size).toBeGreaterThan(0);
        expect(hashesAfterUpdate.has(join(sourcePath, 'file1.txt'))).toBe(true);
      } finally {
        await db2.close();
      }
    } finally {
      if (db) {
        try {
          await db.close();
        } catch {
          // Already closed
        }
      }
    }
  });
});
