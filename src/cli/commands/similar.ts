import { openDatabase, getIndex } from '../../storage/lance.js';
import { getSymbols } from '../../storage/code-intel.js';
import type { CodeSymbol } from '../../types/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { createSpinner } from '../utils/progress.js';

export interface SimilarOptions {
  index?: string;
  json?: boolean;
  showProgress?: boolean;
  limit?: number;
}

export interface SimilarGroup {
  bodyHash?: string;
  symbols: {
    name: string;
    filePath: string;
    relativePath: string;
    kind: string;
  }[];
}

export interface SimilarResult {
  success: boolean;
  indexName: string;
  groups: SimilarGroup[];
}

export async function runSimilarCommand(
  options: SimilarOptions = {}
): Promise<SimilarResult> {
  const showProgress = options.showProgress ?? true;
  const spinner = showProgress && !options.json ? createSpinner('Finding similar code...') : null;
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
      spinner?.update('Loading symbols...');
      const handle = await getIndex(db, indexName);
      if (!handle) {
        throw new Error(`Index "${indexName}" not found`);
      }

      const symbols = await getSymbols(db, indexName);
      const groupsByHash = new Map<string, SimilarGroup>();

      for (const sym of symbols) {
        if (!sym.bodyHash) {
          continue;
        }

        const group = groupsByHash.get(sym.bodyHash);
        const entry = {
          name: sym.name,
          filePath: sym.filePath,
          relativePath: sym.relativePath,
          kind: sym.kind,
        };

        if (group) {
          group.symbols.push(entry);
        } else {
          groupsByHash.set(sym.bodyHash, {
            bodyHash: sym.bodyHash,
            symbols: [entry],
          });
        }
      }

      const similarGroups = Array.from(groupsByHash.values())
        .filter(group => group.symbols.length > 1)
        .sort((a, b) => b.symbols.length - a.symbols.length);

      spinner?.succeed(`Found ${similarGroups.length} similar code cluster(s)`);

      return {
        success: true,
        indexName,
        groups: typeof options.limit === 'number'
          ? similarGroups.slice(0, options.limit)
          : similarGroups,
      };
    } finally {
      await db.close();
    }
  } catch (error) {
    spinner?.fail('Similar code analysis failed');
    throw error;
  }
}
