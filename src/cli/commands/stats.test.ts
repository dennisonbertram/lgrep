import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

vi.mock('../../storage/code-intel.js', () => ({
  getSymbols: vi.fn(),
  getCalls: vi.fn(),
  getDependencies: vi.fn(),
}));

vi.mock('../../daemon/manager.js', () => ({
  DaemonManager: vi.fn().mockImplementation(() => ({
    status: vi.fn().mockResolvedValue(null),
  })),
}));

import { runStatsCommand } from './stats.js';
import { openDatabase, createIndex, addChunks, updateIndexStatus } from '../../storage/lance.js';
import { getSymbols, getCalls, getDependencies } from '../../storage/code-intel.js';

function makeChunk(filePath: string) {
  return {
    id: `chunk-${randomUUID()}`,
    filePath,
    relativePath: 'src/file.ts',
    contentHash: randomUUID(),
    chunkIndex: 0,
    content: 'export function demo() { return 1; }',
    vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    language: 'typescript',
    lineStart: 1,
    lineEnd: 1,
    fileType: 'code',
    createdAt: new Date().toISOString(),
  };
}

describe('stats command', () => {
  let testHome: string;
  let originalLgrepHome: string | undefined;

  beforeEach(async () => {
    testHome = join(tmpdir(), `lgrep-stats-test-${randomUUID()}`);
    await mkdir(testHome, { recursive: true });

    originalLgrepHome = process.env['LGREP_HOME'];
    process.env['LGREP_HOME'] = testHome;

    vi.mocked(getSymbols).mockReset();
    vi.mocked(getCalls).mockReset();
    vi.mocked(getDependencies).mockReset();
  });

  afterEach(async () => {
    if (originalLgrepHome === undefined) {
      delete process.env['LGREP_HOME'];
    } else {
      process.env['LGREP_HOME'] = originalLgrepHome;
    }

    await rm(testHome, { recursive: true, force: true });
  });

  it('returns a clear error when no local database exists', async () => {
    const result = await runStatsCommand({ index: 'missing-index' });

    expect(result.success).toBe(false);
    expect(result.dbPath).toBe(join(testHome, 'db'));
    expect(result.error).toBe('No indexes found. Run: lgrep index <path>');
  });

  it('reports local index stats using the current local-disk storage layout', async () => {
    const db = await openDatabase(join(testHome, 'db'));

    try {
      const handle = await createIndex(db, {
        name: 'stats-local',
        rootPath: '/repo',
        model: 'test-model',
        modelDimensions: 4,
      });

      await addChunks(db, handle, [makeChunk('/repo/src/file.ts')]);
      await updateIndexStatus(db, handle, 'ready');

      vi.mocked(getSymbols).mockResolvedValue([
        { filePath: '/repo/src/file.ts' },
        { filePath: '/repo/src/other.ts' },
        { filePath: '/repo/src/other.ts' },
      ] as never[]);
      vi.mocked(getCalls).mockResolvedValue([{}, {}] as never[]);
      vi.mocked(getDependencies).mockResolvedValue([{}] as never[]);

      const result = await runStatsCommand({ index: 'stats-local' });

      expect(result.success).toBe(true);
      expect(result.dbPath).toBe(join(testHome, 'db'));
      expect(result.dbSizeBytes).toBeTypeOf('number');
      expect(result.index).toMatchObject({
        name: 'stats-local',
        rootPath: '/repo',
        status: 'ready',
        model: 'test-model',
        chunks: 1,
        symbols: 3,
        calls: 2,
        dependencies: 1,
        files: 2,
        watcherRunning: false,
      });
    } finally {
      await db.close();
    }
  });
});
