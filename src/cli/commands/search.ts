import { createEmbeddingClient } from '../../core/embeddings.js';
import { loadConfig } from '../../storage/config.js';
import {
  getIndex,
  searchChunks,
  searchSharedChunksForWorktree,
  searchSharedChunksForProject,
  rerankerWithMMR,
  ensureSharedTables,
  type SearchResult,
} from '../../storage/lance.js';
import { getCalls, searchSymbols, getSymbols } from '../../storage/code-intel.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import { createSpinner } from '../utils/progress.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import {
  ensureWorktreeTables,
  getWorktree,
} from '../../storage/worktree.js';
import {
  ensureProjectTables,
  getProject,
} from '../../storage/project.js';

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
  worktree?: string;    // Search within a worktree (shared chunk store)
  project?: string;     // Search within a project (all worktrees or specific one)
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

    // Auto-detect index if not provided
    let indexName: string;
    if (options.index) {
      indexName = options.index;
    } else {
      spinner?.update('Auto-detecting index for current directory...');
      const detected = await detectIndexForDirectory();
      if (!detected) {
        throw new Error(
          'No index found for current directory. Either:\n' +
          '  1. Use --index <name> to specify an index\n' +
          '  2. Run `lgrep index .` to index the current directory\n' +
          '  3. Navigate to an indexed directory'
        );
      }
      indexName = detected;
      spinner?.update(`Using auto-detected index "${indexName}"...`);
    }

    // Load config
    spinner?.update('Loading configuration...');
    const config = await loadConfig();

    // Open database
    spinner?.update('Opening database...');
    const db = await openConfiguredDatabase();

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

      // Project-scoped search (all worktrees in a project, or one specific worktree)
      if (options.project) {
        await ensureProjectTables(db);
        await ensureWorktreeTables(db);

        const proj = await getProject(db, options.project);
        if (!proj) throw new Error(`Project "${options.project}" not found`);

        let worktreeId: string | undefined;
        if (options.worktree) {
          const wt = await getWorktree(db, options.worktree, { projectId: proj.id });
          if (!wt) throw new Error(`Worktree "${options.worktree}" not found in project "${proj.name}"`);
          worktreeId = wt.id;
        }

        spinner?.update('Initializing embedding model...');
        const embedClient = createEmbeddingClient({ model: proj.model });

        spinner?.update('Generating query embedding...');
        const queryResult = await embedClient.embed(query);
        const queryEmbedding = queryResult.embeddings[0];
        if (!queryEmbedding) throw new Error('Failed to generate embedding for query');
        const queryVector = new Float32Array(queryEmbedding);

        await ensureSharedTables(db, proj.modelDims);

        const scope = worktreeId ? `worktree "${options.worktree}"` : `project "${proj.name}"`;
        spinner?.update(`Searching ${scope}...`);
        const searchResults = await searchSharedChunksForProject(
          db, queryVector, proj.id, { limit, model: proj.model, worktreeId },
        );

        spinner?.update('Reranking results...');
        const rerankedResults = rerankerWithMMR(searchResults, queryVector, diversity);

        const results: SearchResultItem[] = rerankedResults.map((r) => ({
          filePath: r.filePath,
          relativePath: r.relativePath,
          content: r.content,
          score: r._score,
          lineStart: r.lineStart,
          lineEnd: r.lineEnd,
          chunkIndex: r.chunkIndex,
        }));

        spinner?.succeed(`Found ${results.length} results for "${query}" in ${scope}`);

        return {
          success: true,
          query,
          indexName: proj.name,
          results,
        };
      }

      // Worktree-scoped search (uses shared chunk store + manifest)
      if (options.worktree) {
        await ensureWorktreeTables(db);
        const wt = await getWorktree(db, options.worktree);
        if (!wt) {
          throw new Error(`Worktree "${options.worktree}" not found`);
        }

        spinner?.update('Initializing embedding model...');
        const embedClient = createEmbeddingClient({ model: wt.model });

        spinner?.update('Generating query embedding...');
        const queryResult = await embedClient.embed(query);
        const queryEmbedding = queryResult.embeddings[0];
        if (!queryEmbedding) throw new Error('Failed to generate embedding for query');
        const queryVector = new Float32Array(queryEmbedding);

        await ensureSharedTables(db, wt.modelDims);

        spinner?.update(`Searching worktree "${wt.name}"...`);
        const searchResults = await searchSharedChunksForWorktree(
          db, queryVector, wt.id, { limit, model: wt.model },
        );

        spinner?.update('Reranking results...');
        const rerankedResults = rerankerWithMMR(searchResults, queryVector, diversity);

        const results: SearchResultItem[] = rerankedResults.map((r) => ({
          filePath: r.filePath,
          relativePath: r.relativePath,
          content: r.content,
          score: r._score,
          lineStart: r.lineStart,
          lineEnd: r.lineEnd,
          chunkIndex: r.chunkIndex,
        }));

        spinner?.succeed(`Found ${results.length} results for "${query}" in worktree "${wt.name}"`);

        return {
          success: true,
          query,
          indexName: wt.name,
          results,
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
