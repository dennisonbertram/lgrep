import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { openDatabase, getIndex, listIndexes, type IndexDatabase } from '../../storage/lance.js';
import { getCalls, getDependencies } from '../../storage/code-intel.js';
import type { CodeDependency, CallEdge } from '../../types/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { createSpinner } from '../utils/progress.js';
import type { IndexHandle } from '../../storage/lance.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
 
export type GraphMode = 'deps' | 'calls';
 
export interface GraphOptions {
  index?: string;
  /** Defaults to 0 (ephemeral). */
  port?: number;
  /** Auto-open browser (default true). */
  open?: boolean;
  /** Default graph mode. */
  mode?: GraphMode;
  /** Include external dependencies (default false). */
  external?: boolean;
  /** Output URL as JSON (server still runs). */
  json?: boolean;
  /** Disable progress spinner. */
  showProgress?: boolean;
}
 
export interface GraphCommandResult {
  success: boolean;
  indexName: string;
  url: string;
  port: number;
}
 
interface GraphApiResponse {
  mode: GraphMode;
  indexName: string;
  nodes: Array<{
    id: string;
    label: string;
    kind: 'file';
    path: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    kind: 'import' | 'call';
    count?: number;
  }>;
}
 
interface IndexListResponse {
  indexes: Array<{
    name: string;
    rootPath: string;
    status: string;
    model: string;
    chunkCount: number;
  }>;
}
 
/**
 * Run the graph command (starts a local web viewer).
 */
export async function runGraphCommand(
  options: GraphOptions = {}
): Promise<GraphCommandResult> {
  const showProgress = options.showProgress ?? true;
  const spinner = showProgress && !options.json ? createSpinner('Initializing...') : null;
 
  spinner?.start();
 
  // Resolve index name (explicit or auto-detected)
  let indexName: string;
  if (options.index) {
    indexName = options.index;
  } else {
    spinner?.update('Auto-detecting index for current directory...');
    const detected = await detectIndexForDirectory();
    if (!detected) {
      throw new Error(
        'No index found for current directory. Either:\n' +
        '  1. Use --index <name> to specify an index\n' +
        '  2. Run `lgrep index .` to index the current directory\n' +
        '  3. Navigate to an indexed directory'
      );
    }
    indexName = detected;
  }
 
  spinner?.update('Opening database...');
  const dbPath = getDbPath();
  const db = await openDatabase(dbPath);
 
  // Validate index exists before starting server
  spinner?.update(`Loading index "${indexName}"...`);
  const handle = await getIndex(db, indexName);
  if (!handle) {
    throw new Error(`Index "${indexName}" not found`);
  }
 
  spinner?.update('Starting graph viewer server...');
  const mode: GraphMode = options.mode ?? 'deps';
  const includeExternal = options.external ?? false;
  const port = options.port ?? 0;
 
  const server = await startGraphServer({
    db,
    indexName,
    defaultMode: mode,
    includeExternal,
    port,
  });
 
  const url = server.url;
 
  spinner?.succeed(`Graph viewer running at ${url}`);
 
  // Open browser unless disabled
  const shouldOpen = options.open ?? true;
  if (shouldOpen) {
    // Fire-and-forget; opening browser failures shouldn't kill the server
    void open(url);
  }
 
  if (options.json) {
    console.log(JSON.stringify({ url, port: server.port, indexName }, null, 2));
  } else {
    console.log(`\nGraph viewer: ${url}`);
    console.log('Press Ctrl+C to stop.');
  }
 
  // Keep the process alive via the HTTP server (no await needed).
  return { success: true, indexName, url, port: server.port };
}
 
async function startGraphServer(options: {
  db: IndexDatabase;
  indexName: string;
  defaultMode: GraphMode;
  includeExternal: boolean;
  port: number;
}): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const viewerDir = resolveViewerDistDir();
 
  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, {
        db: options.db,
        indexName: options.indexName,
        defaultMode: options.defaultMode,
        includeExternal: options.includeExternal,
        viewerDir,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify({ error: message }));
    }
  });
 
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
 
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to start server');
  }
 
  const actualPort = addr.port;
  const url = `http://127.0.0.1:${actualPort}/?index=${encodeURIComponent(options.indexName)}&mode=${encodeURIComponent(options.defaultMode)}&external=${options.includeExternal ? '1' : '0'}`;
 
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
 
  return { url, port: actualPort, close };
}
 
function resolveViewerDistDir(): string {
  // dist/cli/commands/graph.js -> dist/viewer
  const here = fileURLToPath(import.meta.url);
  const commandsDir = dirname(here);
  return join(commandsDir, '..', '..', 'viewer');
}
 
