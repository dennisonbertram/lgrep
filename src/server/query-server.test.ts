import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
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
  queryHostedCallersMock,
  queryHostedImpactMock,
  buildHostedContextMock,
} = vi.hoisted(() => ({
  ensureWorktreeTablesMock: vi.fn().mockResolvedValue(undefined),
  listWorktreesMock: vi.fn().mockResolvedValue([]),
  diffWorktreesMock: vi.fn(),
  getWorktreeMock: vi.fn(),
  ensureProjectTablesMock: vi.fn().mockResolvedValue(undefined),
  listProjectsMock: vi.fn().mockResolvedValue([]),
  getProjectMock: vi.fn(),
  getProjectStatsMock: vi.fn(),
  queryHostedCallersMock: vi.fn(),
  queryHostedImpactMock: vi.fn(),
  buildHostedContextMock: vi.fn(),
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

vi.mock('./query-reads.js', () => ({
  queryHostedCallers: queryHostedCallersMock,
  queryHostedImpact: queryHostedImpactMock,
  buildHostedContext: buildHostedContextMock,
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
    queryHostedCallersMock.mockReset();
    queryHostedImpactMock.mockReset();
    buildHostedContextMock.mockReset();
  });

  afterEach(() => {
    if (originalAuthToken === undefined) {
      delete process.env['LGREP_SERVER_AUTH_TOKEN'];
    } else {
      process.env['LGREP_SERVER_AUTH_TOKEN'] = originalAuthToken;
    }
  });

  function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  it('rejects unauthenticated health checks when a bearer token is configured', async () => {
    const db = {
      pool: {
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
      },
    } as any;

    const server = startQueryServer(0, db, {
      auth: {
        legacyToken: 'secret-token',
        storedTokens: [],
        descriptor: {
          enabled: true,
          mode: 'legacy-env',
          tokenEnv: 'LGREP_SERVER_AUTH_TOKEN',
          tokenCount: 0,
        },
      },
    });
    await once(server, 'listening');

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      const payload = await response.json() as { error: string };

      expect(response.status).toBe(401);
      expect(payload.error).toContain('bearer token');
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

    const server = startQueryServer(0, db, {
      auth: {
        legacyToken: 'secret-token',
        storedTokens: [],
        descriptor: {
          enabled: true,
          mode: 'legacy-env',
          tokenEnv: 'LGREP_SERVER_AUTH_TOKEN',
          tokenCount: 0,
        },
      },
    });
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
        auth: { enabled: boolean; mode: string; tokenEnv?: string; tokenCount: number };
        stats: { projects: number; worktrees: number; shared_chunks: number; unique_content_hashes: number };
      };

      expect(response.status).toBe(200);
      expect(payload.status).toBe('healthy');
      expect(payload.auth).toEqual({
        enabled: true,
        mode: 'legacy-env',
        tokenEnv: 'LGREP_SERVER_AUTH_TOKEN',
        tokenCount: 0,
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

  it('filters project discovery to the scoped token projects', async () => {
    const db = {
      pool: {
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
      },
    } as any;

    listProjectsMock.mockResolvedValueOnce([
      { id: 'p1', name: 'alpha', displayName: null, repoUrl: null, model: 'm', modelDims: 4, chunkMaxTokens: 500, chunkOverlap: 50, excludePatterns: [], metadata: {}, createdAt: 'now', updatedAt: 'now' },
      { id: 'p2', name: 'beta', displayName: null, repoUrl: null, model: 'm', modelDims: 4, chunkMaxTokens: 500, chunkOverlap: 50, excludePatterns: [], metadata: {}, createdAt: 'now', updatedAt: 'now' },
    ]);

    const server = startQueryServer(0, db, {
      auth: {
        legacyToken: null,
        storedTokens: [
          {
            id: 'tok1',
            label: 'alpha only',
            tokenHash: hashToken('scoped-token'),
            projects: ['alpha'],
            worktrees: null,
            createdAt: 'now',
          },
        ],
        descriptor: {
          enabled: true,
          mode: 'token-store',
          tokenFile: '/tmp/server-tokens.json',
          tokenCount: 1,
        },
      },
    });
    await once(server, 'listening');

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/query`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer scoped-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'projects', params: {} }),
      });
      const payload = await response.json() as { projects: Array<{ name: string }>; count: number };

      expect(response.status).toBe(200);
      expect(payload.count).toBe(1);
      expect(payload.projects.map((project) => project.name)).toEqual(['alpha']);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rejects project info outside the scoped token project set', async () => {
    const db = {
      pool: {
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
      },
    } as any;

    getProjectMock.mockResolvedValueOnce({
      id: 'p2',
      name: 'beta',
      displayName: null,
      repoUrl: null,
      model: 'm',
      modelDims: 4,
      chunkMaxTokens: 500,
      chunkOverlap: 50,
      excludePatterns: [],
      metadata: {},
      createdAt: 'now',
      updatedAt: 'now',
    });

    const server = startQueryServer(0, db, {
      auth: {
        legacyToken: null,
        storedTokens: [
          {
            id: 'tok1',
            label: 'alpha only',
            tokenHash: hashToken('scoped-token'),
            projects: ['alpha'],
            worktrees: null,
            createdAt: 'now',
          },
        ],
        descriptor: {
          enabled: true,
          mode: 'token-store',
          tokenFile: '/tmp/server-tokens.json',
          tokenCount: 1,
        },
      },
    });
    await once(server, 'listening');

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/query`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer scoped-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'project-info', project: 'beta', params: {} }),
      });
      const payload = await response.json() as { error: string };

      expect(response.status).toBe(403);
      expect(payload.error).toContain('not allowed');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves hosted callers within the scoped project', async () => {
    const db = {
      pool: {
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
      },
    } as any;

    getProjectMock.mockResolvedValueOnce({
      id: 'p1',
      name: 'alpha',
      displayName: null,
      repoUrl: null,
      model: 'm',
      modelDims: 4,
      chunkMaxTokens: 500,
      chunkOverlap: 50,
      excludePatterns: [],
      metadata: {},
      createdAt: 'now',
      updatedAt: 'now',
    });
    queryHostedCallersMock.mockResolvedValueOnce({
      symbol: 'createSession',
      callers: [{ file: 'feature-login:src/app.ts', line: 7, callerName: 'startApp' }],
      count: 1,
    });

    const server = startQueryServer(0, db, {
      auth: {
        legacyToken: 'secret-token',
        storedTokens: [],
        descriptor: {
          enabled: true,
          mode: 'legacy-env',
          tokenEnv: 'LGREP_SERVER_AUTH_TOKEN',
          tokenCount: 0,
        },
      },
    });
    await once(server, 'listening');

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/query`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          method: 'callers',
          project: 'alpha',
          params: { symbol: 'createSession' },
        }),
      });
      const payload = await response.json() as { count: number; callers: Array<{ callerName?: string }> };

      expect(response.status).toBe(200);
      expect(queryHostedCallersMock).toHaveBeenCalledWith(db, {
        symbol: 'createSession',
        project: expect.objectContaining({ id: 'p1', name: 'alpha' }),
        worktree: undefined,
      });
      expect(payload.count).toBe(1);
      expect(payload.callers[0]?.callerName).toBe('startApp');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves hosted context for a scoped worktree', async () => {
    const db = {
      pool: {
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
      },
    } as any;

    getProjectMock.mockResolvedValueOnce({
      id: 'p1',
      name: 'alpha',
      displayName: null,
      repoUrl: null,
      model: 'm',
      modelDims: 4,
      chunkMaxTokens: 500,
      chunkOverlap: 50,
      excludePatterns: [],
      metadata: {},
      createdAt: 'now',
      updatedAt: 'now',
    });
    getWorktreeMock.mockResolvedValueOnce({
      id: 'w1',
      name: 'feature-login',
      projectId: 'p1',
      model: 'm',
      modelDims: 4,
      chunkMaxTokens: 500,
      chunkOverlap: 50,
      status: 'ready',
      fileCount: 2,
      chunkCount: 2,
      rootPath: null,
      repoUrl: null,
      branch: 'feature/login',
      baseCommit: null,
      parentId: null,
      createdAt: 'now',
      updatedAt: 'now',
    });
    buildHostedContextMock.mockResolvedValueOnce({
      task: 'trace auth flow',
      indexName: 'alpha/feature-login',
      relevantFiles: [],
      keySymbols: [],
      suggestedApproach: [],
      tokenCount: 10,
      timestamp: 'now',
      files: [],
      symbols: [],
    });

    const server = startQueryServer(0, db, {
      auth: {
        legacyToken: 'secret-token',
        storedTokens: [],
        descriptor: {
          enabled: true,
          mode: 'legacy-env',
          tokenEnv: 'LGREP_SERVER_AUTH_TOKEN',
          tokenCount: 0,
        },
      },
    });
    await once(server, 'listening');

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/query`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          method: 'context',
          project: 'alpha',
          worktree: 'feature-login',
          params: { task: 'trace auth flow', limit: 5, summaryOnly: true },
        }),
      });
      const payload = await response.json() as { indexName: string; worktree?: string };

      expect(response.status).toBe(200);
      expect(buildHostedContextMock).toHaveBeenCalledWith(db, expect.objectContaining({
        task: 'trace auth flow',
        project: expect.objectContaining({ id: 'p1', name: 'alpha' }),
        worktree: expect.objectContaining({ id: 'w1', name: 'feature-login' }),
        limit: 5,
        summaryOnly: true,
      }));
      expect(payload.indexName).toBe('alpha/feature-login');
      expect(payload.worktree).toBe('feature-login');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
