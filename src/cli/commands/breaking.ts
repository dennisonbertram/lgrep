import { openDatabase, getIndex } from '../../storage/lance.js';
import { getCalls, getSymbols } from '../../storage/code-intel.js';
import type { CodeSymbol } from '../../types/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { createSpinner } from '../utils/progress.js';

export interface BreakingOptions {
  index?: string;
  json?: boolean;
  showProgress?: boolean;
}

export interface BreakingCall {
  file: string;
  line: number;
  argumentCount: number;
  expected: number;
}

export interface BreakingSymbol {
  name: string;
  kind: string;
  filePath: string;
  relativePath: string;
  signature?: string;
  calls: BreakingCall[];
}

export interface BreakingResult {
  success: boolean;
  indexName: string;
  mismatches: BreakingSymbol[];
  inspected: number;
}

export async function runBreakingCommand(
  options: BreakingOptions = {}
): Promise<BreakingResult> {
  const showProgress = options.showProgress ?? true;
  const spinner = showProgress && !options.json ? createSpinner('Inspecting calls...') : null;
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
      spinner?.update('Loading symbols and calls...');
      const handle = await getIndex(db, indexName);
      if (!handle) {
        throw new Error(`Index "${indexName}" not found`);
      }

      const symbols = await getSymbols(db, indexName);
      const calls = await getCalls(db, indexName);

      const symbolById = new Map<string, CodeSymbol>();
      const symbolsWithParams: CodeSymbol[] = [];

      for (const sym of symbols) {
        symbolById.set(sym.id, sym);
        if (typeof sym.signature === 'string') {
          symbolsWithParams.push(sym);
        }
      }

      const mismatches: Map<string, BreakingSymbol> = new Map();

      for (const call of calls) {
        const target = call.calleeId ? symbolById.get(call.calleeId) : undefined;
        const candidateList = target ? [target] : symbolsWithParams.filter(sym => sym.name === call.calleeName);

        for (const symbol of candidateList) {
          const expected = getParamCount(symbol.signature);
          if (expected === undefined) {
            continue;
          }
          if (call.argumentCount !== expected) {
            const key = symbol.id;
            const existing = mismatches.get(key);
            const callInfo: BreakingCall = {
              file: call.callerFile,
              line: call.position.line,
              argumentCount: call.argumentCount,
              expected,
            };

            if (existing) {
              existing.calls.push(callInfo);
            } else {
              mismatches.set(key, {
                name: symbol.name,
                kind: symbol.kind,
                filePath: symbol.filePath,
                relativePath: symbol.relativePath,
                signature: symbol.signature,
                calls: [callInfo],
              });
            }
          }
        }
      }

      const result = Array.from(mismatches.values());
      spinner?.succeed(`Found ${result.length} signature mismatch(es)`);

      return {
        success: true,
        indexName,
        mismatches: result,
        inspected: calls.length,
      };
    } finally {
      await db.close();
    }
  } catch (error) {
    spinner?.fail('Breaking analysis failed');
    throw error;
  }
}

function getParamCount(signature?: string): number | undefined {
  if (!signature) {
    return undefined;
  }

  const match = signature.match(/\(([^)]*)\)/);
  if (!match) {
    return undefined;
  }

  const params = match[1]?.trim() ?? '';
  if (params === '') {
    return 0;
  }

  return params.split(',').length;
}
