/**
 * Main analysis orchestrator for AST-based code analysis
 */

import { readFile, stat } from 'node:fs/promises';
import { relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { walkFiles } from '../walker.js';
import { extractSymbols } from './symbol-extractor.js';
import { extractDependencies } from './dependency-extractor.js';
import { extractCalls } from './call-extractor.js';
import type {
  CodeSymbol,
  CodeDependency,
  CallEdge,
  FileAnalysis,
} from './types.js';

/**
 * Options for analysis
 */
export interface AnalyzeOptions {
  /** Include symbols in output */
  symbols?: boolean;
  /** Include dependencies in output */
  deps?: boolean;
  /** Include call graph in output */
  calls?: boolean;
  /** Include full AST tree in output */
  tree?: boolean;
  /** Analyze only this specific file */
  file?: string;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Result from analyzing a project
 */
export interface AnalyzeResult {
  /** Whether analysis succeeded */
  success: boolean;
  /** Number of files analyzed */
  filesAnalyzed: number;
  /** Extracted symbols (if options.symbols is true) */
  symbols?: CodeSymbol[];
  /** Extracted dependencies (if options.deps is true) */
  dependencies?: CodeDependency[];
  /** Extracted calls (if options.calls is true) */
  calls?: CallEdge[];
  /** Analysis statistics */
  stats: {
    /** Total number of symbols found */
    totalSymbols: number;
    /** Total number of dependencies found */
    totalDependencies: number;
    /** Total number of calls found */
    totalCalls: number;
    /** Count by symbol kind */
    byKind: Record<string, number>;
  };
  /** Errors encountered during analysis */
  errors: string[];
}

/**
 * Convert old dependency format to new CodeDependency format
 */
function convertDependency(
  dep: unknown,
  sourceFile: string,
  lineOffset: number
): CodeDependency {
  const d = dep as {
    type: string;
    source?: string;
    isExternal: boolean;
    line?: number;
    column?: number;
    imported?: Array<{ name: string; alias?: string; isType?: boolean }>;
    default?: string;
    namespace?: string;
    exported?: Array<{ name: string; alias?: string }>;
  };

  const id = `${sourceFile}:${d.source || 'export'}:${d.line || 0}`;

  // Map type to DependencyKind
  let kind: CodeDependency['kind'];
  switch (d.type) {
    case 'import':
      kind = d.imported?.some(i => i.isType) ? 'import_type' : 'import';
      break;
    case 'dynamic-import':
      kind = 'dynamic_import';
      break;
    case 'require':
      kind = 'require';
      break;
    case 'export':
      kind = d.source ? 'export_from' : 'export';
      break;
    case 'export-default':
      kind = 'export';
      break;
    case 'export-all':
      kind = 're_export';
      break;
    default:
      kind = 'import';
  }

  // Convert imported names
  const names: CodeDependency['names'] = [];

  if (d.default) {
    names.push({
      name: d.default,
      alias: undefined,
      isTypeOnly: false,
      isDefault: true,
      isNamespace: false,
    });
  }

  if (d.namespace) {
    names.push({
      name: d.namespace,
      alias: undefined,
      isTypeOnly: false,
      isDefault: false,
      isNamespace: true,
    });
  }

  if (d.imported) {
    for (const imp of d.imported) {
      names.push({
        name: imp.name,
        alias: imp.alias,
        isTypeOnly: imp.isType || false,
        isDefault: false,
        isNamespace: false,
      });
    }
  }

  if (d.exported) {
    for (const exp of d.exported) {
      names.push({
        name: exp.name,
        alias: exp.alias,
        isTypeOnly: false,
        isDefault: false,
        isNamespace: false,
      });
    }
  }

  return {
    id,
    sourceFile,
    targetModule: d.source || '',
    resolvedPath: undefined,
    kind,
    names,
    line: d.line || lineOffset,
    isExternal: d.isExternal,
  };
}

/**
 * Convert old call format to new CallEdge format
 */
function convertCall(
  call: unknown,
  filePath: string,
  relativePath: string
): CallEdge {
  const c = call as {
    callee: string;
    caller: string | null;
    receiver?: string;
    type: string;
    line?: number;
    column?: number;
    argumentCount: number;
  };

  const callerId = c.caller
    ? `${relativePath}:${c.caller}:function`
    : `${relativePath}:__top_level__:function`;

  const id = `${callerId}->${c.callee}:${c.line || 0}`;

  return {
    id,
    callerId,
    callerFile: filePath,
    calleeName: c.callee,
    calleeId: undefined,
    calleeFile: undefined,
    line: c.line || 0,
    column: c.column || 0,
    isMethodCall: c.type === 'method',
    receiver: c.receiver,
    argumentCount: c.argumentCount,
  };
}

/**
 * Analyze a single file
 */
export async function analyzeFile(
  filePath: string,
  rootPath: string
): Promise<FileAnalysis> {
  const errors: string[] = [];
  const relativePath = relative(rootPath, filePath);
  const extension = extname(filePath);

  let code = '';
  let contentHash = '';

  try {
    code = await readFile(filePath, 'utf-8');
    contentHash = createHash('sha256').update(code).digest('hex');
  } catch (error) {
    errors.push(
      `Failed to read file: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      filePath,
      relativePath,
      extension,
      contentHash: '',
      symbols: [],
      dependencies: [],
      calls: [],
      errors,
      analyzedAt: new Date().toISOString(),
    };
  }

  // Extract symbols
  const symbols = await extractSymbols(code, filePath, relativePath, extension);

  // Extract dependencies
  const rawDeps = await extractDependencies(code, filePath);
  const dependencies = rawDeps.map(dep =>
    convertDependency(dep, filePath, 1)
  );

  // Extract calls
  const rawCalls = await extractCalls(code, filePath);
  const calls = rawCalls.map(call =>
    convertCall(call, filePath, relativePath)
  );

  return {
    filePath,
    relativePath,
    extension,
    contentHash,
    symbols,
    dependencies,
    calls,
    errors,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Analyze a project (directory or single file)
 */
export async function analyzeProject(
  rootPath: string,
  options: AnalyzeOptions = {}
): Promise<AnalyzeResult> {
  const errors: string[] = [];
  const allSymbols: CodeSymbol[] = [];
  const allDependencies: CodeDependency[] = [];
  const allCalls: CallEdge[] = [];
  const byKind: Record<string, number> = {};

  let filesToAnalyze: string[] = [];

  try {
    // Check if rootPath exists and is a file or directory
    const stats = await stat(rootPath);

    if (stats.isFile()) {
      // Single file
      filesToAnalyze = [rootPath];
    } else if (stats.isDirectory()) {
      // Directory - walk files
      if (options.file) {
        // Specific file within directory
        filesToAnalyze = [options.file];
      } else {
        // All code files in directory (JS/TS, Solidity, and tree-sitter supported languages)
        const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.sol', '.go', '.rs', '.py', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.java'];
        const walkResults = await walkFiles(rootPath);
        filesToAnalyze = walkResults
          .filter(r => CODE_EXTENSIONS.includes(r.extension))
          .map(r => r.absolutePath);
      }
    }
  } catch (error) {
    errors.push(
      `Failed to access path: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      success: false,
      filesAnalyzed: 0,
      stats: {
        totalSymbols: 0,
        totalDependencies: 0,
        totalCalls: 0,
        byKind: {},
      },
      errors,
    };
  }

  // Analyze each file
  for (const file of filesToAnalyze) {
    try {
      const analysis = await analyzeFile(file, rootPath);

      // Collect symbols
      for (const symbol of analysis.symbols) {
        allSymbols.push(symbol);
        byKind[symbol.kind] = (byKind[symbol.kind] || 0) + 1;
      }

      // Collect dependencies
      allDependencies.push(...analysis.dependencies);

      // Collect calls
      allCalls.push(...analysis.calls);

      // Collect errors
      errors.push(...analysis.errors);
    } catch (error) {
      errors.push(
        `Failed to analyze ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const result: AnalyzeResult = {
    success: errors.length === 0,
    filesAnalyzed: filesToAnalyze.length,
    stats: {
      totalSymbols: allSymbols.length,
      totalDependencies: allDependencies.length,
      totalCalls: allCalls.length,
      byKind,
    },
    errors,
  };

  // Add filtered results based on options
  if (options.symbols) {
    result.symbols = allSymbols;
  }

  if (options.deps) {
    result.dependencies = allDependencies;
  }

  if (options.calls) {
    result.calls = allCalls;
  }

  return result;
}
