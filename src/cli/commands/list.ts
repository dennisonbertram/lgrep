import { openDatabase, listIndexes, type IndexHandle } from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';
import { formatAsJson } from './json-formatter.js';
import { DaemonManager } from '../../daemon/manager.js';

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

    // Get list of running watchers
    const daemonManager = new DaemonManager();
    const runningWatchers = await daemonManager.list();
    const watcherNames = new Set(runningWatchers.map(w => w.indexName));

    const textOutput = formatIndexList(indexes, watcherNames);
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
function formatIndexList(indexes: IndexHandle[], watcherNames: Set<string>): string {
  const lines: string[] = ['Indexes:', ''];

  for (const index of indexes) {
    const { metadata } = index;
    const isWatching = watcherNames.has(index.name);
    const isFailed = metadata.status === 'failed';
    const isBuilding = metadata.status === 'building';

    // Determine status display and icon
    let statusDisplay: string = metadata.status;
    let icon = '';
    if (isWatching) {
      statusDisplay = 'watching';
      icon = ' 👁';
    } else if (isFailed) {
      icon = ' ❌';
    } else if (isBuilding) {
      icon = ' 🔄';
    }

    lines.push(`  ${index.name}${icon}`);
    lines.push(`    Path:   ${metadata.rootPath}`);
    lines.push(`    Model:  ${metadata.model}`);
    lines.push(`    Status: ${statusDisplay}${isFailed ? ' (use --retry to retry)' : ''}`);
    lines.push(`    Chunks: ${metadata.chunkCount}`);
    lines.push('');
  }

  return lines.join('\n');
}
