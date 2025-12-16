import { openDatabase, listIndexes, type IndexHandle } from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';
import { formatAsJson } from './json-formatter.js';

/**
 * Run the list command.
 *
 * @param json - Output as JSON if true
 * @returns Output string to display
 */
export async function runListCommand(json?: boolean): Promise<string> {
  const dbPath = getDbPath();
  const db = await openDatabase(dbPath);

  try {
    const indexes = await listIndexes(db);

    if (indexes.length === 0) {
      const message = 'No indexes found. Use `lgrep index <path>` to create one.';
      if (json) {
        return formatAsJson('list', '');
      }
      return message;
    }

    const textOutput = formatIndexList(indexes);
    if (json) {
      return formatAsJson('list', textOutput);
    }
    return textOutput;
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
