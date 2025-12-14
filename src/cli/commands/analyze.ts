/**
 * Analyze CLI command - analyze code structure (symbols, dependencies, calls)
 */

import { analyzeProject, type AnalyzeOptions, type AnalyzeResult } from '../../core/ast/analyzer.js';

// Re-export AnalyzeResult for use in other modules
export type { AnalyzeResult } from '../../core/ast/analyzer.js';

/**
 * Options for analyze command
 */
export interface AnalyzeCommandOptions {
  /** Store results in named index */
  index?: string;
  /** List all symbols */
  symbols?: boolean;
  /** Show dependency graph */
  deps?: boolean;
  /** Show call graph */
  calls?: boolean;
  /** Output full AST tree */
  tree?: boolean;
  /** Analyze single file only */
  file?: string;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Run the analyze command
 */
export async function runAnalyzeCommand(
  sourcePath: string,
  options: AnalyzeCommandOptions
): Promise<AnalyzeResult> {
  // Build analyze options from CLI options
  const analyzeOptions: AnalyzeOptions = {
    symbols: options.symbols,
    deps: options.deps,
    calls: options.calls,
    tree: options.tree,
    file: options.file,
    json: options.json,
  };

  // Run analysis
  const result = await analyzeProject(sourcePath, analyzeOptions);

  // TODO: If index option is provided, store results in named index
  // This will be implemented when we have code-intel storage

  return result;
}
