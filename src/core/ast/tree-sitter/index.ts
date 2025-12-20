/**
 * Tree-sitter module exports for multi-language code intelligence
 */

export { parseCode, isSupportedByTreeSitter, getLanguageName, findNodes, findNodesByTypes, type SyntaxNode, type Tree } from './parser.js';
export { extractSymbolsTreeSitter } from './symbol-extractor.js';
export { extractCallsTreeSitter } from './call-extractor.js';
export { extractDependenciesTreeSitter } from './dependency-extractor.js';
