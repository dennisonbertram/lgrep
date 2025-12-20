import { describe, it, expect } from 'vitest';
import {
  LANGUAGES,
  ALL_CODE_EXTENSIONS,
  TREE_SITTER_EXTENSIONS,
  getLanguage,
  getParserType,
  getTreeSitterGrammar,
  isSupportedExtension,
} from './languages.js';

describe('languages', () => {
  it('should have all expected languages', () => {
    expect(LANGUAGES.length).toBeGreaterThan(0);
    expect(LANGUAGES.some(l => l.name === 'JavaScript')).toBe(true);
    expect(LANGUAGES.some(l => l.name === 'TypeScript')).toBe(true);
    expect(LANGUAGES.some(l => l.name === 'Go')).toBe(true);
    expect(LANGUAGES.some(l => l.name === 'Rust')).toBe(true);
  });

  it('should get language by extension', () => {
    expect(getLanguage('.js')?.name).toBe('JavaScript');
    expect(getLanguage('.ts')?.name).toBe('TypeScript');
    expect(getLanguage('.go')?.name).toBe('Go');
    expect(getLanguage('.rs')?.name).toBe('Rust');
    expect(getLanguage('.unknown')).toBeUndefined();
  });

  it('should get parser type by extension', () => {
    expect(getParserType('.js')).toBe('babel');
    expect(getParserType('.ts')).toBe('babel');
    expect(getParserType('.sol')).toBe('solidity');
    expect(getParserType('.go')).toBe('tree-sitter');
    expect(getParserType('.rs')).toBe('tree-sitter');
    expect(getParserType('.unknown')).toBeNull();
  });

  it('should get tree-sitter grammar by extension', () => {
    expect(getTreeSitterGrammar('.go')).toBe('go');
    expect(getTreeSitterGrammar('.rs')).toBe('rust');
    expect(getTreeSitterGrammar('.py')).toBe('python');
    expect(getTreeSitterGrammar('.js')).toBeUndefined();
    expect(getTreeSitterGrammar('.sol')).toBeUndefined();
  });

  it('should check if extension is supported', () => {
    expect(isSupportedExtension('.js')).toBe(true);
    expect(isSupportedExtension('.ts')).toBe(true);
    expect(isSupportedExtension('.go')).toBe(true);
    expect(isSupportedExtension('.unknown')).toBe(false);
  });

  it('should include all code extensions', () => {
    expect(ALL_CODE_EXTENSIONS).toContain('.js');
    expect(ALL_CODE_EXTENSIONS).toContain('.ts');
    expect(ALL_CODE_EXTENSIONS).toContain('.go');
    expect(ALL_CODE_EXTENSIONS).toContain('.rs');
    expect(ALL_CODE_EXTENSIONS).toContain('.sol');
  });

  it('should include only tree-sitter extensions', () => {
    expect(TREE_SITTER_EXTENSIONS).toContain('.go');
    expect(TREE_SITTER_EXTENSIONS).toContain('.rs');
    expect(TREE_SITTER_EXTENSIONS).toContain('.py');
    expect(TREE_SITTER_EXTENSIONS).not.toContain('.js');
    expect(TREE_SITTER_EXTENSIONS).not.toContain('.sol');
  });
});

