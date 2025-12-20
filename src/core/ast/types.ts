/**
 * Core type definitions for AST-based code analysis
 */

/**
 * Kind of code symbol (function, class, interface, etc.)
 */
export type SymbolKind =
  | 'function'
  | 'arrow_function'
  | 'class'
  | 'method'
  | 'property'
  | 'variable'
  | 'constant'
  | 'interface'
  | 'type_alias'
  | 'enum'
  | 'enum_member'
  | 'event';

/**
 * A code symbol extracted from source code
 */
export interface CodeSymbol {
  /** Unique identifier: "file:name:kind" */
  id: string;
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKind;
  /** Absolute file path */
  filePath: string;
  /** Relative file path (from project root) */
  relativePath: string;
  /** Starting line number (1-based) */
  lineStart: number;
  /** Ending line number (1-based) */
  lineEnd: number;
  /** Starting column (0-based) */
  columnStart: number;
  /** Ending column (0-based) */
  columnEnd: number;
  /** Whether the symbol is exported */
  isExported: boolean;
  /** Whether this is a default export */
  isDefaultExport: boolean;
  /** Function/method signature (if applicable) */
  signature?: string;
  /** JSDoc or TSDoc comment */
  documentation?: string;
  /** Parent symbol ID (for methods, properties, enum members) */
  parentId?: string;
  /** Modifiers (async, static, readonly, etc.) */
  modifiers: string[];
}

/**
 * Kind of dependency relationship
 */
export type DependencyKind =
  | 'import'
  | 'import_type'
  | 'dynamic_import'
  | 'require'
  | 'export'
  | 'export_from'
  | 're_export';

/**
 * An imported name from a module
 */
export interface ImportedName {
  /** Original name in source module */
  name: string;
  /** Local alias (if different from name) */
  alias?: string;
  /** Whether this is a type-only import */
  isTypeOnly: boolean;
  /** Whether this is a default import */
  isDefault: boolean;
  /** Whether this is a namespace import (import * as) */
  isNamespace: boolean;
}

/**
 * A dependency relationship between files
 */
export interface CodeDependency {
  /** Unique identifier */
  id: string;
  /** Source file path (absolute) */
  sourceFile: string;
  /** Target module specifier (as written in code) */
  targetModule: string;
  /** Resolved absolute path (if resolvable) */
  resolvedPath?: string;
  /** Kind of dependency */
  kind: DependencyKind;
  /** Imported/exported names */
  names: ImportedName[];
  /** Line number where dependency appears */
  line: number;
  /** Whether this is an external (node_modules) dependency */
  isExternal: boolean;
}

/**
 * A function/method call edge in the call graph
 */
export interface CallEdge {
  /** Unique identifier */
  id: string;
  /** Symbol ID of the caller */
  callerId: string;
  /** File containing the caller */
  callerFile: string;
  /** Name of the called function/method */
  calleeName: string;
  /** Symbol ID of the callee (if resolvable) */
  calleeId?: string;
  /** File containing the callee (if resolvable) */
  calleeFile?: string;
  /** Line number of the call */
  line: number;
  /** Column number of the call */
  column: number;
  /** Whether this is a method call (vs function call) */
  isMethodCall: boolean;
  /** Receiver object for method calls */
  receiver?: string;
  /** Number of arguments passed */
  argumentCount: number;
}

/**
 * Complete analysis result for a single file
 */
export interface FileAnalysis {
  /** Absolute file path */
  filePath: string;
  /** Relative file path (from project root) */
  relativePath: string;
  /** File extension */
  extension: string;
  /** Content hash (for change detection) */
  contentHash: string;
  /** Symbols found in this file */
  symbols: CodeSymbol[];
  /** Dependencies (imports/exports) */
  dependencies: CodeDependency[];
  /** Function/method calls */
  calls: CallEdge[];
  /** Parse/analysis errors */
  errors: string[];
  /** Timestamp of analysis */
  analyzedAt: string;
}
