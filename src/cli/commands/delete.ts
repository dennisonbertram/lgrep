import { openDatabase, getIndex, deleteIndex } from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';
import { formatAsJson } from './json-formatter.js';

/**
 * Options for the delete command.
 */
export interface DeleteOptions {
  force?: boolean;
  json?: boolean;
}

/**
 * Run the delete command.
 *
 * @param name - Name of the index to delete
 * @param options - Delete options
 * @returns Output string to display
 */
export async function runDeleteCommand(
  name: string,
  options: DeleteOptions = {}
): Promise<string> {
  const dbPath = getDbPath();
  const db = await openDatabase(dbPath);

  try {
    // Check if index exists
    const handle = await getIndex(db, name);
    if (!handle) {
      throw new Error(`Index "${name}" not found`);
    }

    // Delete the index
    const deleted = await deleteIndex(db, name);
    if (!deleted) {
      throw new Error(`Failed to delete index "${name}"`);
    }

    const textOutput = `Deleted index "${name}"`;
    if (options.json) {
      return formatAsJson('delete', textOutput, { indexName: name });
    }
    return textOutput;
  } finally {
    await db.close();
  }
}
