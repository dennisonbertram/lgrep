/**
 * Symbol kinds from TypeScript/JavaScript code.
 */
export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'const'
  | 'let'
  | 'enum'
  | 'method'
  | 'property'
  | 'parameter'
  | 'namespace'
  | 'import'
  | 'export';

/**
 * Position in a file.
 */
export interface Position {
  line: number;
  column: number;
}

/**
 * Range spanning start and end positions.
 */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * A code symbol (function, class, variable, etc).
 */
export interface CodeSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  relativePath: string;
  range: Range;
  isExported: boolean;
  isDefaultExport: boolean;
  documentation?: string;
  signature?: string;
  parentId?: string;
  modifiers: string[];
  summary?: string;
  summaryModel?: string;
  summaryGeneratedAt?: string;
}

/**
 * Name imported from a module.
 */
export interface ImportedName {
  name: string;
  alias?: string;
}

/**
 * Dependency kind.
 */
export type DependencyKind = 'import' | 'require' | 'dynamic-import' | 'export-from';

/**
 * A dependency between files.
 */
export interface CodeDependency {
  id: string;
  sourceFile: string;
  targetModule: string;
  resolvedPath?: string;
  kind: DependencyKind;
  names: ImportedName[];
  line: number;
  isExternal: boolean;
}

/**
 * A call from one function to another.
 */
export interface CallEdge {
  id: string;
  callerId?: string;
  callerFile: string;
  calleeName: string;
  calleeId?: string;
  calleeFile?: string;
  position: Position;
  isMethodCall: boolean;
  receiver?: string;
  argumentCount: number;
}
