/**
 * AST-based code analysis - exports all modules
 */

// Type definitions
export type {
  SymbolKind,
  CodeSymbol,
  DependencyKind,
  ImportedName,
  CodeDependency,
  CallEdge,
  FileAnalysis,
} from './types.js';

// Extractors
export { extractSymbols } from './symbol-extractor.js';
export { extractDependencies } from './dependency-extractor.js';
export { extractCalls } from './call-extractor.js';

// Analyzer
export type { AnalyzeOptions, AnalyzeResult } from './analyzer.js';
export { analyzeFile, analyzeProject } from './analyzer.js';
