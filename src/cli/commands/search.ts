import { createEmbeddingClient } from '../../core/embeddings.js';
import { loadConfig } from '../../storage/config.js';
import {
  openDatabase,
  getIndex,
  searchChunks,
  rerankerWithMMR,
  type SearchResult,
} from '../../storage/lance.js';
import { getCalls, searchSymbols, getSymbols } from '../../storage/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import { createSpinner } from '../utils/progress.js';

/**
 * Options for the search command.
 */
export interface SearchOptions {
  index?: string;
  limit?: number;
  diversity?: number;
  showProgress?: boolean;
  json?: boolean;
  usages?: string;      // Find usages of this symbol
  definition?: string;  // Find definition of this symbol
  type?: string;        // Filter by symbol kind
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
 * A usage of a symbol.
 */
export interface SymbolUsage {
  file: string;
  line: number;
  caller?: string;
  callerKind?: string;
}

/**
 * A symbol definition.
 */
export interface SymbolDefinition {
  file: string;
  line: number;
  kind: string;
  signature?: string;
  exported: boolean;
}

/**
 * A symbol info for type filter.
 */
export interface SymbolInfo {
  name: string;
  file: string;
  line: number;
  kind: string;
  signature?: string;
  exported: boolean;
}

/**
 * Result of the search command.
 */
export interface SearchCommandResult {
  success: boolean;
  query?: string;
  indexName: string;
  results?: SearchResultItem[];
  mode?: string;
  symbol?: string;
  usages?: SymbolUsage[];
  definitions?: SymbolDefinition[];
  symbolType?: string;
  symbols?: SymbolInfo[];
  count?: number;
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
  const diversity = options.diversity ?? 0.7;
  const showProgress = options.showProgress ?? true;

  // Create spinner if progress is enabled (but not in JSON mode)
  const spinner = showProgress && !options.json ? createSpinner('Initializing search...') : null;

  try {
    spinner?.start();

    // Validate diversity parameter
    if (diversity < 0.0 || diversity > 1.0) {
      throw new Error('Diversity parameter must be between 0.0 and 1.0');
    }

    // Must specify an index for now
    if (!options.index) {
      throw new Error('Index name is required. Use --index <name> to specify.');
    }

    const indexName = options.index;

    // Load config
    spinner?.update('Loading configuration...');
    const config = await loadConfig();

    // Open database
    spinner?.update('Opening database...');
    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);

    try {
      // Get the index
      spinner?.update(`Loading index "${indexName}"...`);
      const handle = await getIndex(db, indexName);
      if (!handle) {
        throw new Error(`Index "${indexName}" not found`);
      }

      // Handle --usages mode
      if (options.usages) {
        spinner?.update(`Finding usages of "${options.usages}"...`);

        // First, find the symbol by name
        const symbols = await searchSymbols(db, indexName, options.usages);

        if (symbols.length === 0) {
          spinner?.succeed(`No usages found for "${options.usages}"`);
          return {
            success: true,
            indexName,
            mode: 'usages',
            symbol: options.usages,
            usages: [],
            count: 0,
          };
        }

        // Find all calls to this symbol
        const allCalls = await getCalls(db, indexName);
        const usages: SymbolUsage[] = [];

        for (const symbol of symbols) {
          // Find calls where callee matches this symbol
          const symbolCalls = allCalls.filter(
            call => call.calleeName === symbol.name || call.calleeId === symbol.id
          );

          for (const call of symbolCalls) {
            // Find the caller symbol to get its kind
            const callerSymbols = call.callerId
              ? await searchSymbols(db, indexName, call.callerId)
              : [];

            usages.push({
              file: call.callerFile,
              line: call.position.line,
              caller: callerSymbols[0]?.name,
              callerKind: callerSymbols[0]?.kind,
            });
          }
        }

        spinner?.succeed(`Found ${usages.length} usage(s) of "${options.usages}"`);

        return {
          success: true,
          indexName,
          mode: 'usages',
          symbol: options.usages,
          usages,
          count: usages.length,
        };
      }

      // Handle --definition mode
      if (options.definition) {
        spinner?.update(`Finding definition of "${options.definition}"...`);

        // Search for symbols matching the query
        const symbols = await searchSymbols(db, indexName, options.definition);

        const definitions: SymbolDefinition[] = symbols.map(symbol => ({
          file: symbol.filePath,
          line: symbol.range.start.line,
          kind: symbol.kind,
          signature: symbol.signature,
          exported: symbol.isExported,
        }));

        spinner?.succeed(`Found ${definitions.length} definition(s) for "${options.definition}"`);

        return {
          success: true,
          indexName,
          mode: 'definition',
          symbol: options.definition,
          definitions,
          count: definitions.length,
        };
      }

      // Handle --type filter mode
      if (options.type) {
        spinner?.update(`Finding symbols of type "${options.type}"...`);

        // Get all symbols of the specified kind
        const allSymbols = await getSymbols(db, indexName, { kind: options.type as any });

        const symbols: SymbolInfo[] = allSymbols.map(symbol => ({
          name: symbol.name,
          file: symbol.filePath,
          line: symbol.range.start.line,
          kind: symbol.kind,
          signature: symbol.signature,
          exported: symbol.isExported,
        }));

        spinner?.succeed(`Found ${symbols.length} symbol(s) of type "${options.type}"`);

        return {
          success: true,
          indexName,
          mode: 'type',
          symbolType: options.type,
          symbols,
          count: symbols.length,
        };
      }

      // Standard semantic search mode
      // Create embedding client with the same model used for the index
      spinner?.update('Initializing embedding model...');
      const embedClient = createEmbeddingClient({ model: handle.metadata.model });

      // Embed the query
      spinner?.update('Generating query embedding...');
      const queryResult = await embedClient.embed(query);
      const queryEmbedding = queryResult.embeddings[0];
      if (!queryEmbedding) {
        throw new Error('Failed to generate embedding for query');
      }
      const queryVector = new Float32Array(queryEmbedding);

      // Search for similar chunks
      spinner?.update('Searching for similar content...');
      const searchResults = await searchChunks(db, handle, queryVector, {
        limit,
      });

      // Apply MMR reranking for diversity
      spinner?.update('Reranking results...');
      const rerankedResults = rerankerWithMMR(searchResults, queryVector, diversity);

      // Convert to result items
      const results: SearchResultItem[] = rerankedResults.map((result) => ({
        filePath: result.filePath,
        relativePath: result.relativePath,
        content: result.content,
        score: result._score,
        lineStart: result.lineStart,
        lineEnd: result.lineEnd,
        chunkIndex: result.chunkIndex,
      }));

      spinner?.succeed(`Found ${results.length} results for "${query}"`);

      return {
        success: true,
        query,
        indexName,
        results,
      };
    } finally {
      await db.close();
    }
  } catch (err) {
    spinner?.fail('Search failed');
    throw err;
  }
}
