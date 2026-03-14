import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

vi.mock('node:child_process', () => ({
  exec: vi.fn((_command: string, callback: (error: Error | null, stdout?: string) => void) => {
    callback(null, '/usr/local/bin/ollama');
  }),
}));

vi.mock('../../daemon/manager.js', () => ({
  DaemonManager: vi.fn().mockImplementation(() => ({
    list: vi.fn().mockResolvedValue([]),
  })),
}));

import { runDoctorCommand } from './doctor.js';
import { openDatabase, createIndex, addChunks, updateIndexStatus } from '../../storage/lance.js';

function makeChunk(filePath: string) {
  return {
    id: `chunk-${randomUUID()}`,
    filePath,
    relativePath: 'src/file.ts',
    contentHash: randomUUID(),
    chunkIndex: 0,
    content: 'export function doctor() { return true; }',
    vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    language: 'typescript',
    lineStart: 1,
    lineEnd: 1,
    fileType: 'code',
    createdAt: new Date().toISOString(),
  };
}

function getCheck(result: Awaited<ReturnType<typeof runDoctorCommand>>, name: string) {
  return result.checks.find((check) => check.name === name);
}

describe('doctor command', () => {
  let testHome: string;
  let originalHome: string | undefined;
  let originalLgrepHome: string | undefined;
  let originalOpenAIKey: string | undefined;

  beforeEach(async () => {
    testHome = join(tmpdir(), `lgrep-doctor-test-${randomUUID()}`);
    await mkdir(testHome, { recursive: true });

    originalHome = process.env['HOME'];
    originalLgrepHome = process.env['LGREP_HOME'];
    originalOpenAIKey = process.env['OPENAI_API_KEY'];

    process.env['HOME'] = testHome;
    process.env['LGREP_HOME'] = join(testHome, 'lgrep-home');
    process.env['OPENAI_API_KEY'] = 'test-openai-key';

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();

    if (originalHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = originalHome;
    }

    if (originalLgrepHome === undefined) {
      delete process.env['LGREP_HOME'];
    } else {
      process.env['LGREP_HOME'] = originalLgrepHome;
    }

    if (originalOpenAIKey === undefined) {
      delete process.env['OPENAI_API_KEY'];
    } else {
      process.env['OPENAI_API_KEY'] = originalOpenAIKey;
    }

    await rm(testHome, { recursive: true, force: true });
  });

  it('warns when no indexes have been created yet', async () => {
    await mkdir(process.env['LGREP_HOME']!, { recursive: true });
    const repoPath = join(testHome, 'repo');
    await mkdir(repoPath, { recursive: true });

    const result = await runDoctorCommand({ path: repoPath });

    expect(result.success).toBe(true);
    expect(getCheck(result, 'Indexes')).toMatchObject({
      status: 'warn',
      message: 'No indexes created yet',
    });
    expect(getCheck(result, 'Current directory')).toMatchObject({
      status: 'warn',
    });
  });

  it('reports a ready local index for the target directory', async () => {
    const lgrepHome = process.env['LGREP_HOME']!;
    const db = await openDatabase(join(lgrepHome, 'db'));
    const repoPath = join(testHome, 'repo');
    await mkdir(repoPath, { recursive: true });

    try {
      const handle = await createIndex(db, {
        name: 'repo',
        rootPath: repoPath,
        model: 'test-model',
        modelDimensions: 4,
      });

      await addChunks(db, handle, [makeChunk(join(repoPath, 'src/file.ts'))]);
      await updateIndexStatus(db, handle, 'ready');

      const result = await runDoctorCommand({ path: repoPath });

      expect(result.success).toBe(true);
      expect(getCheck(result, 'lgrep home')).toMatchObject({
        status: 'ok',
      });
      expect(getCheck(result, 'Embedding provider')).toMatchObject({
        status: 'ok',
        message: 'Auto-detect will use OpenAI (API key found)',
      });
      expect(getCheck(result, 'Indexes')).toMatchObject({
        status: 'ok',
        message: '1 index(es): repo',
      });
      expect(getCheck(result, 'Zombie indexes')).toMatchObject({
        status: 'ok',
        message: 'No zombie indexes detected',
      });
      expect(getCheck(result, 'Current directory')).toMatchObject({
        status: 'ok',
        message: 'Indexed as "repo"',
      });
    } finally {
      await db.close();
    }
  });
});
