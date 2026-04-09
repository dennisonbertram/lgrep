import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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

const { openConfiguredDatabaseMock, listIndexesMock, getIndexMock } = vi.hoisted(() => ({
  openConfiguredDatabaseMock: vi.fn(),
  listIndexesMock: vi.fn(),
  getIndexMock: vi.fn(),
}));

vi.mock('../../storage/database-config.js', () => ({
  openConfiguredDatabase: openConfiguredDatabaseMock,
}));

vi.mock('../../storage/lance.js', () => ({
  listIndexes: listIndexesMock,
  getIndex: getIndexMock,
}));

import { runDoctorCommand } from './doctor.js';

function getCheck(result: Awaited<ReturnType<typeof runDoctorCommand>>, name: string) {
  return result.checks.find((check) => check.name === name);
}

describe('doctor command (cloud)', () => {
  let testHome: string;
  let originalHome: string | undefined;
  let originalLgrepHome: string | undefined;
  let originalOpenAIKey: string | undefined;
  let originalDatabaseUrl: string | undefined;

  beforeEach(async () => {
    testHome = join(tmpdir(), `lgrep-doctor-cloud-test-${randomUUID()}`);
    await mkdir(testHome, { recursive: true });

    originalHome = process.env['HOME'];
    originalLgrepHome = process.env['LGREP_HOME'];
    originalOpenAIKey = process.env['OPENAI_API_KEY'];
    originalDatabaseUrl = process.env['LGREP_DATABASE_URL'];

    process.env['HOME'] = testHome;
    process.env['LGREP_HOME'] = join(testHome, 'lgrep-home');
    process.env['OPENAI_API_KEY'] = 'test-openai-key';
    process.env['LGREP_DATABASE_URL'] = 'postgresql://example.invalid/lgrep';

    await mkdir(process.env['LGREP_HOME']!, { recursive: true });
    await writeFile(
      join(process.env['LGREP_HOME']!, 'config.json'),
      JSON.stringify({
        storageMode: 'postgres',
        storageDatabaseUrlEnv: 'LGREP_DATABASE_URL',
        cacheBackend: 'postgres',
        cacheDatabaseUrlEnv: 'LGREP_DATABASE_URL',
      }, null, 2),
      'utf-8',
    );

    openConfiguredDatabaseMock.mockReset();
    listIndexesMock.mockReset();
    getIndexMock.mockReset();

    const fakeDb = {
      mode: 'postgres',
      close: vi.fn().mockResolvedValue(undefined),
    };
    openConfiguredDatabaseMock.mockResolvedValue(fakeDb);
    listIndexesMock.mockResolvedValue([]);
    getIndexMock.mockResolvedValue(null);

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

    if (originalDatabaseUrl === undefined) {
      delete process.env['LGREP_DATABASE_URL'];
    } else {
      process.env['LGREP_DATABASE_URL'] = originalDatabaseUrl;
    }

    await rm(testHome, { recursive: true, force: true });
  });

  it('treats a fresh cloud database as ready after bootstrap succeeds', async () => {
    const repoPath = join(testHome, 'repo');
    await mkdir(repoPath, { recursive: true });

    const result = await runDoctorCommand({ path: repoPath });

    expect(result.success).toBe(true);
    expect(getCheck(result, 'Storage backend')).toMatchObject({
      status: 'ok',
      message: 'Cloud Postgres using LGREP_DATABASE_URL',
    });
    expect(getCheck(result, 'Cloud database')).toMatchObject({
      status: 'ok',
      message: 'Connected via LGREP_DATABASE_URL; pgvector and schema are ready',
    });
    expect(getCheck(result, 'Remote cache')).toMatchObject({
      status: 'ok',
      message: 'Remote cache configured via LGREP_DATABASE_URL',
    });
    expect(getCheck(result, 'Indexes')).toMatchObject({
      status: 'warn',
      message: 'No indexes found',
    });
    expect(openConfiguredDatabaseMock).toHaveBeenCalled();
  });
});
