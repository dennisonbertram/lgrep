import { openDatabase, listIndexes, type IndexHandle } from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';

/**
 * Run the list command.
 *
 * @returns Output string to display
 */
export async function runListCommand(): Promise<string> {
  const dbPath = getDbPath();
  const db = await openDatabase(dbPath);

  try {
    const indexes = await listIndexes(db);

    if (indexes.length === 0) {
      return 'No indexes found. Use `mgrep index <path>` to create one.';
    }

    return formatIndexList(indexes);
  } finally {
    await db.close();
  }
}

/**
 * Format the list of indexes for display.
 */
function formatIndexList(indexes: IndexHandle[]): string {
  const lines: string[] = ['Indexes:', ''];

  for (const index of indexes) {
    const { metadata } = index;
    lines.push(`  ${index.name}`);
    lines.push(`    Path:   ${metadata.rootPath}`);
    lines.push(`    Model:  ${metadata.model}`);
    lines.push(`    Status: ${metadata.status}`);
    lines.push(`    Chunks: ${metadata.chunkCount}`);
    lines.push('');
  }

  return lines.join('\n');
}
