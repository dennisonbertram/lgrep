import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startQueryServer } from './query-server.js';

const {
  ensureWorktreeTablesMock,
  listWorktreesMock,
  diffWorktreesMock,
  getWorktreeMock,
  ensureProjectTablesMock,
  listProjectsMock,
  getProjectMock,
  getProjectStatsMock,
} = vi.hoisted(() => ({
  ensureWorktreeTablesMock: vi.fn().mockResolvedValue(undefined),
  listWorktreesMock: vi.fn().mockResolvedValue([]),
  diffWorktreesMock: vi.fn(),
  getWorktreeMock: vi.fn(),
  ensureProjectTablesMock: vi.fn().mockResolvedValue(undefined),
  listProjectsMock: vi.fn().mockResolvedValue([]),
  getProjectMock: vi.fn(),
  getProjectStatsMock: vi.fn(),
}));

vi.mock('../storage/worktree.js', () => ({
  ensureWorktreeTables: ensureWorktreeTablesMock,
  listWorktrees: listWorktreesMock,
  diffWorktrees: diffWorktreesMock,
  getWorktree: getWorktreeMock,
}));

vi.mock('../storage/project.js', () => ({
  ensureProjectTables: ensureProjectTablesMock,
  listProjects: listProjectsMock,
  getProject: getProjectMock,
  getProjectStats: getProjectStatsMock,
}));

vi.mock('../storage/lance.js', () => ({
  searchSharedChunksForWorktree: vi.fn(),
  searchSharedChunksForProject: vi.fn(),
  rerankerWithMMR: vi.fn((results) => results),
}));

vi.mock('../core/embeddings.js', () => ({
  createEmbeddingClient: vi.fn(),
}));

describe('query server auth', () => {
  let originalAuthToken: string | undefined;

  beforeEach(() => {
    originalAuthToken = process.env['LGREP_SERVER_AUTH_TOKEN'];
    ensureWorktreeTablesMock.mockReset().mockResolvedValue(undefined);
    listWorktreesMock.mockReset().mockResolvedValue([]);
    diffWorktreesMock.mockReset();
    getWorktreeMock.mockReset();
    ensureProjectTablesMock.mockReset().mockResolvedValue(undefined);
    listProjectsMock.mockReset().mockResolvedValue([]);
    getProjectMock.mockReset();
    getProjectStatsMock.mockReset();
  });

  afterEach(() => {
    if (originalAuthToken === undefined) {
      delete process.env['LGREP_SERVER_AUTH_TOKEN'];
    } else {
      process.env['LGREP_SERVER_AUTH_TOKEN'] = originalAuthToken;
    }
  });

  it('rejects unauthenticated health checks when a bearer token is configured', async () => {
    const db = {
      pool: {
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
      },
    } as any;

    const server = startQueryServer(0, db, { authToken: 'secret-token' });
    await once(server, 'listening');

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      const payload = await response.json() as { error: string };

      expect(response.status).toBe(401);
      expect(payload.error).toContain('LGREP_SERVER_AUTH_TOKEN');
      expect(listProjectsMock).not.toHaveBeenCalled();
      expect(listWorktreesMock).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves health details when the correct bearer token is supplied', async () => {
    const db = {
      pool: {
        totalCount: 2,
        idleCount: 1,
        waitingCount: 0,
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
          .mockResolvedValueOnce({ rows: [{ count: '12' }] })
          .mockResolvedValueOnce({ rows: [{ count: '4' }] }),
      },
    } as any;

    listProjectsMock.mockResolvedValueOnce([{ id: 'p1' }]);
    listWorktreesMock.mockResolvedValueOnce([{ id: 'w1' }, { id: 'w2' }]);

    const server = startQueryServer(0, db, { authToken: 'secret-token' });
    await once(server, 'listening');

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      });
      const payload = await response.json() as {
        status: string;
        auth: { enabled: boolean; tokenEnv?: string };
        stats: { projects: number; worktrees: number; shared_chunks: number; unique_content_hashes: number };
      };

      expect(response.status).toBe(200);
      expect(payload.status).toBe('healthy');
      expect(payload.auth).toEqual({
        enabled: true,
        tokenEnv: 'LGREP_SERVER_AUTH_TOKEN',
      });
      expect(payload.stats).toEqual({
        projects: 1,
        worktrees: 2,
        shared_chunks: 12,
        unique_content_hashes: 4,
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
