/**
 * Dependency extraction using tree-sitter for multi-language support
 */

import type { Dependency } from '../dependency-extractor.js';
import { parseCode, getLanguageName, findNodesByTypes, type SyntaxNode } from './parser.js';

/**
 * Node types that represent imports for each language
 */
const IMPORT_TYPES: Record<string, string[]> = {
  go: ['import_declaration', 'import_spec'],
  rust: ['use_declaration', 'extern_crate_declaration'],
  python: ['import_statement', 'import_from_statement'],
  c: ['preproc_include'],
  cpp: ['preproc_include'],
  java: ['import_declaration'],
};

/**
 * Clean import path string (remove quotes)
 */
function cleanImportPath(path: string): string {
  return path.replace(/^["']|["']$/g, '');
}

/**
 * Determine if an import path is external
 */
function isExternalModule(source: string, language: string): boolean {
  switch (language) {
    case 'go':
      return !source.startsWith('./') && !source.startsWith('../');
    case 'rust':
      return !source.startsWith('crate::') && !source.startsWith('self::') && !source.startsWith('super::');
    case 'python':
      return !source.startsWith('.');
    case 'c':
    case 'cpp':
      // System headers use <>, local use ""
      return !source.startsWith('"');
    case 'java':
      return true; // Java imports are always package paths
    default:
      return true;
  }
}

/**
 * Get import path from a node
 */
function getImportPath(node: SyntaxNode, language: string): string | null {
  switch (language) {
    case 'go': {
      // import "fmt" or import_spec node
      if (node.type === 'import_spec') {
        const pathNode = node.childForFieldName('path');
        if (pathNode) {
          return cleanImportPath(pathNode.text);
        }
      }
      // Single import
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'interpreted_string_literal') {
          return cleanImportPath(child.text);
        }
        if (child?.type === 'import_spec') {
          const pathNode = child.childForFieldName('path');
          if (pathNode) {
            return cleanImportPath(pathNode.text);
          }
        }
        if (child?.type === 'import_spec_list') {
          // Skip - we'll process individual import_specs
          return null;
        }
      }
      return null;
    }

    case 'rust': {
      // use std::collections::HashMap;
      if (node.type === 'extern_crate_declaration') {
        const nameNode = node.childForFieldName('name');
        return nameNode?.text ?? null;
      }
      const argNode = node.childForFieldName('argument');
      if (argNode) {
        return argNode.text;
      }
      return null;
    }

    case 'python': {
      // import os or from os import path
      if (node.type === 'import_statement') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          return nameNode.text;
        }
        // Multiple imports: import os, sys
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === 'dotted_name') {
            return child.text;
          }
        }
      }
      if (node.type === 'import_from_statement') {
        const moduleNode = node.childForFieldName('module_name');
        if (moduleNode) {
          return moduleNode.text;
        }
      }
      return null;
    }

    case 'c':
    case 'cpp': {
      // #include <stdio.h> or #include "myheader.h"
      const pathNode = node.childForFieldName('path');
      if (pathNode) {
        const path = pathNode.text;
        // Remove < > or " "
        return path.replace(/^[<"]|[>"]$/g, '');
      }
      return null;
    }

    case 'java': {
      // import java.util.List;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'scoped_identifier') {
          return child.text;
        }
      }
      return null;
    }
  }

  return null;
}

/**
 * Extract dependencies from code using tree-sitter
 */
export async function extractDependenciesTreeSitter(
  code: string,
  filePath: string,
  extension: string
): Promise<Dependency[]> {
  if (!code.trim()) {
    return [];
  }

  const tree = await parseCode(code, extension);
  if (!tree) {
    return [];
  }

  const language = getLanguageName(extension);
  if (!language) {
    return [];
  }

  const importTypes = IMPORT_TYPES[language];
  if (!importTypes) {
    return [];
  }

  try {
    const nodes = findNodesByTypes(tree.rootNode, importTypes);
    const dependencies: Dependency[] = [];
    const processedPaths = new Set<string>();

    for (const node of nodes) {
      const source = getImportPath(node, language);
      if (!source) continue;

      // Deduplicate
      const key = `${source}:${node.startPosition.row}`;
      if (processedPaths.has(key)) continue;
      processedPaths.add(key);

      const isExternal = isExternalModule(source, language);

      dependencies.push({
        type: 'import',
        source,
        isExternal,
        imported: [],
        isTypeOnly: false,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      });
    }

    return dependencies;
  } catch (error) {
    // Log error but don't fail analysis
    console.warn(`Failed to extract dependencies from ${filePath}:`, error instanceof Error ? error.message : String(error));
    return [];
  }
}
