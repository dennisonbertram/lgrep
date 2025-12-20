import { openDatabase, getIndex } from '../../storage/lance.js';
import { getCalls, searchSymbols, getDependencies, getSymbols } from '../../storage/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import { createSpinner } from '../utils/progress.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';

/**
 * Options for the impact command.
 */
export interface ImpactOptions {
  index?: string;
  showProgress?: boolean;
  json?: boolean;
}

/**
 * A direct caller of a symbol.
 */
export interface DirectCaller {
  file: string;
  line: number;
  callerName?: string;
  callerKind?: string;
}

/**
 * Result of the impact command.
 */
export interface ImpactCommandResult {
  success: boolean;
  symbol: string;
  indexName: string;
  directCallers?: DirectCaller[];
  transitiveFiles?: string[];
  totalFiles: number;
  error?: string;
}

/**
 * Run the impact command.
 *
 * @param symbol - The symbol to analyze impact for
 * @param options - Command options
 * @returns Impact analysis results
 */
export async function runImpactCommand(
  symbol: string,
  options: ImpactOptions = {}
): Promise<ImpactCommandResult> {
  const showProgress = options.showProgress ?? true;

  // Create spinner if progress is enabled (but not in JSON mode)
  const spinner = showProgress && !options.json ? createSpinner('Initializing...') : null;

  try {
    spinner?.start();

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

      spinner?.update(`Analyzing impact of "${symbol}"...`);

      // First, find the symbol by name
      const symbols = await searchSymbols(db, indexName, symbol);

      if (symbols.length === 0) {
        spinner?.succeed(`No impact found for "${symbol}"`);
        return {
          success: true,
          symbol,
          indexName,
          directCallers: [],
          transitiveFiles: [],
          totalFiles: 0,
        };
      }

      // Step 1: Find all direct calls to this symbol
      const allCalls = await getCalls(db, indexName);
      const directCallers: DirectCaller[] = [];
      const directFiles = new Set<string>();

      for (const sym of symbols) {
        // Find calls where callee matches this symbol
        const symbolCalls = allCalls.filter(
          call => call.calleeName === sym.name || call.calleeId === sym.id
        );

        for (const call of symbolCalls) {
          directFiles.add(call.callerFile);

          // Find the caller symbol to get its kind
          let callerName: string | undefined;
          let callerKind: string | undefined;

          if (call.callerId) {
            // Get all symbols and find by ID
            const allSymbols = await getSymbols(db, indexName);
            const callerSymbol = allSymbols.find(s => s.id === call.callerId);
            if (callerSymbol) {
              callerName = callerSymbol.name;
              callerKind = callerSymbol.kind;
            }
          }

          directCallers.push({
            file: call.callerFile,
            line: call.position.line,
            callerName,
            callerKind,
          });
        }
      }

      spinner?.update('Analyzing transitive impact...');

      // Step 2: Find transitive impact through the dependency graph
      const allDeps = await getDependencies(db, indexName, { external: false });
      const transitiveFiles = new Set<string>();

      // Build a reverse dependency map (file -> files that import it)
      const importedBy = new Map<string, Set<string>>();
      for (const dep of allDeps) {
        const target = dep.resolvedPath || dep.targetModule;
        if (!importedBy.has(target)) {
          importedBy.set(target, new Set());
        }
        importedBy.get(target)!.add(dep.sourceFile);
      }

      // BFS to find all files that transitively depend on files containing direct callers
      const queue = Array.from(directFiles);
      const visited = new Set<string>(directFiles);

      while (queue.length > 0) {
        const current = queue.shift()!;
        const dependents = importedBy.get(current);

        if (dependents) {
          for (const dependent of dependents) {
            if (!visited.has(dependent)) {
              visited.add(dependent);
              transitiveFiles.add(dependent);
              queue.push(dependent);
            }
          }
        }
      }

      const totalFiles = directFiles.size + transitiveFiles.size;

      spinner?.succeed(`Found impact: ${directCallers.length} direct callers, ${totalFiles} total files`);

      return {
        success: true,
        symbol,
        indexName,
        directCallers,
        transitiveFiles: Array.from(transitiveFiles),
        totalFiles,
      };
    } finally {
      await db.close();
    }
  } catch (err) {
    spinner?.fail('Command failed');
    throw err;
  }
}
