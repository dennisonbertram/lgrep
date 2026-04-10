import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createEmbeddingClient } from '../core/embeddings.js';
import { DEFAULT_SERVER_AUTH_TOKEN_ENV, isAuthorizedRequest } from './auth.js';
import {
  searchSharedChunksForWorktree,
  searchSharedChunksForProject,
  rerankerWithMMR,
  type IndexDatabase,
} from '../storage/lance.js';
import {
  ensureWorktreeTables,
  getWorktree,
  listWorktrees,
  diffWorktrees,
} from '../storage/worktree.js';
import {
  ensureProjectTables,
  getProject,
  listProjects,
  getProjectStats,
} from '../storage/project.js';

export interface QueryRequest {
  method: 'search' | 'worktrees' | 'projects' | 'project-info' | 'diff' | 'health';
  project?: string;
  worktree?: string;
  params: Record<string, unknown>;
}

export interface QuerySearchResponse {
  project?: string;
  worktree?: string;
  results: Array<{
    relativePath: string;
    content: string;
    score: number;
    lineStart?: number;
    lineEnd?: number;
    chunkIndex: number;
  }>;
  count: number;
}

export interface QueryHealthResponse {
  status: 'healthy' | 'degraded';
  uptime: string;
  auth: {
    enabled: boolean;
    tokenEnv?: string;
  };
  postgres: {
    connected: boolean;
    pool_size: number;
    active_connections: number;
    idle_connections: number;
  };
  stats: {
    projects: number;
    worktrees: number;
    shared_chunks: number;
    unique_content_hashes: number;
  };
}

interface ServerState {
  db: IndexDatabase;
  startedAt: Date;
  authToken: string | null;
}

let state: ServerState | null = null;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleSearch(db: IndexDatabase, request: QueryRequest, res: ServerResponse): Promise<void> {
  const query = request.params['query'] as string;
  const limit = (request.params['limit'] as number) ?? 10;
  const diversity = (request.params['diversity'] as number) ?? 0.7;

  if (!query) {
    jsonResponse(res, 400, { error: 'query parameter is required' });
    return;
  }

  await ensureWorktreeTables(db);

  // Project-scoped search
  if (request.project) {
    await ensureProjectTables(db);
    const proj = await getProject(db, request.project);
    if (!proj) {
      jsonResponse(res, 404, { error: `Project "${request.project}" not found` });
      return;
    }

    let worktreeId: string | undefined;
    if (request.worktree) {
      const wt = await getWorktree(db, request.worktree, { projectId: proj.id });
      if (!wt) {
        jsonResponse(res, 404, { error: `Worktree "${request.worktree}" not found in project "${proj.name}"` });
        return;
      }
      worktreeId = wt.id;
    }

    const embedClient = createEmbeddingClient({ model: proj.model });
    const queryResult = await embedClient.embed(query);
    const queryEmbedding = queryResult.embeddings[0];
    if (!queryEmbedding) {
      jsonResponse(res, 500, { error: 'Failed to generate query embedding' });
      return;
    }
    const queryVector = new Float32Array(queryEmbedding);

    const searchResults = await searchSharedChunksForProject(
      db, queryVector, proj.id, { limit: limit * 2, model: proj.model, worktreeId },
    );
    const reranked = rerankerWithMMR(searchResults, queryVector, diversity).slice(0, limit);

    const response: QuerySearchResponse = {
      project: proj.name,
      worktree: request.worktree,
      results: reranked.map((r) => ({
        relativePath: r.relativePath,
        content: r.content,
        score: r._score,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        chunkIndex: r.chunkIndex,
      })),
      count: reranked.length,
    };
    jsonResponse(res, 200, response);
    return;
  }

  // Single worktree search
  if (request.worktree) {
    const wt = await getWorktree(db, request.worktree);
    if (!wt) {
      jsonResponse(res, 404, { error: `Worktree "${request.worktree}" not found` });
      return;
    }

    const embedClient = createEmbeddingClient({ model: wt.model });
    const queryResult = await embedClient.embed(query);
    const queryEmbedding = queryResult.embeddings[0];
    if (!queryEmbedding) {
      jsonResponse(res, 500, { error: 'Failed to generate query embedding' });
      return;
    }
    const queryVector = new Float32Array(queryEmbedding);

    const searchResults = await searchSharedChunksForWorktree(
      db, queryVector, wt.id, { limit: limit * 2, model: wt.model },
    );
    const reranked = rerankerWithMMR(searchResults, queryVector, diversity).slice(0, limit);

    const response: QuerySearchResponse = {
      worktree: wt.name,
      results: reranked.map((r) => ({
        relativePath: r.relativePath,
        content: r.content,
        score: r._score,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        chunkIndex: r.chunkIndex,
      })),
      count: reranked.length,
    };
    jsonResponse(res, 200, response);
    return;
  }

  jsonResponse(res, 400, { error: 'Either --project or --worktree is required for server search' });
}

