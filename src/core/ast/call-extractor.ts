import { parse } from '@babel/parser';
import traverseDefault, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { parse as parseSolidity, visit } from '@solidity-parser/parser';
import { isSupportedByTreeSitter, extractCallsTreeSitter } from './tree-sitter/index.js';

// Handle CommonJS default export
const traverse = (traverseDefault as unknown as { default: typeof traverseDefault }).default || traverseDefault;

export interface FunctionCall {
  callee: string;
  caller: string | null;
  receiver?: string;
  type: 'function' | 'method' | 'constructor';
  argumentCount: number;
  line?: number;
  column?: number;
}

/**
 * Get the receiver expression as a string (e.g., "obj.prop" for obj.prop.method())
 */
function getReceiverString(node: t.MemberExpression): string {
  const parts: string[] = [];
  let current: t.Expression | t.Super | t.PrivateName = node.object;

  while (true) {
    if (t.isIdentifier(current)) {
      parts.unshift(current.name);
      break;
    } else if (t.isThisExpression(current)) {
      parts.unshift('this');
      break;
    } else if (t.isMemberExpression(current)) {
      const propertyName = t.isIdentifier(current.property)
        ? current.property.name
        : t.isPrivateName(current.property)
        ? `#${current.property.id.name}`
        : '(computed)';
      parts.unshift(propertyName);
      current = current.object;
    } else if (t.isCallExpression(current)) {
      // For chained calls like foo().bar(), represent the call as "foo()"
      const calleeName = getCallExpressionName(current);
      parts.unshift(`${calleeName}()`);
      break;
    } else {
      parts.unshift('(expression)');
      break;
    }
  }

  return parts.join('.');
}

/**
 * Get the name of a call expression callee
 */
function getCallExpressionName(node: t.CallExpression): string {
  if (t.isIdentifier(node.callee)) {
    return node.callee.name;
  } else if (t.isMemberExpression(node.callee)) {
    const property = node.callee.property;
    if (t.isIdentifier(property)) {
      return property.name;
    } else if (t.isPrivateName(property)) {
      return `#${property.id.name}`;
    }
  } else if (t.isFunctionExpression(node.callee) || t.isArrowFunctionExpression(node.callee)) {
    return '(anonymous)';
  }
  return '(unknown)';
}

/**
 * Build a caller context string from the scope stack
 */
function buildCallerContext(scopeStack: string[]): string | null {
  return scopeStack.length > 0 ? scopeStack.join('.') : null;
}

/**
 * Extract function calls from JavaScript/TypeScript code using Babel
 */
