/**
 * Centralized language registry for all supported languages
 * Single source of truth for file extensions and parser types
 */

export interface LanguageDefinition {
  name: string;
  extensions: readonly string[];
  parser: 'babel' | 'solidity' | 'tree-sitter';
  treeSitterGrammar?: string;
}

export const LANGUAGES: readonly LanguageDefinition[] = [
  { name: 'JavaScript', extensions: ['.js', '.jsx'], parser: 'babel' },
  { name: 'TypeScript', extensions: ['.ts', '.tsx'], parser: 'babel' },
  { name: 'Solidity', extensions: ['.sol'], parser: 'solidity' },
  { name: 'Go', extensions: ['.go'], parser: 'tree-sitter', treeSitterGrammar: 'go' },
  { name: 'Rust', extensions: ['.rs'], parser: 'tree-sitter', treeSitterGrammar: 'rust' },
  { name: 'Python', extensions: ['.py'], parser: 'tree-sitter', treeSitterGrammar: 'python' },
  { name: 'C', extensions: ['.c', '.h'], parser: 'tree-sitter', treeSitterGrammar: 'c' },
  { name: 'C++', extensions: ['.cpp', '.cc', '.cxx', '.hpp'], parser: 'tree-sitter', treeSitterGrammar: 'cpp' },
  { name: 'Java', extensions: ['.java'], parser: 'tree-sitter', treeSitterGrammar: 'java' },
] as const;

export const ALL_CODE_EXTENSIONS = LANGUAGES.flatMap(l => l.extensions);

export const TREE_SITTER_EXTENSIONS = LANGUAGES
  .filter(l => l.parser === 'tree-sitter')
  .flatMap(l => l.extensions);

export function getLanguage(extension: string): LanguageDefinition | undefined {
  return LANGUAGES.find(l => l.extensions.includes(extension));
}

export function getParserType(extension: string): 'babel' | 'solidity' | 'tree-sitter' | null {
  return getLanguage(extension)?.parser ?? null;
}

export function getTreeSitterGrammar(extension: string): string | undefined {
  const lang = getLanguage(extension);
  return lang?.parser === 'tree-sitter' ? lang.treeSitterGrammar : undefined;
}

export function isSupportedExtension(extension: string): boolean {
  return ALL_CODE_EXTENSIONS.includes(extension);
}

