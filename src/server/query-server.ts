import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createEmbeddingClient } from '../core/embeddings.js';
import {
  authorizeServerRequest,
  filterProjectsForScope,
  filterWorktreesForScope,
  loadServerAuthConfig,
  scopeAllowsProject,
  scopeAllowsWorktree,
  type ServerAuthConfig,
  type ServerAccessScope,
  type ServerAuthDescriptor,
} from './auth.js';
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
  type Worktree,
  type WorktreeDiffEntry,
} from '../storage/worktree.js';
import {
  ensureProjectTables,
  getProject,
  listProjects,
  getProjectStats,
  type Project,
  type ProjectStats,
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
  auth: ServerAuthDescriptor;
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

export type RemoteProject = Omit<Project, 'excludePatterns' | 'metadata'> & {
  excludePatterns?: never;
  metadata?: never;
};

export type RemoteWorktree = Omit<Worktree, 'rootPath'> & {
  rootPath: null;
};

export interface QueryProjectsResponse {
  projects: RemoteProject[];
  count: number;
}

export interface QueryWorktreesResponse {
  project?: string;
  worktrees: RemoteWorktree[];
  count: number;
}

export interface QueryProjectInfoResponse {
  project: RemoteProject;
  stats: ProjectStats;
  worktrees: Array<{ name: string; status: string; branch: string | null; fileCount: number; chunkCount: number }>;
}

export interface QueryDiffResponse {
  a: string;
  b: string;
  diffs: WorktreeDiffEntry[];
  count: number;
}

interface ServerState {
  db: IndexDatabase;
  startedAt: Date;
  auth: ServerAuthConfig;
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

function sanitizeProject(project: Project): RemoteProject {
  const { excludePatterns: _excludePatterns, metadata: _metadata, ...remoteProject } = project;
  return remoteProject;
}

function sanitizeWorktree(worktree: Worktree): RemoteWorktree {
  return {
    ...worktree,
    rootPath: null,
  };
}

function forbiddenResponse(res: ServerResponse): void {
  jsonResponse(res, 403, {
    error: 'Forbidden. The provided token is not allowed to access that project or worktree.',
  });
}

async function handleSearch(
  db: IndexDatabase,
  scope: ServerAccessScope,
  request: QueryRequest,
  res: ServerResponse,
): Promise<void> {
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
    if (!scopeAllowsProject(scope, proj.id, proj.name)) {
      forbiddenResponse(res);
      return;
    }

    let worktreeId: string | undefined;
    if (request.worktree) {
      const wt = await getWorktree(db, request.worktree, { projectId: proj.id });
      if (!wt) {
        jsonResponse(res, 404, { error: `Worktree "${request.worktree}" not found in project "${proj.name}"` });
        return;
      }
      if (!scopeAllowsWorktree(scope, wt.id, wt.name)) {
        forbiddenResponse(res);
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
    let worktreeProjectName: string | null = null;
    if (wt.projectId) {
      await ensureProjectTables(db);
      const project = await getProject(db, wt.projectId);
      worktreeProjectName = project?.name ?? null;
    }
    if (!scopeAllowsWorktree(scope, wt.id, wt.name) || !scopeAllowsProject(scope, wt.projectId, worktreeProjectName)) {
      forbiddenResponse(res);
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

async function handleHealth(db: IndexDatabase, auth: ServerAuthConfig, res: ServerResponse): Promise<void> {
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
    auth: auth.descriptor,
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
    error: 'Unauthorized. Provide a valid bearer token for this hosted lgrep server.',
  });
}

async function handleRequest(
  db: IndexDatabase,
  auth: ServerAuthConfig,
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

  const authResult = authorizeServerRequest(req, auth);
  if (!authResult.authorized || !authResult.scope) {
    unauthorizedResponse(res);
    return;
  }
  const scope = authResult.scope;

  if (req.url === '/health' && req.method === 'GET') {
    await handleHealth(db, auth, res);
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
        await handleSearch(db, scope, request, res);
        return;
      case 'health':
        await handleHealth(db, auth, res);
        return;
      case 'worktrees': {
        await ensureWorktreeTables(db);
        let projectId: string | undefined;
        let projectName: string | undefined;
        let projectNamesById: Map<string, string> | undefined;
        if (request.project) {
          await ensureProjectTables(db);
          const proj = await getProject(db, request.project);
          if (proj) {
            if (!scopeAllowsProject(scope, proj.id, proj.name)) {
              forbiddenResponse(res);
              return;
            }
            projectId = proj.id;
            projectName = proj.name;
            projectNamesById = new Map([[proj.id, proj.name]]);
          }
        } else if (scope.projects) {
          await ensureProjectTables(db);
          const projects = await listProjects(db);
          projectNamesById = new Map(projects.map((project) => [project.id, project.name]));
        }
        const wts = await listWorktrees(db, projectId ? { projectId } : undefined);
        const visibleWorktrees = filterWorktreesForScope(wts, scope, projectNamesById).map(sanitizeWorktree);
        const response: QueryWorktreesResponse = {
          project: projectName,
          worktrees: visibleWorktrees,
          count: visibleWorktrees.length,
        };
        jsonResponse(res, 200, response);
        return;
      }
      case 'projects': {
        await ensureProjectTables(db);
        const projs = await listProjects(db);
        const visibleProjects = filterProjectsForScope(projs, scope).map(sanitizeProject);
        const response: QueryProjectsResponse = {
          projects: visibleProjects,
          count: visibleProjects.length,
        };
        jsonResponse(res, 200, response);
        return;
      }
      case 'project-info': {
        await ensureProjectTables(db);
        await ensureWorktreeTables(db);
        const proj = await getProject(db, request.project ?? '');
        if (!proj) {
          jsonResponse(res, 404, { error: 'Project not found' });
          return;
        }
        if (!scopeAllowsProject(scope, proj.id, proj.name)) {
          forbiddenResponse(res);
          return;
        }
        const stats = await getProjectStats(db, proj.id);
        const worktrees = (await listWorktrees(db, { projectId: proj.id }))
          .filter((worktree) => scopeAllowsWorktree(scope, worktree.id, worktree.name));
        const response: QueryProjectInfoResponse = {
          project: sanitizeProject(proj),
          stats,
          worktrees: worktrees.map((worktree) => ({
            name: worktree.name,
            status: worktree.status,
            branch: worktree.branch,
            fileCount: worktree.fileCount,
            chunkCount: worktree.chunkCount,
          })),
        };
        jsonResponse(res, 200, response);
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
        await ensureProjectTables(db);
        const projectA = wtA.projectId ? await getProject(db, wtA.projectId) : null;
        const projectB = wtB.projectId ? await getProject(db, wtB.projectId) : null;
        if (
          !scopeAllowsWorktree(scope, wtA.id, wtA.name)
          || !scopeAllowsWorktree(scope, wtB.id, wtB.name)
          || !scopeAllowsProject(scope, wtA.projectId, projectA?.name ?? null)
          || !scopeAllowsProject(scope, wtB.projectId, projectB?.name ?? null)
        ) {
          forbiddenResponse(res);
          return;
        }
        const diffs = await diffWorktrees(db, wtA.id, wtB.id);
        const response: QueryDiffResponse = {
          a: wtA.name,
          b: wtB.name,
          diffs,
          count: diffs.length,
        };
        jsonResponse(res, 200, response);
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
    auth?: ServerAuthConfig;
  } = {},
): Server {
  const auth = options.auth ?? loadServerAuthConfig();
  state = { db, startedAt: new Date(), auth };

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(db, auth, req, res);
    } catch (err) {
      jsonResponse(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(port, () => {
    console.log(`lgrep query server listening on port ${port}${auth.descriptor.enabled ? ` (auth: ${auth.descriptor.mode})` : ' (auth disabled)'}`);
  });

  return server;
}
