/**
 * Symbol extraction using tree-sitter for multi-language support
 */

import type { CodeSymbol, SymbolKind } from '../types.js';
import { parseCode, getLanguageName, findNodesByTypes, type SyntaxNode } from './parser.js';

/**
 * Node types to extract for each language
 */
const SYMBOL_TYPES: Record<string, string[]> = {
  go: [
    'function_declaration',
    'method_declaration',
    'type_declaration',
    'type_spec',
    'var_declaration',
    'const_declaration',
  ],
  rust: [
    'function_item',
    'impl_item',
    'struct_item',
    'enum_item',
    'trait_item',
    'mod_item',
    'const_item',
    'static_item',
  ],
  python: [
    'function_definition',
    'class_definition',
  ],
  c: [
    'function_definition',
    'function_declarator',
    'struct_specifier',
    'enum_specifier',
    'type_definition',
  ],
  cpp: [
    'function_definition',
    'function_declarator',
    'class_specifier',
    'struct_specifier',
    'enum_specifier',
    'namespace_definition',
    'template_declaration',
  ],
  java: [
    'class_declaration',
    'interface_declaration',
    'method_declaration',
    'field_declaration',
    'enum_declaration',
    'constructor_declaration',
  ],
};

/**
 * Map tree-sitter node types to our SymbolKind
 */
function mapNodeTypeToSymbolKind(nodeType: string, language: string): SymbolKind {
  switch (language) {
    case 'go':
      if (nodeType === 'function_declaration') return 'function';
      if (nodeType === 'method_declaration') return 'method';
      if (nodeType === 'type_declaration' || nodeType === 'type_spec') return 'type_alias';
      if (nodeType === 'var_declaration') return 'variable';
      if (nodeType === 'const_declaration') return 'constant';
      break;

    case 'rust':
      if (nodeType === 'function_item') return 'function';
      if (nodeType === 'impl_item') return 'class';
      if (nodeType === 'struct_item') return 'class';
      if (nodeType === 'enum_item') return 'enum';
      if (nodeType === 'trait_item') return 'interface';
      if (nodeType === 'mod_item') return 'class';
      if (nodeType === 'const_item') return 'constant';
      if (nodeType === 'static_item') return 'variable';
      break;

    case 'python':
      if (nodeType === 'function_definition') return 'function';
      if (nodeType === 'class_definition') return 'class';
      break;

    case 'c':
      if (nodeType === 'function_definition' || nodeType === 'function_declarator') return 'function';
      if (nodeType === 'struct_specifier') return 'class';
      if (nodeType === 'enum_specifier') return 'enum';
      if (nodeType === 'type_definition') return 'type_alias';
      break;

    case 'cpp':
      if (nodeType === 'function_definition' || nodeType === 'function_declarator') return 'function';
      if (nodeType === 'class_specifier') return 'class';
      if (nodeType === 'struct_specifier') return 'class';
      if (nodeType === 'enum_specifier') return 'enum';
      if (nodeType === 'namespace_definition') return 'class';
      if (nodeType === 'template_declaration') return 'type_alias';
      break;

    case 'java':
      if (nodeType === 'class_declaration') return 'class';
      if (nodeType === 'interface_declaration') return 'interface';
      if (nodeType === 'method_declaration') return 'method';
      if (nodeType === 'field_declaration') return 'property';
      if (nodeType === 'enum_declaration') return 'enum';
      if (nodeType === 'constructor_declaration') return 'method';
      break;
  }

  return 'function';
}

/**
 * Get the name of a symbol from a node
 */
function getSymbolName(node: SyntaxNode, language: string): string | null {
  // Try common field names for name
  const nameNode = node.childForFieldName('name');
  if (nameNode) {
    return nameNode.text;
  }

  // Language-specific fallbacks
  switch (language) {
    case 'go':
      // For type_declaration, the name is inside type_spec
      if (node.type === 'type_declaration') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === 'type_spec') {
            const typeNameNode = child.childForFieldName('name');
            if (typeNameNode) return typeNameNode.text;
          }
        }
      }
      break;

    case 'rust':
      // For impl blocks, the type is the "name"
      if (node.type === 'impl_item') {
        const typeNode = node.childForFieldName('type');
        if (typeNode) {
          // Get the type identifier text (could be Person, Vec<T>, etc.)
          if (typeNode.type === 'type_identifier') {
            return typeNode.text;
          }
          // For generic types like Vec<T>, just get the base name
          for (let i = 0; i < typeNode.childCount; i++) {
            const child = typeNode.child(i);
            if (child?.type === 'type_identifier') {
              return child.text;
            }
          }
          return typeNode.text;
        }
      }
      break;

    case 'c':
    case 'cpp':
      // For function definitions, look for declarator -> identifier
      if (node.type === 'function_definition') {
        const declarator = node.childForFieldName('declarator');
        if (declarator) {
          // Could be a function_declarator or pointer_declarator
          const funcDeclarator = declarator.type === 'function_declarator' ? declarator : declarator.childForFieldName('declarator');
          if (funcDeclarator) {
            const funcName = funcDeclarator.childForFieldName('declarator');
            if (funcName) return funcName.text;
          }
        }
      }
      // For struct/class/enum, look for name child
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'type_identifier') {
          return child.text;
        }
      }
      break;
  }

  return null;
}

/**
 * Extract symbols from code using tree-sitter
 */
export async function extractSymbolsTreeSitter(
  code: string,
  filePath: string,
  relativePath: string,
  extension: string
): Promise<CodeSymbol[]> {
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

  const symbolTypes = SYMBOL_TYPES[language];
  if (!symbolTypes) {
    return [];
  }

  try {
    const nodes = findNodesByTypes(tree.rootNode, symbolTypes);
    const symbols: CodeSymbol[] = [];
    const processedNames = new Set<string>();

    for (const node of nodes) {
      const name = getSymbolName(node, language);
      if (!name) continue;

      // Deduplicate by name + line
      const key = `${name}:${node.startPosition.row}`;
      if (processedNames.has(key)) continue;
      processedNames.add(key);

      const kind = mapNodeTypeToSymbolKind(node.type, language);

      const symbol: CodeSymbol = {
        id: `${relativePath}:${name}:${kind}`,
        name,
        kind,
        filePath,
        relativePath,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
        columnStart: node.startPosition.column,
        columnEnd: node.endPosition.column,
        isExported: false,
        isDefaultExport: false,
        modifiers: [],
      };

      symbols.push(symbol);
    }

    return symbols;
  } catch (error) {
    return [];
  }
}
