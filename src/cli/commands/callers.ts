import { getIndex } from '../../storage/lance.js';
import { getCalls, searchSymbols, getSymbols } from '../../storage/code-intel.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import { createSpinner } from '../utils/progress.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { detectHostedScopeForDirectory } from '../utils/hosted-auto-detect.js';
import { formatMissingHostedScopeError } from '../utils/hosted-scope-errors.js';
import { getServerUrl, queryServer } from '../../server/client.js';
import type { QueryCallersResponse } from '../../server/query-server.js';

/**
 * Options for the callers command.
 */
export interface CallersOptions {
  index?: string;
  project?: string;
  worktree?: string;
  showProgress?: boolean;
  json?: boolean;
}

/**
 * A single caller of a symbol.
 */
export interface Caller {
  file: string;
  line: number;
  callerName?: string;
  callerKind?: string;
  worktreeName?: string;
}

/**
 * Result of the callers command.
 */
export interface CallersCommandResult {
  success: boolean;
  symbol: string;
  indexName: string;
  callers?: Caller[];
  count: number;
  error?: string;
}

/**
 * Run the callers command.
 *
 * @param symbol - The symbol to find callers for
 * @param options - Command options
 * @returns Callers results
 */
export async function runCallersCommand(
  symbol: string,
  options: CallersOptions = {}
): Promise<CallersCommandResult> {
  const showProgress = options.showProgress ?? true;

  // Create spinner if progress is enabled (but not in JSON mode)
  const spinner = showProgress && !options.json ? createSpinner('Initializing...') : null;

  try {
    spinner?.start();

    const hostedScope = getServerUrl() && !options.index && !options.project && !options.worktree
      ? await detectHostedScopeForDirectory()
      : null;

    if (getServerUrl() && !options.index && !options.project && !options.worktree && !hostedScope) {
      throw new Error(formatMissingHostedScopeError());
    }

    if (getServerUrl() && !options.index && (options.project || options.worktree || hostedScope)) {
      const project = options.project ?? hostedScope?.project;
      const worktree = options.worktree ?? hostedScope?.worktree;

      const response = await queryServer({
        method: 'callers',
        project,
        worktree,
        params: { symbol },
      }) as QueryCallersResponse;

      return {
        success: true,
        symbol,
        indexName: worktree ?? project ?? 'hosted',
        callers: response.callers,
        count: response.count,
      };
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

      spinner?.update(`Finding callers of "${symbol}"...`);

      // First, find the symbol by name
      const symbols = await searchSymbols(db, indexName, symbol);

      if (symbols.length === 0) {
        spinner?.succeed(`No callers found for "${symbol}"`);
        return {
          success: true,
          symbol,
          indexName,
          callers: [],
          count: 0,
        };
      }

      // Find all calls to this symbol
      const allCalls = await getCalls(db, indexName);
      const callers: Caller[] = [];

      for (const sym of symbols) {
        // Find calls where callee matches this symbol
        const symbolCalls = allCalls.filter(
          call => call.calleeName === sym.name || call.calleeId === sym.id
        );

        for (const call of symbolCalls) {
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

          callers.push({
            file: call.callerFile,
            line: call.position.line,
            callerName,
            callerKind,
          });
        }
      }

      spinner?.succeed(`Found ${callers.length} caller(s) of "${symbol}"`);

      return {
        success: true,
        symbol,
        indexName,
        callers,
        count: callers.length,
      };
    } finally {
      await db.close();
    }
  } catch (err) {
    spinner?.fail('Command failed');
    throw err;
  }
}
