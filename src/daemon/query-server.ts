/**
 * Query server for daemon mode.
 * Keeps the index loaded in memory for instant queries via IPC.
 */

import { createServer, Socket, Server } from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getLgrepHome } from '../cli/utils/paths.js';
import { openDatabase, getIndex, searchChunks, rerankerWithMMR, type Database, type IndexHandle } from '../storage/lance.js';
import { getCalls, searchSymbols, getSymbols, type CallRelation, type SymbolRecord } from '../storage/code-intel.js';
import { createEmbeddingClient, type EmbeddingClient } from '../core/embeddings.js';
import { loadConfig } from '../storage/config.js';
import { getDbPath } from '../cli/utils/paths.js';

/**
 * JSON-RPC request format.
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC response format.
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Query server that keeps index in memory.
 */
export class QueryServer {
  private server: Server | null = null;
  private socketPath: string;
  private db: Database | null = null;
  private indexHandle: IndexHandle | null = null;
  private embedClient: EmbeddingClient | null = null;
  private allCalls: CallRelation[] | null = null;
  private allSymbols: SymbolRecord[] | null = null;
  private indexName: string;
  private isShuttingDown = false;

  constructor(indexName: string) {
    this.indexName = indexName;
    this.socketPath = getSocketPath(indexName);
  }

  /**
   * Initialize the server by loading the index into memory.
   */
  async initialize(): Promise<void> {
    // Load config
    await loadConfig();

    // Open database
    const dbPath = getDbPath();
    this.db = await openDatabase(dbPath);

    // Get the index
    this.indexHandle = await getIndex(this.db, this.indexName);
    if (!this.indexHandle) {
      throw new Error(`Index "${this.indexName}" not found`);
    }

    // Create embedding client
    this.embedClient = createEmbeddingClient({ model: this.indexHandle.metadata.model });

    // Pre-load call graph and symbols for fast queries
    this.allCalls = await getCalls(this.db, this.indexName);
    this.allSymbols = await getSymbols(this.db, this.indexName);

    console.log(`[QueryServer] Index "${this.indexName}" loaded into memory`);
    console.log(`[QueryServer] ${this.allSymbols.length} symbols, ${this.allCalls.length} calls cached`);
  }

