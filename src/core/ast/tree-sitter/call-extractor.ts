/**
 * Function call extraction using tree-sitter for multi-language support
 */

import type { FunctionCall } from '../call-extractor.js';
import { parseCode, getLanguageName, findNodesByTypes, type SyntaxNode } from './parser.js';

/**
 * Node types that represent function/method calls for each language
 */
const CALL_TYPES: Record<string, string[]> = {
  go: ['call_expression'],
  rust: ['call_expression', 'macro_invocation'],
  python: ['call'],
  c: ['call_expression'],
  cpp: ['call_expression'],
  java: ['method_invocation', 'object_creation_expression'],
};

/**
 * Get the callee name from a call node
 */
function getCalleeName(node: SyntaxNode, language: string): string | null {
  switch (language) {
    case 'go': {
      const funcNode = node.childForFieldName('function');
      if (!funcNode) return null;
      // Simple identifier call: greet()
      if (funcNode.type === 'identifier') {
        return funcNode.text;
      }
      // Method call: obj.Method()
      if (funcNode.type === 'selector_expression') {
        const fieldNode = funcNode.childForFieldName('field');
        return fieldNode?.text ?? null;
      }
      return null;
    }

    case 'rust': {
      // Macro invocation: println!()
      if (node.type === 'macro_invocation') {
        const macroNode = node.childForFieldName('macro');
        return macroNode?.text ?? null;
      }
      // Regular call
      const funcNode = node.childForFieldName('function');
      if (!funcNode) return null;
      if (funcNode.type === 'identifier') {
        return funcNode.text;
      }
      // Method call: obj.method()
      if (funcNode.type === 'field_expression') {
        const fieldNode = funcNode.childForFieldName('field');
        return fieldNode?.text ?? null;
      }
      // Scoped call: module::func()
      if (funcNode.type === 'scoped_identifier') {
        const nameNode = funcNode.childForFieldName('name');
        return nameNode?.text ?? null;
      }
      return null;
    }

    case 'python': {
      const funcNode = node.childForFieldName('function');
      if (!funcNode) return null;
      if (funcNode.type === 'identifier') {
        return funcNode.text;
      }
      // Method call: obj.method()
      if (funcNode.type === 'attribute') {
        const attrNode = funcNode.childForFieldName('attribute');
        return attrNode?.text ?? null;
      }
      return null;
    }

    case 'c':
    case 'cpp': {
      const funcNode = node.childForFieldName('function');
      if (!funcNode) return null;
      if (funcNode.type === 'identifier') {
        return funcNode.text;
      }
      // Method call: obj.method() or obj->method()
      if (funcNode.type === 'field_expression') {
        const fieldNode = funcNode.childForFieldName('field');
        return fieldNode?.text ?? null;
      }
      return null;
    }

    case 'java': {
      if (node.type === 'object_creation_expression') {
        const typeNode = node.childForFieldName('type');
        return typeNode?.text ?? null;
      }
      // Method invocation
      const nameNode = node.childForFieldName('name');
      return nameNode?.text ?? null;
    }
  }

  return null;
}

/**
 * Get the call type
 */
function getCallType(node: SyntaxNode, language: string): 'function' | 'method' | 'constructor' {
  if (language === 'rust' && node.type === 'macro_invocation') {
    return 'function';
  }
  if (language === 'java' && node.type === 'object_creation_expression') {
    return 'constructor';
  }

  // Check if it's a method call
  switch (language) {
    case 'go': {
      const funcNode = node.childForFieldName('function');
      if (funcNode?.type === 'selector_expression') {
        return 'method';
      }
      break;
    }
    case 'rust': {
      const funcNode = node.childForFieldName('function');
      if (funcNode?.type === 'field_expression') {
        return 'method';
      }
      break;
    }
    case 'python': {
      const funcNode = node.childForFieldName('function');
      if (funcNode?.type === 'attribute') {
        return 'method';
      }
      break;
    }
    case 'c':
    case 'cpp': {
      const funcNode = node.childForFieldName('function');
      if (funcNode?.type === 'field_expression') {
        return 'method';
      }
      break;
    }
    case 'java': {
      if (node.type === 'method_invocation') {
        const objectNode = node.childForFieldName('object');
        if (objectNode) {
          return 'method';
        }
      }
      break;
    }
  }

  return 'function';
}

/**
 * Find the enclosing function name
 */
function findEnclosingFunction(node: SyntaxNode, language: string): string | undefined {
  let current: SyntaxNode | null = node.parent;

  const functionTypes: Record<string, string[]> = {
    go: ['function_declaration', 'method_declaration'],
    rust: ['function_item'],
    python: ['function_definition'],
    c: ['function_definition'],
    cpp: ['function_definition'],
    java: ['method_declaration', 'constructor_declaration'],
  };

  const types = functionTypes[language] || [];

  while (current) {
    if (types.includes(current.type)) {
      const nameNode = current.childForFieldName('name');
      return nameNode?.text;
    }
    current = current.parent;
  }

  return undefined;
}

/**
 * Extract function calls from code using tree-sitter
 */
export async function extractCallsTreeSitter(
  code: string,
  filePath: string,
  extension: string
): Promise<FunctionCall[]> {
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

  const callTypes = CALL_TYPES[language];
  if (!callTypes) {
    return [];
  }

  try {
    const nodes = findNodesByTypes(tree.rootNode, callTypes);
    const calls: FunctionCall[] = [];

    for (const node of nodes) {
      const callee = getCalleeName(node, language);
      if (!callee) continue;

      const caller = findEnclosingFunction(node, language);
      const callType = getCallType(node, language);

      // Count arguments
      let argumentCount = 0;
      const argumentsNode = node.childForFieldName('arguments');
      if (argumentsNode) {
        // Count comma-separated arguments
        argumentCount = argumentsNode.childCount > 0 ? argumentsNode.childCount : 0;
      }

      calls.push({
        callee,
        caller: caller ?? null,
        type: callType,
        argumentCount,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      });
    }

    return calls;
  } catch (error) {
    // Log error but don't fail analysis
    console.warn(`Failed to extract calls from ${filePath}:`, error instanceof Error ? error.message : String(error));
    return [];
  }
}
