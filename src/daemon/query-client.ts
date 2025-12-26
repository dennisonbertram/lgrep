/**
 * Query client for daemon mode.
 * Connects to the query server via IPC for instant queries.
 */

import { createConnection, Socket } from 'node:net';
import { existsSync } from 'node:fs';
import { getSocketPath } from './query-server.js';

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
 * Query client for connecting to the daemon server.
 */
export class QueryClient {
  private socket: Socket | null = null;
  private socketPath: string;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  private buffer = '';

  constructor(indexName: string) {
    this.socketPath = getSocketPath(indexName);
  }

  /**
   * Check if the daemon is running for this index.
   */
  isServerRunning(): boolean {
    return existsSync(this.socketPath);
  }

  /**
   * Connect to the daemon server.
   */
  async connect(): Promise<void> {
    if (!this.isServerRunning()) {
      throw new Error('Daemon server is not running. Start it with: lgrep daemon start <index>');
    }

    return new Promise((resolve, reject) => {
      this.socket = createConnection(this.socketPath);

      this.socket.on('connect', () => {
        resolve();
      });

      this.socket.on('error', (err) => {
        reject(err);
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('close', () => {
        // Reject all pending requests
        for (const [, { reject }] of this.pendingRequests) {
          reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
        this.socket = null;
      });
    });
  }

  /**
   * Disconnect from the daemon server.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }

  /**
   * Handle incoming data from the server.
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete messages (newline-delimited JSON)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        const pending = this.pendingRequests.get(response.id as number);

        if (pending) {
          this.pendingRequests.delete(response.id as number);

          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (err) {
        console.error('[QueryClient] Failed to parse response:', err);
      }
    }
  }

  /**
   * Send a request to the server.
   */
  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.socket) {
      throw new Error('Not connected to daemon server');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.socket!.write(JSON.stringify(request) + '\n');

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Ping the server to check if it's alive.
   */
  async ping(): Promise<{ pong: boolean; indexName: string }> {
    return this.request('ping');
  }

  /**
   * Perform a semantic search.
   */
  async search(query: string, options?: { limit?: number; diversity?: number }): Promise<{
    query: string;
    indexName: string;
    results: Array<{
      filePath: string;
      relativePath: string;
      content: string;
      score: number;
      lineStart?: number;
      lineEnd?: number;
    }>;
    count: number;
  }> {
    return this.request('search', { query, ...options });
  }

  /**
   * Find callers of a symbol.
   */
  async callers(symbol: string): Promise<{
    symbol: string;
    callers: Array<{
      file: string;
      line: number;
      callerName?: string;
      callerKind?: string;
    }>;
    count: number;
  }> {
    return this.request('callers', { symbol });
  }

  /**
   * Analyze impact of changing a symbol.
   */
  async impact(symbol: string, depth?: number): Promise<{
    symbol: string;
    impactedSymbols: Array<{ name: string; level: number }>;
    affectedFiles: string[];
    totalImpacted: number;
  }> {
    return this.request('impact', { symbol, depth });
  }

  /**
   * Get dependencies and dependents of a file.
   */
  async deps(file: string): Promise<{
    file: string;
    dependencies: string[];
    dependents: string[];
  }> {
    return this.request('deps', { file });
  }

  /**
   * Find dead code (symbols with no callers).
   */
  async dead(kind?: string): Promise<{
    deadSymbols: Array<{
      name: string;
      kind: string;
      file: string;
      line: number;
    }>;
    count: number;
  }> {
    return this.request('dead', { kind });
  }

  /**
   * Find similar code to a symbol.
   */
  async similar(symbol: string, limit?: number): Promise<{
    symbol: string;
    similar: Array<{
      filePath: string;
      content: string;
      score: number;
      lineStart?: number;
    }>;
    count: number;
  }> {
    return this.request('similar', { symbol, limit });
  }

  /**
   * Detect circular dependencies.
   */
  async cycles(): Promise<{
    cycles: string[][];
    count: number;
  }> {
    return this.request('cycles');
  }

  /**
   * List symbols with optional filters.
   */
  async symbols(options?: {
    kind?: string;
    file?: string;
    exported?: boolean;
  }): Promise<{
    symbols: Array<{
      name: string;
      kind: string;
      file: string;
      line: number;
      exported: boolean;
      signature?: string;
    }>;
    count: number;
  }> {
    return this.request('symbols', options);
  }

  /**
   * Get index statistics.
   */
  async stats(): Promise<{
    indexName: string;
    totalSymbols: number;
    totalCalls: number;
    totalFiles: number;
    symbolsByKind: Record<string, number>;
    model: string;
  }> {
    return this.request('stats');
  }
}

/**
 * Create a client and connect to the daemon.
 */
export async function createQueryClient(indexName: string): Promise<QueryClient> {
  const client = new QueryClient(indexName);
  await client.connect();
  return client;
}

/**
 * Check if a daemon is running for the given index.
 */
export function isDaemonRunning(indexName: string): boolean {
  const socketPath = getSocketPath(indexName);
  return existsSync(socketPath);
}