  /**
   * Start listening for connections.
   */
  async start(): Promise<void> {
    // Clean up stale socket file
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        console.error('[QueryServer] Server error:', err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        console.log(`[QueryServer] Listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Stop the server.
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log('[QueryServer] Shutting down...');

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
    }

    if (this.db) {
      await this.db.close();
    }

    // Clean up socket file
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    console.log('[QueryServer] Stopped');
  }

  /**
   * Handle a client connection.
   */
  private handleConnection(socket: Socket): void {
    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited JSON)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line) as JsonRpcRequest;
          const response = await this.handleRequest(request);
          socket.write(JSON.stringify(response) + '\n');
        } catch (err) {
          const errorResponse: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 0,
            error: {
              code: -32700,
              message: 'Parse error',
              data: err instanceof Error ? err.message : String(err),
            },
          };
          socket.write(JSON.stringify(errorResponse) + '\n');
        }
      }
    });

    socket.on('error', (err) => {
      console.error('[QueryServer] Socket error:', err);
    });
  }

  /**
   * Handle a JSON-RPC request.
   */
  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params = {} } = request;

    try {
      let result: unknown;

      switch (method) {
        case 'ping':
          result = { pong: true, indexName: this.indexName };
          break;

        case 'search':
          result = await this.handleSearch(params);
          break;

        case 'callers':
          result = await this.handleCallers(params);
          break;

        case 'impact':
          result = await this.handleImpact(params);
          break;

        case 'deps':
          result = await this.handleDeps(params);
          break;

        case 'dead':
          result = await this.handleDead(params);
          break;

        case 'similar':
          result = await this.handleSimilar(params);
          break;

        case 'cycles':
          result = await this.handleCycles();
          break;

        case 'symbols':
          result = await this.handleSymbols(params);
          break;

        case 'stats':
          result = await this.handleStats();
          break;

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
      }

      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  /**
   * Handle semantic search.
   */
  private async handleSearch(params: Record<string, unknown>): Promise<unknown> {
    const query = params.query as string;
    const limit = (params.limit as number) ?? 10;
    const diversity = (params.diversity as number) ?? 0.7;

    if (!query) {
      throw new Error('Missing required parameter: query');
    }

    if (!this.embedClient || !this.indexHandle || !this.db) {
      throw new Error('Server not initialized');
    }

    // Embed the query
    const queryResult = await this.embedClient.embed(query);
    const queryEmbedding = queryResult.embeddings[0];
    if (!queryEmbedding) {
      throw new Error('Failed to generate embedding for query');
    }
    const queryVector = new Float32Array(queryEmbedding);

    // Search for similar chunks
    const searchResults = await searchChunks(this.db, this.indexHandle, queryVector, { limit });

    // Apply MMR reranking
    const rerankedResults = rerankerWithMMR(searchResults, queryVector, diversity);

    return {
      query,
      indexName: this.indexName,
      results: rerankedResults.map((r) => ({
        filePath: r.filePath,
        relativePath: r.relativePath,
        content: r.content,
        score: r._score,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
      })),
      count: rerankedResults.length,
    };
  }

  /**
   * Handle callers query.
   */
  private async handleCallers(params: Record<string, unknown>): Promise<unknown> {
    const symbol = params.symbol as string;

    if (!symbol) {
      throw new Error('Missing required parameter: symbol');
    }

    if (!this.allCalls || !this.allSymbols) {
      throw new Error('Server not initialized');
    }

    // Find matching symbols
    const matchingSymbols = this.allSymbols.filter(
      (s) => s.name === symbol || s.name.includes(symbol)
    );

    if (matchingSymbols.length === 0) {
      return { symbol, callers: [], count: 0 };
    }

    // Find callers
    const callers: Array<{ file: string; line: number; callerName?: string; callerKind?: string }> = [];

    for (const sym of matchingSymbols) {
      const calls = this.allCalls.filter(
        (c) => c.calleeName === sym.name || c.calleeId === sym.id
      );

      for (const call of calls) {
        const caller = this.allSymbols.find((s) => s.id === call.callerId);
        callers.push({
          file: call.callerFile,
          line: call.position.line,
          callerName: caller?.name,
          callerKind: caller?.kind,
        });
      }
    }

    return { symbol, callers, count: callers.length };
  }

  /**
   * Handle impact analysis (transitive callers).
   */
  private async handleImpact(params: Record<string, unknown>): Promise<unknown> {
    const symbol = params.symbol as string;
    const depth = (params.depth as number) ?? 3;

    if (!symbol) {
      throw new Error('Missing required parameter: symbol');
    }

    if (!this.allCalls || !this.allSymbols) {
      throw new Error('Server not initialized');
    }

    // Build caller graph
    const callerGraph = new Map<string, Set<string>>();
    for (const call of this.allCalls) {
      if (!callerGraph.has(call.calleeName)) {
        callerGraph.set(call.calleeName, new Set());
      }
      if (call.callerId) {
        const caller = this.allSymbols.find((s) => s.id === call.callerId);
        if (caller) {
          callerGraph.get(call.calleeName)!.add(caller.name);
        }
      }
    }

    // BFS to find transitive callers
    const visited = new Set<string>();
    const queue: Array<{ name: string; level: number }> = [{ name: symbol, level: 0 }];
    const impactedSymbols: Array<{ name: string; level: number }> = [];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.name) || current.level > depth) {
        continue;
      }
      visited.add(current.name);

      if (current.level > 0) {
        impactedSymbols.push(current);
      }

      const callers = callerGraph.get(current.name);
      if (callers) {
        for (const caller of callers) {
          queue.push({ name: caller, level: current.level + 1 });
        }
      }
    }

    // Get affected files
    const affectedFiles = new Set<string>();
    for (const impacted of impactedSymbols) {
      const sym = this.allSymbols.find((s) => s.name === impacted.name);
      if (sym) {
        affectedFiles.add(sym.filePath);
      }
    }

    return {
      symbol,
      impactedSymbols,
      affectedFiles: Array.from(affectedFiles),
      totalImpacted: impactedSymbols.length,
    };
  }

  /**
   * Handle dependency query.
   */
  private async handleDeps(params: Record<string, unknown>): Promise<unknown> {
    const file = params.file as string;

    if (!file) {
      throw new Error('Missing required parameter: file');
    }

    if (!this.allCalls || !this.allSymbols) {
      throw new Error('Server not initialized');
    }

    // Find symbols in the file
    const fileSymbols = this.allSymbols.filter((s) => s.filePath.endsWith(file));

    // Find what this file depends on (callees)
    const dependencies = new Set<string>();
    for (const sym of fileSymbols) {
      const calls = this.allCalls.filter((c) => c.callerId === sym.id);
      for (const call of calls) {
        const callee = this.allSymbols.find((s) => s.id === call.calleeId || s.name === call.calleeName);
        if (callee && !callee.filePath.endsWith(file)) {
          dependencies.add(callee.filePath);
        }
      }
    }

    // Find what depends on this file (callers)
    const dependents = new Set<string>();
    for (const sym of fileSymbols) {
      const calls = this.allCalls.filter((c) => c.calleeId === sym.id || c.calleeName === sym.name);
      for (const call of calls) {
        if (!call.callerFile.endsWith(file)) {
          dependents.add(call.callerFile);
        }
      }
    }

    return {
      file,
      dependencies: Array.from(dependencies),
      dependents: Array.from(dependents),
    };
  }

  /**
   * Handle dead code detection.
   */
  private async handleDead(params: Record<string, unknown>): Promise<unknown> {
    const kind = params.kind as string | undefined;

    if (!this.allCalls || !this.allSymbols) {
      throw new Error('Server not initialized');
    }

    // Find symbols with zero callers
    const calledSymbols = new Set<string>();
    for (const call of this.allCalls) {
      if (call.calleeId) calledSymbols.add(call.calleeId);
      if (call.calleeName) calledSymbols.add(call.calleeName);
    }

    const deadSymbols = this.allSymbols.filter((sym) => {
      // Filter by kind if specified
      if (kind && sym.kind !== kind) return false;

      // Skip if symbol is called
      if (calledSymbols.has(sym.id) || calledSymbols.has(sym.name)) return false;

      // Skip exported symbols (they might be used externally)
      if (sym.isExported) return false;

      // Skip certain kinds that are typically entry points
      if (['module', 'namespace', 'interface', 'type'].includes(sym.kind)) return false;

      return true;
    });

    return {
      deadSymbols: deadSymbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        file: s.filePath,
        line: s.range.start.line,
      })),
      count: deadSymbols.length,
    };
  }

  /**
   * Handle similar symbol search.
   */
  private async handleSimilar(params: Record<string, unknown>): Promise<unknown> {
    const symbol = params.symbol as string;
    const limit = (params.limit as number) ?? 10;

    if (!symbol) {
      throw new Error('Missing required parameter: symbol');
    }

    if (!this.allSymbols || !this.embedClient || !this.db || !this.indexHandle) {
      throw new Error('Server not initialized');
    }

    // Find the symbol
    const targetSymbol = this.allSymbols.find((s) => s.name === symbol);
    if (!targetSymbol) {
      throw new Error(`Symbol "${symbol}" not found`);
    }

    // Use semantic search with the symbol's signature or name
    const searchText = targetSymbol.signature || targetSymbol.name;
    const queryResult = await this.embedClient.embed(searchText);
    const queryEmbedding = queryResult.embeddings[0];
    if (!queryEmbedding) {
      throw new Error('Failed to generate embedding');
    }

    const queryVector = new Float32Array(queryEmbedding);
    const searchResults = await searchChunks(this.db, this.indexHandle, queryVector, { limit: limit + 1 });

    // Filter out the original symbol
    const similar = searchResults
      .filter((r) => !r.content.includes(targetSymbol.name))
      .slice(0, limit);

    return {
      symbol,
      similar: similar.map((r) => ({
        filePath: r.filePath,
        content: r.content,
        score: r._score,
        lineStart: r.lineStart,
      })),
      count: similar.length,
    };
  }

  /**
   * Handle cycle detection.
   */
  private async handleCycles(): Promise<unknown> {
    if (!this.allCalls || !this.allSymbols) {
      throw new Error('Server not initialized');
    }

    // Build import graph (file -> files it imports)
    const importGraph = new Map<string, Set<string>>();
    for (const call of this.allCalls) {
      const callerFile = call.callerFile;
      const callee = this.allSymbols.find((s) => s.id === call.calleeId || s.name === call.calleeName);
      if (callee && callerFile !== callee.filePath) {
        if (!importGraph.has(callerFile)) {
          importGraph.set(callerFile, new Set());
        }
        importGraph.get(callerFile)!.add(callee.filePath);
      }
    }

    // DFS to find cycles
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    function dfs(node: string): void {
      if (recursionStack.has(node)) {
        // Found a cycle
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), node]);
        }
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const deps = importGraph.get(node);
      if (deps) {
        for (const dep of deps) {
          dfs(dep);
        }
      }

      path.pop();
      recursionStack.delete(node);
    }

    for (const file of importGraph.keys()) {
      dfs(file);
    }

    return {
      cycles,
      count: cycles.length,
    };
  }

  /**
   * Handle symbol listing.
   */
  private async handleSymbols(params: Record<string, unknown>): Promise<unknown> {
    const kind = params.kind as string | undefined;
    const file = params.file as string | undefined;
    const exported = params.exported as boolean | undefined;

    if (!this.allSymbols) {
      throw new Error('Server not initialized');
    }

    let symbols = this.allSymbols;

    if (kind) {
      symbols = symbols.filter((s) => s.kind === kind);
    }

    if (file) {
      symbols = symbols.filter((s) => s.filePath.endsWith(file));
    }

    if (exported !== undefined) {
      symbols = symbols.filter((s) => s.isExported === exported);
    }

    return {
      symbols: symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        file: s.filePath,
        line: s.range.start.line,
        exported: s.isExported,
        signature: s.signature,
      })),
      count: symbols.length,
    };
  }

  /**
   * Handle stats query.
   */
  private async handleStats(): Promise<unknown> {
    if (!this.allCalls || !this.allSymbols || !this.indexHandle) {
      throw new Error('Server not initialized');
    }

    // Count symbols by kind
    const symbolsByKind = new Map<string, number>();
    for (const sym of this.allSymbols) {
      symbolsByKind.set(sym.kind, (symbolsByKind.get(sym.kind) || 0) + 1);
    }

    // Count unique files
    const files = new Set(this.allSymbols.map((s) => s.filePath));

    return {
      indexName: this.indexName,
      totalSymbols: this.allSymbols.length,
      totalCalls: this.allCalls.length,
      totalFiles: files.size,
      symbolsByKind: Object.fromEntries(symbolsByKind),
      model: this.indexHandle.metadata.model,
    };
  }
}

/**
 * Get the socket path for an index.
 */
export function getSocketPath(indexName: string): string {
  return join(getLgrepHome(), 'sockets', `${indexName}.sock`);
}

/**
 * Ensure the sockets directory exists.
 */
export function ensureSocketsDir(): void {
  const socketsDir = join(getLgrepHome(), 'sockets');
  const fs = require('node:fs');
  if (!fs.existsSync(socketsDir)) {
    fs.mkdirSync(socketsDir, { recursive: true });
  }
}
