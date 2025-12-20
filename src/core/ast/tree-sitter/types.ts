/**
 * TypeScript type definitions for tree-sitter parser and language objects
 */

export interface TreeSitterParser {
  setLanguage(language: TreeSitterLanguage): void;
  parse(input: string): Tree;
}

export interface TreeSitterLanguage {
  // Opaque type from grammar modules
  // The actual structure is defined by tree-sitter grammar modules
}

export interface Tree {
  rootNode: SyntaxNode;
  delete?(): void;
}

export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  childCount: number;
  child(index: number): SyntaxNode | null;
  childForFieldName(name: string): SyntaxNode | null;
  children: SyntaxNode[];
  parent: SyntaxNode | null;
}

