import { basename } from 'node:path';
import { openDatabase, getIndex } from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { getSymbols, searchSymbols } from '../../storage/code-intel.js';
import type { CodeSymbol } from '../../types/code-intel.js';

/**
 * Symbol match result.
 */
export interface SymbolMatch {
  name: string;
  kind: string;
  file: string;
  line: number;
  signature?: string;
  summary?: string;
}

/**
 * Symbols result.
 */
export interface SymbolsResult {
  success: boolean;
  query?: string;
  matches?: SymbolMatch[];
  total?: number;
  error?: string;
}

/**
 * Options for symbols command.
 */
export interface SymbolsOptions {
  index?: string;
  kind?: string;
  file?: string;
  limit?: number;
  json?: boolean;
}

/**
 * Convert CodeSymbol to SymbolMatch.
 */
function toSymbolMatch(symbol: CodeSymbol): SymbolMatch {
  return {
    name: symbol.name,
    kind: symbol.kind,
    file: symbol.relativePath,
    line: symbol.range.start.line,
    signature: symbol.signature,
    summary: symbol.summary,
  };
}

/**
 * Run the symbols command.
 */
export async function runSymbolsCommand(
  query: string | undefined,
  options: SymbolsOptions = {}
): Promise<SymbolsResult> {
  // Get index name
  let indexName: string = options.index ?? '';
  if (!indexName) {
    const detected = await detectIndexForDirectory(process.cwd());
    indexName = detected ?? basename(process.cwd());
  }

  const dbPath = getDbPath();
  const db = await openDatabase(dbPath);

  try {
    const handle = await getIndex(db, indexName);
    if (!handle) {
      return {
        success: false,
        error: `Index "${indexName}" not found. Run: lgrep index .`,
      };
    }

    const limit = options.limit ?? 50;
    let symbols: CodeSymbol[];

    if (query) {
      // Search by name pattern
      symbols = await searchSymbols(db, indexName, query);
    } else {
      // Get all symbols
      symbols = await getSymbols(db, indexName);
    }

    // Filter by kind if specified
    if (options.kind) {
      const kindLower = options.kind.toLowerCase();
      symbols = symbols.filter(s => s.kind.toLowerCase() === kindLower);
    }

    // Filter by file if specified
    if (options.file) {
      const fileLower = options.file.toLowerCase();
      symbols = symbols.filter(s => s.relativePath.toLowerCase().includes(fileLower));
    }

    // Apply limit
    const limited = symbols.slice(0, limit);

    return {
      success: true,
      query: query || undefined,
      matches: limited.map(toSymbolMatch),
      total: symbols.length,
    };
  } finally {
    await db.close();
  }
}
