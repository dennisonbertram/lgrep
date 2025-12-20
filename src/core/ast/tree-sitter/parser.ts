/**
 * Tree-sitter parser initialization and management for multi-language support
 * Uses native tree-sitter bindings for performance
 */

// Lazy-loaded language modules - use unknown to avoid type conflicts
let Parser: unknown = null;
let Go: unknown = null;
let Rust: unknown = null;
let Python: unknown = null;
let C: unknown = null;
let Cpp: unknown = null;
let Java: unknown = null;

// Parser instance cache
let parserInstance: unknown = null;

// Map file extensions to tree-sitter language names
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.go': 'go',
  '.rs': 'rust',
  '.py': 'python',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.java': 'java',
};

/**
 * Initialize the tree-sitter parser (lazy initialization)
 */
async function initParser(): Promise<unknown> {
  if (parserInstance) {
    return parserInstance;
  }

  // Dynamic import to handle native module
  const TreeSitterModule = await import('tree-sitter');
  Parser = TreeSitterModule.default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parserInstance = new (Parser as any)();
  return parserInstance;
}

/**
 * Load a tree-sitter language grammar
 */
async function loadLanguage(langName: string): Promise<unknown> {
  switch (langName) {
    case 'go':
      if (!Go) {
        const mod = await import('tree-sitter-go');
        Go = mod.default;
      }
      return Go;

    case 'rust':
      if (!Rust) {
        const mod = await import('tree-sitter-rust');
        Rust = mod.default;
      }
      return Rust;

    case 'python':
      if (!Python) {
        const mod = await import('tree-sitter-python');
        Python = mod.default;
      }
      return Python;

    case 'c':
      if (!C) {
        const mod = await import('tree-sitter-c');
        C = mod.default;
      }
      return C;

    case 'cpp':
      if (!Cpp) {
        const mod = await import('tree-sitter-cpp');
        Cpp = mod.default;
      }
      return Cpp;

    case 'java':
      if (!Java) {
        const mod = await import('tree-sitter-java');
        Java = mod.default;
      }
      return Java;

    default:
      throw new Error(`Unsupported language: ${langName}`);
  }
}

/**
 * Tree-sitter syntax node interface
 */
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

/**
 * Tree-sitter tree interface
 */
export interface Tree {
  rootNode: SyntaxNode;
}

/**
 * Parse source code using tree-sitter
 * @param code Source code to parse
 * @param extension File extension (e.g., '.go', '.rs')
 * @returns Parsed tree or null if parsing fails
 */
export async function parseCode(code: string, extension: string): Promise<Tree | null> {
  const langName = EXTENSION_TO_LANGUAGE[extension];
  if (!langName) {
    return null;
  }

  try {
    const parser = await initParser();
    const language = await loadLanguage(langName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parser as any).setLanguage(language);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (parser as any).parse(code) as Tree;
  } catch (error) {
    // Gracefully handle parse errors
    return null;
  }
}

/**
 * Check if a file extension is supported by tree-sitter
 */
export function isSupportedByTreeSitter(extension: string): boolean {
  return extension in EXTENSION_TO_LANGUAGE;
}

/**
 * Get the language name for a file extension
 */
export function getLanguageName(extension: string): string | undefined {
  return EXTENSION_TO_LANGUAGE[extension];
}

/**
 * Walk a tree-sitter tree and find all nodes of a given type
 */
export function findNodes(node: SyntaxNode, type: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type) {
    results.push(node);
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      findNodes(child, type, results);
    }
  }
  return results;
}

/**
 * Walk a tree-sitter tree and find all nodes matching any of the given types
 */
export function findNodesByTypes(node: SyntaxNode, types: string[], results: SyntaxNode[] = []): SyntaxNode[] {
  if (types.includes(node.type)) {
    results.push(node);
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      findNodesByTypes(child, types, results);
    }
  }
  return results;
}
