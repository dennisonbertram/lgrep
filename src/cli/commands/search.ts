import { createEmbeddingClient } from '../../core/embeddings.js';
import { loadConfig } from '../../storage/config.js';
import {
  openDatabase,
  getIndex,
  searchChunks,
  type SearchResult,
} from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';

/**
 * Options for the search command.
 */
export interface SearchOptions {
  index?: string;
  limit?: number;
}

/**
 * A single search result for display.
 */
export interface SearchResultItem {
  filePath: string;
  relativePath: string;
  content: string;
  score: number;
  lineStart?: number;
  lineEnd?: number;
  chunkIndex: number;
}

/**
 * Result of the search command.
 */
export interface SearchCommandResult {
  success: boolean;
  query: string;
  indexName: string;
  results: SearchResultItem[];
  error?: string;
}

/**
 * Run the search command.
 *
 * @param query - The search query
 * @param options - Search options
 * @returns Search results
 */
export async function runSearchCommand(
  query: string,
  options: SearchOptions = {}
): Promise<SearchCommandResult> {
  const limit = options.limit ?? 10;

  // Must specify an index for now
  if (!options.index) {
    throw new Error('Index name is required. Use --index <name> to specify.');
  }

  const indexName = options.index;

  // Load config
  const config = await loadConfig();

  // Open database
  const dbPath = getDbPath();
  const db = await openDatabase(dbPath);

  try {
    // Get the index
    const handle = await getIndex(db, indexName);
    if (!handle) {
      throw new Error(`Index "${indexName}" not found`);
    }

    // Create embedding client with the same model used for the index
    const embedClient = createEmbeddingClient({ model: handle.metadata.model });

    // Embed the query
    const queryResult = await embedClient.embed(query);
    const queryEmbedding = queryResult.embeddings[0];
    if (!queryEmbedding) {
      throw new Error('Failed to generate embedding for query');
    }
    const queryVector = new Float32Array(queryEmbedding);

    // Search for similar chunks
    const searchResults = await searchChunks(db, handle, queryVector, {
      limit,
    });

    // Convert to result items
    const results: SearchResultItem[] = searchResults.map((result) => ({
      filePath: result.filePath,
      relativePath: result.relativePath,
      content: result.content,
      score: result._score,
      lineStart: result.lineStart,
      lineEnd: result.lineEnd,
      chunkIndex: result.chunkIndex,
    }));

    return {
      success: true,
      query,
      indexName,
      results,
    };
  } finally {
    await db.close();
  }
}