export async function extractCallsBabel(code: string, filePath: string): Promise<FunctionCall[]> {
  if (!code.trim()) {
    return [];
  }

  const extension = filePath.split('.').pop() || '';
  const calls: FunctionCall[] = [];
  const scopeStack: string[] = [];

  // Determine parser plugins based on file extension
  const plugins: ('jsx' | 'typescript' | 'decorators-legacy')[] = ['jsx'];
  if (extension === 'ts' || extension === 'tsx') {
    plugins.push('typescript', 'decorators-legacy');
  }

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins,
      errorRecovery: true,
    });
  } catch (error) {
    return [];
  }

  traverse(ast, {
    // Track function declarations
    FunctionDeclaration: {
      enter(path) {
        const name = path.node.id?.name || '(anonymous)';
        scopeStack.push(name);
      },
      exit() {
        scopeStack.pop();
      },
    },

    // Track arrow functions and function expressions
    VariableDeclarator: {
      enter(path) {
        const init = path.node.init;
        if (
          init &&
          (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init))
        ) {
          const name = t.isIdentifier(path.node.id) ? path.node.id.name : '(anonymous)';
          scopeStack.push(name);
        }
      },
      exit(path) {
        const init = path.node.init;
        if (
          init &&
          (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init))
        ) {
          scopeStack.pop();
        }
      },
    },

    // Track class methods
    ClassMethod: {
      enter(path) {
        const className = getParentClassName(path);
        let methodName: string;
        const key = path.node.key;
        if (t.isIdentifier(key)) {
          methodName = key.name;
        } else if (t.isPrivateName(key)) {
          // PrivateName has an 'id' property which is an Identifier
          methodName = `#${(key as unknown as { id: t.Identifier }).id.name}`;
        } else {
          methodName = '(computed)';
        }

        if (className) {
          scopeStack.push(`${className}.${methodName}`);
        } else {
          scopeStack.push(methodName);
        }
      },
      exit() {
        scopeStack.pop();
      },
    },

    // Track object methods
    ObjectMethod: {
      enter(path) {
        const methodName = t.isIdentifier(path.node.key)
          ? path.node.key.name
          : '(computed)';
        scopeStack.push(methodName);
      },
      exit() {
        scopeStack.pop();
      },
    },

    // Extract call expressions
    CallExpression(path) {
      const node = path.node;
      let callee: string;
      let receiver: string | undefined;
      let callType: 'function' | 'method' = 'function';

      if (t.isIdentifier(node.callee)) {
        // Simple function call: foo()
        callee = node.callee.name;
      } else if (t.isMemberExpression(node.callee)) {
        // Method call: obj.method()
        callType = 'method';
        receiver = getReceiverString(node.callee);

        const property = node.callee.property;
        if (t.isIdentifier(property)) {
          callee = property.name;
        } else if (t.isPrivateName(property)) {
          callee = `#${property.id.name}`;
        } else {
          callee = '(computed)';
        }
      } else if (t.isFunctionExpression(node.callee) || t.isArrowFunctionExpression(node.callee)) {
        // IIFE
        callee = '(anonymous)';
      } else {
        // Other cases (unlikely)
        callee = '(unknown)';
      }

      calls.push({
        callee,
        caller: buildCallerContext(scopeStack),
        receiver,
        type: callType,
        argumentCount: node.arguments.length,
        line: node.loc?.start.line,
        column: node.loc?.start.column,
      });
    },

    // Extract new expressions (constructor calls)
    NewExpression(path) {
      const node = path.node;
      let callee: string;

      if (t.isIdentifier(node.callee)) {
        callee = node.callee.name;
      } else if (t.isMemberExpression(node.callee)) {
        const property = node.callee.property;
        callee = t.isIdentifier(property) ? property.name : '(computed)';
      } else {
        callee = '(unknown)';
      }

      calls.push({
        callee,
        caller: buildCallerContext(scopeStack),
        type: 'constructor',
        argumentCount: node.arguments.length,
        line: node.loc?.start.line,
        column: node.loc?.start.column,
      });
    },
  });

  return calls;
}

/**
 * Extract all function calls from source code (dispatcher - kept for backwards compatibility)
 * @deprecated Use specific extractors directly based on parser type
 */
export async function extractCalls(code: string, filePath: string): Promise<FunctionCall[]> {
  if (!code.trim()) {
    return [];
  }

  // Dispatch to Solidity extraction for .sol files
  const extension = filePath.split('.').pop() || '';
  if (extension === 'sol') {
    return extractSolidityCalls(code, filePath);
  }

  // Dispatch to tree-sitter for supported languages
  if (isSupportedByTreeSitter(`.${extension}`)) {
    return extractCallsTreeSitter(code, filePath, `.${extension}`);
  }

  // Default to Babel for JS/TS
  return extractCallsBabel(code, filePath);
}

/**
 * Get the parent class name for a method
 */
function getParentClassName(path: NodePath): string | null {
  let currentPath: NodePath | null = path.parentPath;

  while (currentPath) {
    if (t.isClassDeclaration(currentPath.node) || t.isClassExpression(currentPath.node)) {
      if (t.isClassDeclaration(currentPath.node) && currentPath.node.id) {
        return currentPath.node.id.name;
      }
      // For class expressions, try to find the variable name
      const parent = currentPath.parentPath;
      if (parent && t.isVariableDeclarator(parent.node) && t.isIdentifier(parent.node.id)) {
        return parent.node.id.name;
      }
      return null;
    }
    currentPath = currentPath.parentPath;
  }

  return null;
}

/**
 * Extract function calls from Solidity source code
 */
