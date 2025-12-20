import { openDatabase, getIndex } from '../../storage/lance.js';
import { getDependencies, getSymbols } from '../../storage/code-intel.js';
import type { CodeSymbol, CodeDependency } from '../../types/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { createSpinner } from '../utils/progress.js';

export interface UnusedExportsOptions {
  index?: string;
  json?: boolean;
  showProgress?: boolean;
  limit?: number;
}

export interface UnusedExportItem {
  name: string;
  filePath: string;
  relativePath: string;
  kind: string;
}

export interface UnusedExportsResult {
  success: boolean;
  indexName: string;
  unused: UnusedExportItem[];
  inspected: number;
}

const IMPORT_KIND_WHITELIST = new Set(['import', 'dynamic-import', 'require']);

export async function runUnusedExportsCommand(
  options: UnusedExportsOptions = {}
): Promise<UnusedExportsResult> {
  const showProgress = options.showProgress ?? true;
  const spinner = showProgress && !options.json ? createSpinner('Analyzing exports...') : null;
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
      spinner?.update('Loading symbols and imports...');
      const handle = await getIndex(db, indexName);
      if (!handle) {
        throw new Error(`Index "${indexName}" not found`);
      }

      const symbols = await getSymbols(db, indexName);
      const dependencies = await getDependencies(db, indexName);

      const indexedImports = buildImportIndex(dependencies);

      const exportedSymbols = symbols.filter(sym => sym.isExported);

      const unused: UnusedExportItem[] = [];

      for (const sym of exportedSymbols) {
        const imports = indexedImports.get(sym.filePath) ?? new Set<string>();
        if (!imports.has(sym.name)) {
          unused.push({
            name: sym.name,
            filePath: sym.filePath,
            relativePath: sym.relativePath,
            kind: sym.kind,
          });
        }
      }

      unused.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      const limited = typeof options.limit === 'number'
        ? unused.slice(0, options.limit)
        : unused;

      spinner?.succeed(`Found ${unused.length} exported symbol(s) without usages`);

      return {
        success: true,
        indexName,
        unused: limited,
        inspected: exportedSymbols.length,
      };
    } finally {
      await db.close();
    }
  } catch (error) {
    spinner?.fail('Unused exports analysis failed');
    throw error;
  }
}

function buildImportIndex(dependencies: CodeDependency[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const dep of dependencies) {
    if (!dep.resolvedPath || !IMPORT_KIND_WHITELIST.has(dep.kind)) {
      continue;
    }

    const names = new Set<string>();
    for (const imported of dep.names) {
      names.add(imported.name);
      if (imported.alias) {
        names.add(imported.alias);
      }
    }

    if (names.size === 0) {
      continue;
    }

    const entry = index.get(dep.resolvedPath) ?? new Set<string>();
    for (const name of names) {
      entry.add(name);
    }

    index.set(dep.resolvedPath, entry);
  }

  return index;
}
