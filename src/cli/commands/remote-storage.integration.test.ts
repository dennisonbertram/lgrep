import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import S3rver from 's3rver';

vi.mock('../../core/embeddings.js', () => ({
  createEmbeddingClient: vi.fn(() => ({
    model: 'test-model',
    embed: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3, 0.4]],
    }),
  })),
}));

vi.mock('../../storage/code-intel.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage/code-intel.js')>();
  return {
    ...actual,
    getSymbols: vi.fn().mockResolvedValue([]),
    getCalls: vi.fn().mockResolvedValue([]),
    getDependencies: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../daemon/manager.js', () => ({
  DaemonManager: vi.fn().mockImplementation(() => ({
    list: vi.fn().mockResolvedValue([]),
    status: vi.fn().mockResolvedValue(null),
  })),
}));

import { DEFAULT_CONFIG, saveConfig } from '../../storage/config.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import { createIndex, addChunks, updateIndexStatus } from '../../storage/lance.js';
import { runDeleteCommand } from './delete.js';
import { runListCommand } from './list.js';
import { runSearchCommand } from './search.js';
import { runStatsCommand } from './stats.js';

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(port);
        });
        return;
      }

      reject(new Error('Failed to allocate a test port'));
    });
  });
}

describe('remote storage integration', () => {
  let testHome: string;
  let s3DataDir: string;
  let s3Server: S3rver;
  let originalEnv: NodeJS.ProcessEnv;
  let endpoint: string;

  beforeEach(async () => {
    testHome = join(tmpdir(), `lgrep-remote-storage-test-${randomUUID()}`);
    s3DataDir = join(testHome, 's3');
    await mkdir(s3DataDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testHome;
    process.env['ALLOW_HTTP'] = 'true';
    process.env['AWS_ACCESS_KEY_ID'] = 'S3RVER';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'S3RVER';

    const port = await getAvailablePort();
    endpoint = `http://127.0.0.1:${port}`;
    s3Server = new S3rver({
      address: '127.0.0.1',
      port,
      silent: true,
      directory: s3DataDir,
      resetOnClose: true,
      allowMismatchedSignatures: true,
      vhostBuckets: false,
      configureBuckets: [{ name: 'remote-index-tests' }],
    });
    await s3Server.run();

    await saveConfig({
      ...DEFAULT_CONFIG,
      storageMode: 's3',
      storageUri: 's3://remote-index-tests/lgrep',
      storageEndpoint: endpoint,
      storageRegion: 'us-east-1',
    });
  });

  afterEach(async () => {
    await s3Server.close();
    process.env = originalEnv;
    await rm(testHome, { recursive: true, force: true });
  });

  it('lists, inspects, and deletes indexes against the configured remote backend', async () => {
    const db = await openConfiguredDatabase();

    try {
      const handle = await createIndex(db, {
        name: 'remote-index',
        rootPath: '/repo',
        model: 'test-model',
        modelDimensions: 4,
      });

      await addChunks(db, handle, [
        {
          id: `chunk-${randomUUID()}`,
          filePath: '/repo/src/auth.ts',
          relativePath: 'src/auth.ts',
          contentHash: randomUUID(),
          chunkIndex: 0,
          content: 'export function authenticate() { return true; }',
          vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
          language: 'typescript',
          lineStart: 1,
          lineEnd: 1,
          fileType: 'code',
          createdAt: new Date().toISOString(),
        },
      ]);
      await updateIndexStatus(db, handle, 'ready');
    } finally {
      await db.close();
    }

    const listOutput = await runListCommand();
    expect(listOutput).toContain('remote-index');
    expect(listOutput).toContain('/repo');

    const stats = await runStatsCommand({ index: 'remote-index' });
    expect(stats.success).toBe(true);
    expect(stats.dbPath).toBe('s3://remote-index-tests/lgrep');
    expect(stats.dbSizeBytes).toBeUndefined();
    expect(stats.index).toMatchObject({
      name: 'remote-index',
      status: 'ready',
      chunks: 1,
    });

    const deleteOutput = await runDeleteCommand('remote-index');
    expect(deleteOutput).toBe('Deleted index "remote-index"');
    expect(await runListCommand()).toContain('No indexes found');
  });

  it('runs semantic search against a remotely stored index', async () => {
    const db = await openConfiguredDatabase();

    try {
      const handle = await createIndex(db, {
        name: 'remote-search',
        rootPath: '/repo',
        model: 'test-model',
        modelDimensions: 4,
      });

      await addChunks(db, handle, [
        {
          id: `chunk-${randomUUID()}`,
          filePath: '/repo/src/auth.ts',
          relativePath: 'src/auth.ts',
          contentHash: randomUUID(),
          chunkIndex: 0,
          content: 'export function authenticateRequest() { return true; }',
          vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
          language: 'typescript',
          lineStart: 1,
          lineEnd: 1,
          fileType: 'code',
          createdAt: new Date().toISOString(),
        },
      ]);
      await updateIndexStatus(db, handle, 'ready');
    } finally {
      await db.close();
    }

    const result = await runSearchCommand('authentication entry point', {
      index: 'remote-search',
      showProgress: false,
    });

    expect(result.success).toBe(true);
    expect(result.indexName).toBe('remote-search');
    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]).toMatchObject({
      filePath: '/repo/src/auth.ts',
      relativePath: 'src/auth.ts',
    });
  });
});