export function extractSolidityCalls(code: string, filePath: string): FunctionCall[] {
  try {
    const ast = parseSolidity(code, { loc: true, range: true, tolerant: true });

    const calls: FunctionCall[] = [];
    const scopeStack: string[] = [];

    // Visit AST nodes
    // @ts-ignore - Solidity parser types are not well-defined
    visit(ast, {
      // @ts-ignore - Track function definitions for caller context
      FunctionDefinition: (node: { name: string | null; isConstructor?: boolean; isReceiveEther?: boolean; isFallback?: boolean }) => {
        let functionName: string;
        if (node.isConstructor) {
          functionName = 'constructor';
        } else if (node.isReceiveEther) {
          functionName = 'receive';
        } else if (node.isFallback) {
          functionName = 'fallback';
        } else {
          functionName = node.name || '(anonymous)';
        }
        scopeStack.push(functionName);
      },

      // @ts-ignore - Track modifiers
      // Track modifiers for caller context
      ModifierDefinition: (node: { name: string }) => {
        scopeStack.push(node.name);
      },

      // @ts-ignore - Function calls
      // Function calls (direct calls like foo())
      FunctionCall: (node: {
        expression: { type: string; name?: string; memberName?: string };
        arguments?: unknown[];
        names?: unknown[];
        loc?: { start: { line: number; column: number } };
      }) => {
        const expression = node.expression;
        let callee: string;
        let receiver: string | undefined;
        let callType: 'function' | 'method' = 'function';

        if (expression.type === 'Identifier' && expression.name) {
          // Simple function call: foo()
          callee = expression.name;
        } else if (expression.type === 'MemberAccess' && expression.memberName) {
          // Method call: obj.foo()
          callType = 'method';
          callee = expression.memberName;
          // Try to get receiver name (simplified)
          // @ts-ignore - Type mismatch with Solidity parser types
          receiver = getReceiverName(expression);
        } else {
          callee = '(unknown)';
        }

        calls.push({
          callee,
          caller: scopeStack.length > 0 ? scopeStack.join('.') : null,
          receiver,
          type: callType,
          argumentCount: node.arguments?.length || 0,
          line: node.loc?.start.line,
          column: node.loc?.start.column,
        });
      },

      // Event emissions (emit Transfer(...))
      EmitStatement: (node: {
        eventCall: {
          expression: { type: string; name?: string };
          arguments?: unknown[];
        };
        loc?: { start: { line: number; column: number } };
      }) => {
      // @ts-ignore - Event emissions
        const expression = node.eventCall.expression;
        if (expression.type === 'Identifier' && expression.name) {
          calls.push({
            callee: expression.name,
            caller: scopeStack.length > 0 ? scopeStack.join('.') : null,
            type: 'function',
            argumentCount: node.eventCall.arguments?.length || 0,
            line: node.loc?.start.line,
            column: node.loc?.start.column,
          });
        }
      },

      // New expressions (new MyContract())
      NewExpression: (node: {
        typeName: { type: string; namePath?: string; name?: string };
        loc?: { start: { line: number; column: number } };
      }) => {
        let callee: string;
        if (node.typeName.type === 'UserDefinedTypeName' && node.typeName.namePath) {
          callee = node.typeName.namePath;
      // @ts-ignore - New expressions
        } else if (node.typeName.name) {
          callee = node.typeName.name;
        } else {
          callee = '(unknown)';
        }

        calls.push({
          callee,
          caller: scopeStack.length > 0 ? scopeStack.join('.') : null,
          type: 'constructor',
          argumentCount: 0, // Arguments aren't on NewExpression in this parser
          line: node.loc?.start.line,
          column: node.loc?.start.column,
        });
      },
    });

    return calls;
  } catch (error) {
    // Gracefully handle parse errors
    return [];
  }
}

/**
 * Helper to extract receiver name from Solidity MemberAccess expression
 */
function getReceiverName(expression: { expression?: unknown }): string | undefined {
  if (!expression.expression) {
    return undefined;
  }

  const expr = expression.expression as {
    type?: string;
    name?: string;
    memberName?: string;
    expression?: unknown;
  };

  if (expr.type === 'Identifier' && expr.name) {
    return expr.name;
  } else if (expr.type === 'MemberAccess') {
    // Nested member access - simplified version
    const nested = getReceiverName(expr);
    if (nested && expr.memberName) {
      return `${nested}.${expr.memberName}`;
    }
    return expr.memberName;
  }

  return undefined;
}
