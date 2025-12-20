import { resolve } from 'node:path';
import { openDatabase, listIndexes } from '../../storage/lance.js';
import { getDbPath } from './paths.js';

/**
 * Normalize a path for comparison by:
 * - Resolving to absolute path
 * - Removing trailing slashes
 */
function normalizePath(path: string): string {
  return resolve(path).replace(/\/+$/, '');
}

/**
 * Check if a directory is inside or equal to a root path.
 * Returns true if directory is at or below rootPath.
 */
function isInsidePath(directory: string, rootPath: string): boolean {
  const normalizedDir = normalizePath(directory);
  const normalizedRoot = normalizePath(rootPath);

  // Exact match
  if (normalizedDir === normalizedRoot) {
    return true;
  }

  // Check if directory starts with rootPath + separator
  return normalizedDir.startsWith(normalizedRoot + '/');
}

/**
 * Auto-detect which index applies to a given directory.
 *
 * Logic:
 * 1. List all indexes
 * 2. Find indexes where the directory is inside the index's rootPath
 * 3. Return the most specific match (deepest rootPath)
 * 4. Skip failed indexes
 *
 * @param directory - Directory to check (defaults to cwd)
 * @returns Index name if found, null otherwise
 */
export async function detectIndexForDirectory(
  directory?: string
): Promise<string | null> {
  const targetDir = directory ?? process.cwd();
  const dbPath = getDbPath();
  const db = await openDatabase(dbPath);

  try {
    const indexes = await listIndexes(db);

    if (indexes.length === 0) {
      return null;
    }

    // Find all matching indexes (where target is inside rootPath)
    const matches: Array<{ name: string; rootPath: string; depth: number }> = [];

    for (const index of indexes) {
      // Skip failed indexes
      if (index.metadata.status === 'failed') {
        continue;
      }

      const rootPath = index.metadata.rootPath;

      if (isInsidePath(targetDir, rootPath)) {
        // Calculate depth (number of path segments) for specificity
        const depth = normalizePath(rootPath).split('/').length;
        matches.push({
          name: index.name,
          rootPath,
          depth,
        });
      }
    }

    if (matches.length === 0) {
      return null;
    }

    // Return the most specific (deepest) match
    matches.sort((a, b) => b.depth - a.depth);
    return matches[0]!.name;
  } finally {
    await db.close();
  }
}
