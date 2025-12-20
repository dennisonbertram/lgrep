import { openDatabase, getIndex } from '../../storage/lance.js';
import { getCalls, getSymbols } from '../../storage/code-intel.js';
import type { CodeSymbol } from '../../types/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { createSpinner } from '../utils/progress.js';

/**
 * Options for the dead command.
 */
export interface DeadOptions {
  index?: string;
  limit?: number;
  json?: boolean;
  showProgress?: boolean;
}

interface DeadSymbol {
  name: string;
  kind: string;
  filePath: string;
  relativePath: string;
  callers: number;
}

/**
 * Result of the dead command.
 */
export interface DeadResult {
  success: boolean;
  indexName: string;
  analyzed: number;
  deadSymbols: DeadSymbol[];
  totalCandidates: number;
}

const CALLABLE_KINDS = new Set(['function', 'method']);

/**
 * Run the dead command.
 */
export async function runDeadCommand(
  options: DeadOptions = {}
): Promise<DeadResult> {
  const showProgress = options.showProgress ?? true;
  const spinner = showProgress && !options.json ? createSpinner('Initializing...') : null;
  spinner?.start();

  try {
    let indexName: string;
    if (options.index) {
      indexName = options.index;
    } else {
      spinner?.update('Auto-detecting index...');
      const detected = await detectIndexForDirectory();
      if (!detected) {
        throw new Error('No index found for current directory.');
      }
      indexName = detected;
      spinner?.update(`Using index "${indexName}"`);
    }

    spinner?.update('Opening database...');
    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);

    try {
      spinner?.update(`Loading index "${indexName}"...`);
      const handle = await getIndex(db, indexName);
      if (!handle) {
        throw new Error(`Index "${indexName}" not found`);
      }

      const symbols = await getSymbols(db, indexName);
      const calls = await getCalls(db, indexName);

      const symbolById = new Map<string, CodeSymbol>();
      const symbolByName = new Map<string, CodeSymbol[]>();

      for (const sym of symbols) {
        const kindKey = sym.kind.toLowerCase();
        if (!kindKey.includes('function') && !CALLABLE_KINDS.has(kindKey)) {
          continue;
        }

        symbolById.set(sym.id, sym);
        const entries = symbolByName.get(sym.name) ?? [];
        entries.push(sym);
        symbolByName.set(sym.name, entries);
      }

      const callCounts = new Map<string, number>();
      for (const sym of symbolById.values()) {
        callCounts.set(sym.id, 0);
      }

      for (const call of calls) {
        let targets: CodeSymbol[] = [];
        if (call.calleeId && symbolById.has(call.calleeId)) {
          targets = [symbolById.get(call.calleeId)!];
        } else if (call.calleeName && symbolByName.has(call.calleeName)) {
          targets = symbolByName.get(call.calleeName)!;
        }

        for (const target of targets) {
          callCounts.set(target.id, (callCounts.get(target.id) ?? 0) + 1);
        }
      }

      const deadSymbols: DeadSymbol[] = [];
      for (const [id, sym] of symbolById.entries()) {
        const callers = callCounts.get(id) ?? 0;
        if (callers === 0) {
          deadSymbols.push({
            name: sym.name,
            kind: sym.kind,
            filePath: sym.filePath,
            relativePath: sym.relativePath,
            callers,
          });
        }
      }

      deadSymbols.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      spinner?.succeed(`Identified ${deadSymbols.length} dead symbol(s)`);

      const limited = typeof options.limit === 'number'
        ? deadSymbols.slice(0, options.limit)
        : deadSymbols;

      return {
        success: true,
        indexName,
        analyzed: symbols.length,
        totalCandidates: callCounts.size,
        deadSymbols: limited,
      };
    } finally {
      await db.close();
    }
  } catch (error) {
    spinner?.fail('Dead code analysis failed');
    throw error;
  }
}
