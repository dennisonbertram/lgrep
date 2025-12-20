/**
 * Tree-sitter parser initialization and management for multi-language support
 * Uses native tree-sitter bindings for performance
 */

import { createHash } from 'node:crypto';
import { getTreeSitterGrammar, isSupportedExtension } from '../languages.js';

import type { TreeSitterParser, TreeSitterLanguage } from './types.js';

// Lazy-loaded language modules - use unknown to avoid type conflicts
let Parser: typeof TreeSitterParser | null = null;
let Go: TreeSitterLanguage | null = null;
let Rust: TreeSitterLanguage | null = null;
let Python: TreeSitterLanguage | null = null;
let C: TreeSitterLanguage | null = null;
let Cpp: TreeSitterLanguage | null = null;
let Java: TreeSitterLanguage | null = null;

// Parser pool: one parser instance per language (fixes race condition)
const parserPool = new Map<string, TreeSitterParser>();

// Parse tree cache with LRU eviction
interface CachedTree {
  hash: string;
  tree: Tree;
  language: string;
}

const treeCache = new Map<string, CachedTree>();
const MAX_CACHE_SIZE = 50;

/**
 * Get or create a parser instance for a specific language
 * Each language has its own parser instance to avoid race conditions
 */
async function getParserForLanguage(grammarName: string): Promise<TreeSitterParser> {
  if (!parserPool.has(grammarName)) {
    const TreeSitterModule = await import('tree-sitter');
    if (!Parser) {
      Parser = TreeSitterModule.default as typeof TreeSitterParser;
    }
    const parser = new (Parser as new () => TreeSitterParser)();
    const grammar = await loadGrammar(grammarName);
    parser.setLanguage(grammar);
    parserPool.set(grammarName, parser);
  }
  return parserPool.get(grammarName)!;
}

/**
 * Load a tree-sitter language grammar
 */
async function loadGrammar(langName: string): Promise<TreeSitterLanguage> {
  switch (langName) {
    case 'go':
      if (!Go) {
        const mod = await import('tree-sitter-go');
        Go = mod.default;
      }
      return Go as TreeSitterLanguage;

    case 'rust':
      if (!Rust) {
        const mod = await import('tree-sitter-rust');
        Rust = mod.default as TreeSitterLanguage;
      }
      return Rust as TreeSitterLanguage;

    case 'python':
      if (!Python) {
        const mod = await import('tree-sitter-python');
        Python = mod.default as TreeSitterLanguage;
      }
      return Python as TreeSitterLanguage;

    case 'c':
      if (!C) {
        const mod = await import('tree-sitter-c');
        C = mod.default as TreeSitterLanguage;
      }
      return C as TreeSitterLanguage;

    case 'cpp':
      if (!Cpp) {
        const mod = await import('tree-sitter-cpp');
        Cpp = mod.default as TreeSitterLanguage;
      }
      return Cpp as TreeSitterLanguage;

    case 'java':
      if (!Java) {
        const mod = await import('tree-sitter-java');
        Java = mod.default as TreeSitterLanguage;
      }
      return Java as TreeSitterLanguage;

    default:
      throw new Error(`Unsupported language: ${langName}`);
  }
}

// Re-export types from types.ts
export type { SyntaxNode, Tree, TreeSitterParser, TreeSitterLanguage } from './types.js';

/**
 * Parse source code using tree-sitter with caching
 * @param code Source code to parse
 * @param extension File extension (e.g., '.go', '.rs')
 * @param options Optional parsing options
 * @returns Parsed tree or null if parsing fails
 */
export async function parseCode(
  code: string,
  extension: string,
  options?: { useCache?: boolean }
): Promise<Tree | null> {
  const grammarName = getTreeSitterGrammar(extension);
  if (!grammarName) {
    return null;
  }

  // Check cache
  if (options?.useCache !== false) {
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
    const cacheKey = `${extension}:${hash}`;
    const cached = treeCache.get(cacheKey);
    if (cached && cached.language === grammarName) {
      return cached.tree;
    }
  }

  try {
    const parser = await getParserForLanguage(grammarName);
    const tree = parser.parse(code);

    // Cache the result
    if (options?.useCache !== false) {
      const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
      const cacheKey = `${extension}:${hash}`;

      // LRU eviction
      if (treeCache.size >= MAX_CACHE_SIZE) {
        const firstKey = treeCache.keys().next().value;
        const evicted = treeCache.get(firstKey);
        if (evicted?.tree?.delete) {
          evicted.tree.delete();
        }
        treeCache.delete(firstKey);
      }

      treeCache.set(cacheKey, { hash, tree, language: grammarName });
    }

    return tree;
  } catch (error) {
    // Gracefully handle parse errors
    return null;
  }
}

/**
 * Clear the parse tree cache and free memory
 */
export function clearTreeCache(): void {
  for (const cached of treeCache.values()) {
    if (cached.tree?.delete) {
      cached.tree.delete();
    }
  }
  treeCache.clear();
}

/**
 * Check if a file extension is supported by tree-sitter
 */
export function isSupportedByTreeSitter(extension: string): boolean {
  return isSupportedExtension(extension) && getTreeSitterGrammar(extension) !== undefined;
}

/**
 * Get the language name for a file extension
 */
export function getLanguageName(extension: string): string | undefined {
  return getTreeSitterGrammar(extension);
}

/**
 * Walk a tree-sitter tree and find all nodes matching any of the given types
 * Uses iterative traversal with Set for O(1) lookup (optimized from Phase 2.2)
 */
export function findNodesByTypes(
  root: SyntaxNode,
  types: string[]
): SyntaxNode[] {
  const typeSet = new Set(types);
  const results: SyntaxNode[] = [];
  const stack: SyntaxNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (typeSet.has(node.type)) {
      results.push(node);
    }

    // Add children in reverse order for correct traversal
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }

  return results;
}

/**
 * Walk a tree-sitter tree and find all nodes of a given type
 * Wrapper around findNodesByTypes for convenience
 */
export function findNodes(root: SyntaxNode, type: string): SyntaxNode[] {
  return findNodesByTypes(root, [type]);
}
