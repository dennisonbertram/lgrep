import type { CodeSymbol } from './code-intel.js';

/**
 * A file with its relevance score and content.
 */
export interface RelevantFile {
  filePath: string;
  relativePath: string;
  score: number;
  relevance: number; // 0-1 relevance score
  reason: string; // Why this file is relevant
  content?: string;
  summary?: string;
}

/**
 * A key symbol with relevance score.
 */
export interface KeySymbol {
  name: string;
  kind: string;
  file: string;
  summary: string;
  symbol: CodeSymbol;
  score: number;
  distance: number; // Graph distance from initial matches
}

/**
 * Options for building context.
 */
export interface ContextOptions {
  /** Maximum number of files to include */
  limit?: number;
  /** Maximum total tokens in the context package */
  maxTokens?: number;
  /** Maximum graph traversal depth */
  depth?: number;
  /** Exclude code snippets (summary only) */
  includeCode?: boolean;
  /** Generate approach suggestions */
  generateApproach?: boolean;
}

/**
 * A step in the suggested approach.
 */
export interface ApproachStep {
  step: number;
  description: string;
}

/**
 * A complete context package for an LLM.
 */
export interface ContextPackage {
  task: string;
  indexName: string;
  relevantFiles: RelevantFile[];
  keySymbols: KeySymbol[];
  suggestedApproach: ApproachStep[];
  tokenCount: number;
  timestamp: string;
  // Legacy fields for backward compatibility
  files?: RelevantFile[];
  symbols?: KeySymbol[];
}
