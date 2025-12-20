import { existsSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { openDatabase, getIndex, listIndexes, getChunkCount } from '../../storage/lance.js';
import { getDbPath, getLgrepHome } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { getSymbols, getCalls, getDependencies } from '../../storage/code-intel.js';
import { DaemonManager } from '../../daemon/manager.js';

/**
 * Stats for a single index.
 */
export interface IndexStats {
  name: string;
  path: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  chunks: number;
  symbols: number;
  calls: number;
  dependencies: number;
  files: number;
  watcherRunning: boolean;
  watcherPid?: number;
}

/**
 * Overall stats result.
 */
export interface StatsResult {
  success: boolean;
  index?: IndexStats;
  all?: IndexStats[];
  totals?: {
    indexes: number;
    chunks: number;
    symbols: number;
    calls: number;
    dependencies: number;
  };
  dbPath: string;
  dbSizeBytes?: number;
  error?: string;
}

/**
 * Options for stats command.
 */
export interface StatsOptions {
  index?: string;
  all?: boolean;
  json?: boolean;
}

/**
 * Get stats for a single index.
 */
async function getIndexStats(
  db: Awaited<ReturnType<typeof openDatabase>>,
  indexName: string,
  manager: DaemonManager
): Promise<IndexStats | null> {
  const handle = await getIndex(db, indexName);
  if (!handle) return null;

  // Get counts
  const chunkCount = await getChunkCount(handle);
  const symbols = await getSymbols(handle);
  const calls = await getCalls(handle);
  const deps = await getDependencies(handle);

  // Get unique files from symbols
  const uniqueFiles = new Set(symbols.map(s => s.file));

  // Check watcher status
  const daemonInfo = await manager.status(indexName);

  return {
    name: indexName,
    path: handle.metadata.path,
    status: handle.metadata.status,
    createdAt: handle.metadata.createdAt,
    updatedAt: handle.metadata.updatedAt,
    model: handle.metadata.model,
    chunks: chunkCount,
    symbols: symbols.length,
    calls: calls.length,
    dependencies: deps.length,
    files: uniqueFiles.size,
    watcherRunning: daemonInfo?.status === 'running',
    watcherPid: daemonInfo?.pid,
  };
}

/**
 * Run the stats command.
 */
export async function runStatsCommand(options: StatsOptions = {}): Promise<StatsResult> {
  const dbPath = getDbPath();
  const lgrepHome = getLgrepHome();

  if (!existsSync(dbPath)) {
    return {
      success: false,
      dbPath,
      error: 'No indexes found. Run: lgrep index <path>',
    };
  }

  // Get database size
  let dbSizeBytes: number | undefined;
  try {
    const stat = statSync(dbPath);
    if (stat.isDirectory()) {
      // Sum up all files in the directory (approximate)
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(dbPath, { recursive: true, withFileTypes: true });
      dbSizeBytes = 0;
      for (const file of files) {
        if (file.isFile()) {
          try {
            const filePath = resolve(file.parentPath || file.path, file.name);
            dbSizeBytes += statSync(filePath).size;
          } catch {
            // Ignore files we can't stat
          }
        }
      }
    } else {
      dbSizeBytes = stat.size;
    }
  } catch {
    // Ignore
  }

  const db = await openDatabase(dbPath);
  const manager = new DaemonManager();

  try {
    // If --all, get stats for all indexes
    if (options.all) {
      const indexes = await listIndexes(db);
      const allStats: IndexStats[] = [];
      let totalChunks = 0;
      let totalSymbols = 0;
      let totalCalls = 0;
      let totalDeps = 0;

      for (const idx of indexes) {
        const stats = await getIndexStats(db, idx.name, manager);
        if (stats) {
          allStats.push(stats);
          totalChunks += stats.chunks;
          totalSymbols += stats.symbols;
          totalCalls += stats.calls;
          totalDeps += stats.dependencies;
        }
      }

      return {
        success: true,
        all: allStats,
        totals: {
          indexes: allStats.length,
          chunks: totalChunks,
          symbols: totalSymbols,
          calls: totalCalls,
          dependencies: totalDeps,
        },
        dbPath,
        dbSizeBytes,
      };
    }

    // Get specific index or auto-detect
    let indexName = options.index;
    if (!indexName) {
      const detected = await detectIndexForDirectory(process.cwd());
      if (detected) {
        indexName = detected.indexName;
      } else {
        // Try directory name
        indexName = basename(process.cwd());
      }
    }

    const stats = await getIndexStats(db, indexName, manager);
    if (!stats) {
      return {
        success: false,
        dbPath,
        dbSizeBytes,
        error: `Index "${indexName}" not found. Run: lgrep list`,
      };
    }

    return {
      success: true,
      index: stats,
      dbPath,
      dbSizeBytes,
    };
  } finally {
    await db.close();
  }
}
