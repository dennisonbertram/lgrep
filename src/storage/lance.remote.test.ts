import { describe, it, expect, beforeEach, vi } from 'vitest';

const { connectMock, mkdirMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  mkdirMock: vi.fn(),
}));

vi.mock('@lancedb/lancedb', () => ({
  connect: connectMock,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: mkdirMock,
  };
});

describe('openDatabase remote settings', () => {
  beforeEach(() => {
    vi.resetModules();
    connectMock.mockReset();
    mkdirMock.mockReset();
    connectMock.mockResolvedValue({
      tableNames: vi.fn().mockResolvedValue([]),
    });
    mkdirMock.mockResolvedValue(undefined);
  });

  it('creates local directories when opening a local database setting', async () => {
    const { openDatabase } = await import('./lance.js');

    await openDatabase({
      mode: 'local',
      uri: '/tmp/lgrep-db',
    });

    expect(mkdirMock).toHaveBeenCalledWith('/tmp/lgrep-db', { recursive: true });
    expect(connectMock).toHaveBeenCalledWith('/tmp/lgrep-db');
  });

  it('passes storage options through for s3-compatible databases', async () => {
    const { openDatabase } = await import('./lance.js');

    await openDatabase({
      mode: 's3',
      uri: 's3://lgrep-test/indexes',
      storageOptions: {
        endpoint: 'https://example.r2.cloudflarestorage.com',
        region: 'auto',
        access_key_id: 'key',
        secret_access_key: 'secret',
      },
    });

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(connectMock).toHaveBeenCalledWith('s3://lgrep-test/indexes', {
      storageOptions: {
        endpoint: 'https://example.r2.cloudflarestorage.com',
        region: 'auto',
        access_key_id: 'key',
        secret_access_key: 'secret',
      },
    });
  });
});
