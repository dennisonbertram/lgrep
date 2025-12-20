import { openDatabase, getIndex } from '../../storage/lance.js';
import { getCalls, getSymbols } from '../../storage/code-intel.js';
import type { CodeSymbol } from '../../types/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { createSpinner } from '../utils/progress.js';

export interface RenameOptions {
  index?: string;
  json?: boolean;
  showProgress?: boolean;
  preview?: boolean;
  limit?: number;
}

export interface RenameReference {
  file: string;
  line: number;
  callerName?: string;
}

export interface RenameResult {
  success: boolean;
  indexName: string;
  symbolName: string;
  newName: string;
  references: RenameReference[];
  totalReferences: number;
}

export async function runRenameCommand(
  oldName: string,
  newName: string,
  options: RenameOptions = {}
): Promise<RenameResult> {
  const showProgress = options.showProgress ?? true;
  const spinner = showProgress && !options.json ? createSpinner('Gathering rename impact...') : null;
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
      spinner?.update('Loading data...');
      const handle = await getIndex(db, indexName);
      if (!handle) {
        throw new Error(`Index "${indexName}" not found`);
      }

      const symbols = await getSymbols(db, indexName);
      const calls = await getCalls(db, indexName);

      const matchingSymbols = symbols.filter(sym => sym.name === oldName);
      if (matchingSymbols.length === 0) {
        throw new Error(`No symbol named "${oldName}" found`);
      }

      const references: RenameReference[] = [];

      for (const call of calls) {
        const target = matchingSymbols.find(sym => sym.id === call.calleeId || sym.name === call.calleeName);
        if (!target) {
          continue;
        }

        references.push({
          file: call.callerFile,
          line: call.position.line,
          callerName: call.callerId ? target.name : undefined,
        });
      }

      const limited = typeof options.limit === 'number'
        ? references.slice(0, options.limit)
        : references;

      spinner?.succeed(`Rename preview collected (${references.length} references).`);

      return {
        success: true,
        indexName,
        symbolName: oldName,
        newName,
        references: options.preview ? limited : [],
        totalReferences: references.length,
      };
    } finally {
      await db.close();
    }
  } catch (error) {
    spinner?.fail('Rename preview failed');
    throw error;
  }
}