async function handleHealth(db: IndexDatabase, authToken: string | null, res: ServerResponse): Promise<void> {
  const poolStats = db.pool
    ? {
        totalCount: db.pool.totalCount,
        idleCount: db.pool.idleCount,
        waitingCount: db.pool.waitingCount,
      }
    : null;
  let pgConnected = false;
  try {
    if (db.pool) {
      await db.pool.query('SELECT 1');
      pgConnected = true;
    }
  } catch { /* not connected */ }

  await ensureProjectTables(db);
  await ensureWorktreeTables(db);
  const projects = await listProjects(db);
  const worktrees = await listWorktrees(db);

  let sharedChunks = 0;
  let uniqueHashes = 0;
  if (db.pool) {
    try {
      const chunkResult = await db.pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM "lgrep_shared_chunks"');
      sharedChunks = parseInt(chunkResult.rows[0]?.count ?? '0', 10);
      const hashResult = await db.pool.query<{ count: string }>('SELECT COUNT(DISTINCT content_hash) AS count FROM "lgrep_shared_chunks"');
      uniqueHashes = parseInt(hashResult.rows[0]?.count ?? '0', 10);
    } catch { /* tables may not exist */ }
  }

  const uptime = state ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : 0;
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  const response: QueryHealthResponse = {
    status: pgConnected ? 'healthy' : 'degraded',
    uptime: `${hours}h ${minutes}m`,
    auth: {
      enabled: Boolean(authToken),
      tokenEnv: authToken ? DEFAULT_SERVER_AUTH_TOKEN_ENV : undefined,
    },
    postgres: {
      connected: pgConnected,
      pool_size: poolStats?.totalCount ?? 0,
      active_connections: (poolStats?.totalCount ?? 0) - (poolStats?.idleCount ?? 0),
      idle_connections: poolStats?.idleCount ?? 0,
    },
    stats: {
      projects: projects.length,
      worktrees: worktrees.length,
      shared_chunks: sharedChunks,
      unique_content_hashes: uniqueHashes,
    },
  };

  jsonResponse(res, 200, response);
}

function unauthorizedResponse(res: ServerResponse): void {
  res.setHeader('WWW-Authenticate', 'Bearer realm="lgrep"');
  jsonResponse(res, 401, {
    error: `Unauthorized. Set ${DEFAULT_SERVER_AUTH_TOKEN_ENV} and send it as a Bearer token.`,
  });
}

async function handleRequest(
  db: IndexDatabase,
  authToken: string | null,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!isAuthorizedRequest(req, authToken)) {
    unauthorizedResponse(res);
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    await handleHealth(db, authToken, res);
    return;
  }

  if (req.url === '/query' && req.method === 'POST') {
    const body = await readBody(req);
    let request: QueryRequest;
    try {
      request = JSON.parse(body);
    } catch {
      jsonResponse(res, 400, { error: 'Invalid JSON' });
      return;
    }

    switch (request.method) {
      case 'search':
        await handleSearch(db, request, res);
        return;
      case 'health':
        await handleHealth(db, authToken, res);
        return;
      case 'worktrees': {
        await ensureWorktreeTables(db);
        let projectId: string | undefined;
        if (request.project) {
          await ensureProjectTables(db);
          const proj = await getProject(db, request.project);
          if (proj) projectId = proj.id;
        }
        const wts = await listWorktrees(db, projectId ? { projectId } : undefined);
        jsonResponse(res, 200, { worktrees: wts });
        return;
      }
      case 'projects': {
        await ensureProjectTables(db);
        const projs = await listProjects(db);
        jsonResponse(res, 200, { projects: projs });
        return;
      }
      case 'project-info': {
        await ensureProjectTables(db);
        const proj = await getProject(db, request.project ?? '');
        if (!proj) {
          jsonResponse(res, 404, { error: 'Project not found' });
          return;
        }
        const stats = await getProjectStats(db, proj.id);
        jsonResponse(res, 200, { project: proj, stats });
        return;
      }
      case 'diff': {
        const a = request.params['a'] as string;
        const b = request.params['b'] as string;
        if (!a || !b) {
          jsonResponse(res, 400, { error: 'a and b worktree names are required' });
          return;
        }
        await ensureWorktreeTables(db);
        const wtA = await getWorktree(db, a);
        const wtB = await getWorktree(db, b);
        if (!wtA || !wtB) {
          jsonResponse(res, 404, { error: 'One or both worktrees not found' });
          return;
        }
        const diffs = await diffWorktrees(db, wtA.id, wtB.id);
        jsonResponse(res, 200, { diffs });
        return;
      }
      default:
        jsonResponse(res, 400, { error: `Unknown method: ${request.method}` });
    }
    return;
  }

  jsonResponse(res, 404, { error: 'Not found. Use POST /query or GET /health' });
}

/**
 * Start the lgrep query server.
 */
export function startQueryServer(
  port: number,
  db: IndexDatabase,
  options: {
    authToken?: string | null;
  } = {},
): Server {
  const authToken = options.authToken ?? null;
  state = { db, startedAt: new Date(), authToken };

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(db, authToken, req, res);
    } catch (err) {
      jsonResponse(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(port, () => {
    console.log(`lgrep query server listening on port ${port}${authToken ? ' (auth enabled)' : ' (auth disabled)'}`);
  });

  return server;
}
