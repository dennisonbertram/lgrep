import { existsSync } from 'node:fs';
import { openDatabase, listIndexes, deleteIndex } from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';

/**
 * Options for the clean command.
 */
export interface CleanOptions {
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/**
 * Result of the clean command.
 */
export interface CleanResult {
  zombiesFound: number;
  deleted: number;
  zombies: Array<{
    name: string;
    createdAt: string;
    ageInHours: number;
  }>;
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
  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    const message = 'No zombie indexes found.';
    if (options.json) {
      return JSON.stringify({
        command: 'clean',
        message,
        data: {
          zombiesFound: 0,
          deleted: 0,
          zombies: [],
        },
      });
    }
    return message;
  }

  const db = await openDatabase(dbPath);

  try {
    // Get all indexes
    const indexes = await listIndexes(db);

    // Filter for zombie indexes (stuck in building state with 0 chunks)
    const zombies = indexes.filter(
      idx => idx.metadata.status === 'building' && idx.metadata.chunkCount === 0
    );

    if (zombies.length === 0) {
      const message = 'No zombie indexes found.';
      if (options.json) {
        return JSON.stringify({
          command: 'clean',
          message,
          data: {
            zombiesFound: 0,
            deleted: 0,
            zombies: [],
          },
        });
      }
      return message;
    }

    // Build zombie info list
    const zombieInfo = zombies.map(z => ({
      name: z.name,
      createdAt: z.metadata.createdAt,
      ageInHours: calculateAgeInHours(z.metadata.createdAt),
    }));

    // Dry-run mode - show what would be deleted
    if (options.dryRun) {
      const lines: string[] = [
        `Found ${zombies.length} zombie index(es) stuck in "building" state:\n`,
      ];

      for (const info of zombieInfo) {
        lines.push(`  ${info.name}`);
        lines.push(`    Created: ${info.createdAt} (${info.ageInHours}h ago)`);
      }

      lines.push(
        `\nWould delete ${zombies.length} index(es). Run without --dry-run to delete.`
      );

      const textOutput = lines.join('\n');
      if (options.json) {
        return JSON.stringify({
          command: 'clean',
          message: textOutput,
          data: {
            zombiesFound: zombies.length,
            deleted: 0,
            zombies: zombieInfo,
          },
        });
      }
      return textOutput;
    }

    // Delete mode (requires --force in production)
    let deleteCount = 0;
    const deletedNames: string[] = [];

    for (const zombie of zombies) {
      const deleted = await deleteIndex(db, zombie.name);
      if (deleted) {
        deleteCount++;
        deletedNames.push(zombie.name);
      }
    }

    const lines: string[] = [`Deleted ${deleteCount} zombie index(es):\n`];

    for (const info of zombieInfo) {
      if (deletedNames.includes(info.name)) {
        lines.push(`  ${info.name} (${info.ageInHours}h old)`);
      }
    }

    const textOutput = lines.join('\n');
    if (options.json) {
      // Return clean JSON structure directly instead of using formatAsJson
      // which doesn't have a handler for 'clean' command type
      return JSON.stringify({
        command: 'clean',
        message: textOutput,
        data: {
          zombiesFound: zombies.length,
          deleted: deleteCount,
          zombies: zombieInfo,
        },
      });
    }
    return textOutput;
  } finally {
    await db.close();
  }
}
