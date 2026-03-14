import { existsSync } from 'node:fs';
import { listIndexes, deleteIndex } from '../../storage/lance.js';
import {
  openConfiguredDatabase,
  getConfiguredDatabaseLocationSync,
  resolveDatabaseSettingsSync,
} from '../../storage/database-config.js';
import { DaemonManager } from '../../daemon/manager.js';

/**
 * Options for the clean command.
 */
export interface CleanOptions {
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  /** Clean failed indexes */
  failed?: boolean;
  /** Clean indexes with missing paths (stale) */
  stale?: boolean;
  /** Clean zombie indexes (stuck building with 0 chunks) */
  zombies?: boolean;
  /** Stop orphaned watchers */
  watchers?: boolean;
  /** Clean all types (default if no specific type given) */
  all?: boolean;
}

/**
 * Categorized index for cleanup.
 */
interface CleanableIndex {
  name: string;
  path: string;
  status: string;
  createdAt: string;
  ageInHours: number;
  reason: 'zombie' | 'failed' | 'stale';
}

/**
 * Result of the clean command.
 */
export interface CleanResult {
  zombiesFound: number;
  failedFound: number;
  staleFound: number;
  watchersStopped: number;
  deleted: number;
  indexes: CleanableIndex[];
}

/**
 * Calculate age in hours from ISO timestamp.
 */
function calculateAgeInHours(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  return Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10; // Round to 1 decimal
}

/**
 * Run the clean command.
 *
 * @param options - Clean options
 * @returns Output string to display
 */
export async function runCleanCommand(
  options: CleanOptions = {}
): Promise<string> {
  const settings = resolveDatabaseSettingsSync();
  const dbPath = getConfiguredDatabaseLocationSync();

  // If no specific type given, clean all
  const cleanAll = options.all || (!options.failed && !options.stale && !options.zombies && !options.watchers);
  const cleanFailed = cleanAll || options.failed;
  const cleanStale = cleanAll || options.stale;
  const cleanZombies = cleanAll || options.zombies;
  const cleanWatchers = cleanAll || options.watchers;

  if (settings.mode === 'local' && !existsSync(dbPath)) {
    const message = 'No indexes found to clean.';
    if (options.json) {
      return JSON.stringify({
        command: 'clean',
        message,
        data: {
          zombiesFound: 0,
          failedFound: 0,
          staleFound: 0,
          watchersStopped: 0,
          deleted: 0,
          indexes: [],
        },
      });
    }
    return message;
  }

  const db = await openConfiguredDatabase();
  const manager = new DaemonManager();

  try {
    // Get all indexes
    const indexes = await listIndexes(db);
    const cleanable: CleanableIndex[] = [];

    // Get running watchers
    const runningWatchers = await manager.list();

    // Categorize indexes for cleanup
    for (const idx of indexes) {
      const ageInHours = calculateAgeInHours(idx.metadata.createdAt);
      const pathExists = existsSync(idx.metadata.rootPath);

      // Zombie: stuck in building with 0 chunks
      if (cleanZombies && idx.metadata.status === 'building' && idx.metadata.chunkCount === 0) {
        cleanable.push({
          name: idx.name,
          path: idx.metadata.rootPath,
          status: idx.metadata.status,
          createdAt: idx.metadata.createdAt,
          ageInHours,
          reason: 'zombie',
        });
      }
      // Failed: in failed state
      else if (cleanFailed && idx.metadata.status === 'failed') {
        cleanable.push({
          name: idx.name,
          path: idx.metadata.rootPath,
          status: idx.metadata.status,
          createdAt: idx.metadata.createdAt,
          ageInHours,
          reason: 'failed',
        });
      }
      // Stale: path no longer exists
      else if (cleanStale && !pathExists) {
        cleanable.push({
          name: idx.name,
          path: idx.metadata.rootPath,
          status: idx.metadata.status,
          createdAt: idx.metadata.createdAt,
          ageInHours,
          reason: 'stale',
        });
      }
    }

    // Count by reason
    const zombiesFound = cleanable.filter(c => c.reason === 'zombie').length;
    const failedFound = cleanable.filter(c => c.reason === 'failed').length;
    const staleFound = cleanable.filter(c => c.reason === 'stale').length;

    // Stop all running watchers
    let watchersStopped = 0;
    if (cleanWatchers) {
      for (const watcher of runningWatchers) {
        if (!options.dryRun) {
          await manager.stop(watcher.indexName);
        }
        watchersStopped++;
      }
    }

    if (cleanable.length === 0 && watchersStopped === 0) {
      const message = 'Nothing to clean.';
      if (options.json) {
        return JSON.stringify({
          command: 'clean',
          message,
          data: {
            zombiesFound: 0,
            failedFound: 0,
            staleFound: 0,
            watchersStopped: 0,
            deleted: 0,
            indexes: [],
          },
        });
      }
      return message;
    }

    // Dry-run mode - show what would be deleted
    if (options.dryRun) {
      const lines: string[] = ['Would clean:\n'];

      if (zombiesFound > 0) {
        lines.push(`  Zombies (stuck building): ${zombiesFound}`);
        for (const c of cleanable.filter(c => c.reason === 'zombie')) {
          lines.push(`    - ${c.name} (${c.ageInHours}h old)`);
        }
      }
      if (failedFound > 0) {
        lines.push(`  Failed: ${failedFound}`);
        for (const c of cleanable.filter(c => c.reason === 'failed')) {
          lines.push(`    - ${c.name}`);
        }
      }
      if (staleFound > 0) {
        lines.push(`  Stale (path missing): ${staleFound}`);
        for (const c of cleanable.filter(c => c.reason === 'stale')) {
          lines.push(`    - ${c.name} (${c.path})`);
        }
      }
      if (watchersStopped > 0) {
        lines.push(`  Watchers to stop: ${watchersStopped}`);
      }

      lines.push(`\nRun without --dry-run to clean.`);

      const textOutput = lines.join('\n');
      if (options.json) {
        return JSON.stringify({
          command: 'clean',
          message: textOutput,
          data: {
            zombiesFound,
            failedFound,
            staleFound,
            watchersStopped,
            deleted: 0,
            indexes: cleanable,
          },
        });
      }
      return textOutput;
    }

    // Delete indexes
    let deleteCount = 0;
    for (const item of cleanable) {
      const deleted = await deleteIndex(db, item.name);
      if (deleted) {
        deleteCount++;
      }
    }

    const lines: string[] = ['Cleaned:\n'];
    if (zombiesFound > 0) lines.push(`  Zombies deleted: ${cleanable.filter(c => c.reason === 'zombie').length}`);
    if (failedFound > 0) lines.push(`  Failed deleted: ${cleanable.filter(c => c.reason === 'failed').length}`);
    if (staleFound > 0) lines.push(`  Stale deleted: ${cleanable.filter(c => c.reason === 'stale').length}`);
    if (watchersStopped > 0) lines.push(`  Watchers stopped: ${watchersStopped}`);
    lines.push(`\nTotal: ${deleteCount} index(es) deleted, ${watchersStopped} watcher(s) stopped`);

    const textOutput = lines.join('\n');
    if (options.json) {
      return JSON.stringify({
        command: 'clean',
        message: textOutput,
        data: {
          zombiesFound,
          failedFound,
          staleFound,
          watchersStopped,
          deleted: deleteCount,
          indexes: cleanable,
        },
      });
    }
    return textOutput;
  } finally {
    await db.close();
  }
}
