import { resolve, basename } from 'node:path';
import { access } from 'node:fs/promises';
import { DaemonManager } from '../../daemon/manager.js';
import { openDatabase, getIndex } from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';
import { runIndexCommand } from './index.js';

/**
 * Options for the watch command.
 */
export interface WatchOptions {
  name?: string;
  json?: boolean;
}

/**
 * Result of the watch command.
 */
export interface WatchResult {
  success: boolean;
  indexName: string;
  pid: number;
  path: string;
  error?: string;
}

/**
 * Run the watch command.
 *
 * @param path - Path to watch
 * @param options - Watch options
 * @returns Watch result
 */
export async function runWatchCommand(
  path: string,
  options: WatchOptions = {}
): Promise<WatchResult> {
  const absolutePath = resolve(path);

  // Verify path exists
  try {
    await access(absolutePath);
  } catch {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  // Determine index name
  const indexName = options.name ?? basename(absolutePath);

  // Check if index exists, create if needed
  const dbPath = getDbPath();
  const db = await openDatabase(dbPath);
  try {
    const existingIndex = await getIndex(db, indexName);

    if (!existingIndex) {
      // Index doesn't exist - create it first
      await runIndexCommand(absolutePath, {
        name: indexName,
        mode: 'create',
        showProgress: true,
      });
    }
  } finally {
    await db.close();
  }

  // Create daemon manager
  const manager = new DaemonManager();

  // Check if watcher is already running
  const existingDaemon = await manager.status(indexName);
  if (existingDaemon && existingDaemon.status === 'running') {
    throw new Error(`Watcher for "${indexName}" is already running`);
  }

  // Start the watcher daemon
  const daemonInfo = await manager.start(indexName, absolutePath);

  return {
    success: true,
    indexName: daemonInfo.indexName,
    pid: daemonInfo.pid,
    path: daemonInfo.rootPath,
  };
}