async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    db: IndexDatabase;
    indexName: string;
    defaultMode: GraphMode;
    includeExternal: boolean;
    viewerDir: string;
  }
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
 
  if (url.pathname === '/api/indexes') {
    const payload = await handleIndexes(ctx.db);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
    return;
  }
 
  if (url.pathname === '/api/graph') {
    const indexName = url.searchParams.get('index') ?? ctx.indexName;
    const mode = (url.searchParams.get('mode') as GraphMode) || ctx.defaultMode;
    const externalFlag = url.searchParams.get('external');
    const includeExternal = externalFlag ? externalFlag === '1' : ctx.includeExternal;
 
    // Validate index exists (fast metadata read)
    const handle = await getIndex(ctx.db, indexName);
    if (!handle) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: `Index "${indexName}" not found` }));
      return;
    }
 
    const payload = await handleGraph(ctx.db, handle, mode, includeExternal);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
    return;
  }
 
  // Static assets / SPA fallback
  await serveStatic(req, res, ctx.viewerDir);
}
 
async function handleIndexes(db: IndexDatabase): Promise<IndexListResponse> {
  const indexes = await listIndexes(db);
  return {
    indexes: indexes.map(i => ({
      name: i.name,
      rootPath: i.metadata.rootPath,
      status: i.metadata.status,
      model: i.metadata.model,
      chunkCount: i.metadata.chunkCount,
    })),
  };
}
 
async function handleGraph(
  db: IndexDatabase,
  handle: IndexHandle,
  mode: GraphMode,
  includeExternal: boolean
): Promise<GraphApiResponse> {
  if (mode === 'calls') {
    const calls = await getCalls(db, handle.name);
    return buildFileCallGraph(handle.name, calls);
  }
 
  const deps = await getDependencies(db, handle.name, { external: includeExternal });
  return buildDependencyGraph(handle.name, deps, includeExternal);
}
 
export function buildDependencyGraph(
  indexName: string,
  deps: CodeDependency[],
  includeExternal: boolean
): GraphApiResponse {
  const nodes = new Map<string, GraphApiResponse['nodes'][number]>();
  const edges = new Map<string, GraphApiResponse['edges'][number]>();
 
  for (const dep of deps) {
    if (!includeExternal && dep.isExternal) continue;
 
    const source = dep.sourceFile;
    const target = dep.resolvedPath || dep.targetModule;
    if (!source || !target) continue;
 
    if (!nodes.has(source)) {
      nodes.set(source, { id: source, label: shortLabel(source), kind: 'file', path: source });
    }
    if (!nodes.has(target)) {
      nodes.set(target, { id: target, label: shortLabel(target), kind: 'file', path: target });
    }
 
    const id = `${source}::${target}::import`;
    if (!edges.has(id)) {
      edges.set(id, { id, source, target, kind: 'import', count: 1 });
    } else {
      edges.get(id)!.count = (edges.get(id)!.count ?? 0) + 1;
    }
  }
 
  return {
    mode: 'deps',
    indexName,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}
 
export function buildFileCallGraph(
  indexName: string,
  calls: CallEdge[]
): GraphApiResponse {
  const nodes = new Map<string, GraphApiResponse['nodes'][number]>();
  const edges = new Map<string, GraphApiResponse['edges'][number]>();
 
  for (const call of calls) {
    const source = call.callerFile;
    const target = call.calleeFile;
    if (!source || !target) continue;
 
    if (!nodes.has(source)) {
      nodes.set(source, { id: source, label: shortLabel(source), kind: 'file', path: source });
    }
    if (!nodes.has(target)) {
      nodes.set(target, { id: target, label: shortLabel(target), kind: 'file', path: target });
    }
 
    const id = `${source}::${target}::call`;
    if (!edges.has(id)) {
      edges.set(id, { id, source, target, kind: 'call', count: 1 });
    } else {
      edges.get(id)!.count = (edges.get(id)!.count ?? 0) + 1;
    }
  }
 
  return {
    mode: 'calls',
    indexName,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}
 
function shortLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts.slice(-2).join('/');
}
 
async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
 
  // Basic path traversal protection
  const candidate = join(rootDir, pathname);
  if (!candidate.startsWith(rootDir)) {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }
 
  try {
    const body = await readFile(candidate);
    res.statusCode = 200;
    res.setHeader('content-type', contentType(candidate));
    res.setHeader('cache-control', candidate.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable');
    res.end(body);
  } catch {
    // SPA fallback: serve index.html for unknown routes
    try {
      const body = await readFile(join(rootDir, 'index.html'));
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(body);
    } catch {
      res.statusCode = 500;
      res.end('Graph viewer assets not found. Run `npm run build:viewer` (or `npm run build`) to generate them.');
    }
  }
}
 
function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.ico':
      return 'image/x-icon';
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}
