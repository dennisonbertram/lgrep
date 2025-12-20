/**
 * Symbol extraction from JavaScript/TypeScript code using Babel AST,
 * Solidity code using @solidity-parser/parser,
 * and multi-language support using tree-sitter
 */

import * as parser from '@babel/parser';
import traverseDefault, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { CodeSymbol, SymbolKind } from './types.js';
import { parse as parseSolidity, visit } from '@solidity-parser/parser';
import { isSupportedByTreeSitter, extractSymbolsTreeSitter } from './tree-sitter/index.js';

// Handle CommonJS default export
const traverse = (traverseDefault as unknown as { default: typeof traverseDefault }).default || traverseDefault;

/**
 * Extract symbols from JavaScript/TypeScript code using Babel
 */
export async function extractSymbolsBabel(
  code: string,
  filePath: string,
  relativePath: string,
  extension: string
): Promise<CodeSymbol[]> {
  try {
    // Determine parser plugins based on extension
    const plugins: parser.ParserPlugin[] = ['jsx'];
    if (extension === '.ts' || extension === '.tsx') {
      plugins.push('typescript', 'decorators-legacy');
    }

    // Parse the code with error recovery
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins,
      errorRecovery: true,
    });

    const symbols: CodeSymbol[] = [];

    // Calculate line and column from position
    const getLocation = (start: number | null | undefined, end: number | null | undefined) => {
      if (start === null || start === undefined || end === null || end === undefined) {
        return { lineStart: 1, lineEnd: 1, columnStart: 0, columnEnd: 0 };
      }

      // Count lines and columns
      let lineStart = 1;
      let columnStart = 0;
      let lineEnd = 1;
      let columnEnd = 0;

      for (let i = 0; i < code.length; i++) {
        if (i === start) {
          lineStart = lineEnd;
          columnStart = columnEnd;
        }
        if (i === end) {
          break;
        }
        if (code[i] === '\n') {
          lineEnd++;
          columnEnd = 0;
        } else {
          columnEnd++;
        }
      }

      return { lineStart, lineEnd, columnStart, columnEnd };
    };

    // Extract leading comments (JSDoc)
    const getDocumentation = (node: t.Node): string | undefined => {
      if (!node.leadingComments || node.leadingComments.length === 0) {
        return undefined;
      }

      const lastComment = node.leadingComments[node.leadingComments.length - 1];
      if (!lastComment) {
        return undefined;
      }

      if (lastComment.type === 'CommentBlock' && lastComment.value.startsWith('*')) {
        return lastComment.value.trim();
      }

      return undefined;
    };

    // Check if node is exported
    const isExported = (path: NodePath): boolean => {
      const parent = path.parent;
      return (
        t.isExportNamedDeclaration(parent) ||
        t.isExportDefaultDeclaration(parent)
      );
    };

    // Check if node is default export
    const isDefaultExport = (path: NodePath): boolean => {
      const parent = path.parent;
      return t.isExportDefaultDeclaration(parent);
    };

    // Generate signature for functions/methods
    const generateSignature = (
      node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ClassMethod | t.ObjectMethod,
      name?: string
    ): string => {
      const parts: string[] = [];

      // Add async modifier
      if (node.async) {
        parts.push('async');
      }

      // Add generator modifier
      if (node.generator) {
        parts.push('function*');
      } else if (!t.isArrowFunctionExpression(node) && !node.async) {
        parts.push('function');
      }

      // Add name
      if (name) {
        parts.push(name);
      }

      // Add parameters
      const params = node.params.map(param => {
        if (t.isIdentifier(param)) {
          // typeAnnotation already includes the colon
          if (param.typeAnnotation && param.typeAnnotation.start !== null && param.typeAnnotation.end !== null) {
            const typeAnnotationText = code.slice(param.typeAnnotation.start, param.typeAnnotation.end);
            return param.name + typeAnnotationText;
          }
          return param.name;
        }
        if (param.start !== null && param.end !== null) {
          return code.slice(param.start, param.end);
        }
        return '_';
      }).join(', ');

      parts.push(`(${params})`);

      // Add return type
      if (node.returnType && node.returnType.start !== null && node.returnType.end !== null) {
        parts.push(code.slice(node.returnType.start, node.returnType.end));
      }

      return parts.join(' ');
    };

    // Track parent classes for methods
    let currentClass: string | null = null;

    // Traverse AST
    traverse(ast, {
      // Function declarations
      FunctionDeclaration(path) {
        const node = path.node;
        if (!node.id || node.start === null || node.end === null) return;

        const loc = getLocation(node.start, node.end);
        const modifiers: string[] = [];

        if (node.async) modifiers.push('async');
        if (node.generator) modifiers.push('generator');

        symbols.push({
          id: `${relativePath}:${node.id.name}:function`,
          name: node.id.name,
          kind: 'function',
          filePath,
          relativePath,
          ...loc,
          isExported: isExported(path),
          isDefaultExport: isDefaultExport(path),
          signature: generateSignature(node, node.id.name),
          documentation: getDocumentation(node),
          modifiers,
        });
      },

      // Variable declarations (for arrow functions and function expressions)
      VariableDeclaration(path) {
        const node = path.node;

        for (const decl of node.declarations) {
          if (!t.isIdentifier(decl.id)) continue;
          if (!decl.init) continue;

          // Check if it's an arrow function or function expression
          if (t.isArrowFunctionExpression(decl.init) || t.isFunctionExpression(decl.init)) {
            if (node.start === null || node.end === null) continue;

            const loc = getLocation(node.start, node.end);
            const modifiers: string[] = [];

            if (decl.init.async) modifiers.push('async');
            if (decl.init.generator) modifiers.push('generator');

            // Check if it's const (constant)
            if (node.kind === 'const') {
              modifiers.push('const');
            }

            symbols.push({
              id: `${relativePath}:${decl.id.name}:arrow_function`,
              name: decl.id.name,
              kind: 'arrow_function',
              filePath,
              relativePath,
              ...loc,
              isExported: isExported(path),
              isDefaultExport: isDefaultExport(path),
              signature: generateSignature(decl.init, decl.id.name),
              documentation: getDocumentation(node),
              modifiers,
            });
          }
        }
      },

      // Class declarations
      ClassDeclaration(path) {
        const node = path.node;
        if (!node.id || node.start === null || node.end === null) return;

        const loc = getLocation(node.start, node.end);
        const className = node.id.name;
        currentClass = className;

        symbols.push({
          id: `${relativePath}:${className}:class`,
          name: className,
          kind: 'class',
          filePath,
          relativePath,
          ...loc,
          isExported: isExported(path),
          isDefaultExport: isDefaultExport(path),
          documentation: getDocumentation(node),
          modifiers: [],
        });

        // Extract class body
        for (const member of node.body.body) {
          if (member.start === null || member.end === null) continue;
          const memberLoc = getLocation(member.start, member.end);

          // Class methods
          if (t.isClassMethod(member) && t.isIdentifier(member.key)) {
            const modifiers: string[] = [];
            if (member.static) modifiers.push('static');
            if (member.async) modifiers.push('async');
            if (member.kind === 'get') modifiers.push('get');
            if (member.kind === 'set') modifiers.push('set');

            symbols.push({
              id: `${relativePath}:${className}.${member.key.name}:method`,
              name: member.key.name,
              kind: 'method',
              filePath,
              relativePath,
              ...memberLoc,
              isExported: false,
              isDefaultExport: false,
              signature: generateSignature(member, member.key.name),
              documentation: getDocumentation(member),
              parentId: `${relativePath}:${className}:class`,
              modifiers,
            });
          }

          // Class properties
          if (t.isClassProperty(member) && t.isIdentifier(member.key)) {
            const modifiers: string[] = [];
            if (member.static) modifiers.push('static');
            if (member.readonly) modifiers.push('readonly');

            symbols.push({
              id: `${relativePath}:${className}.${member.key.name}:property`,
              name: member.key.name,
              kind: 'property',
              filePath,
              relativePath,
              ...memberLoc,
              isExported: false,
              isDefaultExport: false,
              documentation: getDocumentation(member),
              parentId: `${relativePath}:${className}:class`,
              modifiers,
            });
          }
        }
      },

      // TypeScript interfaces
      TSInterfaceDeclaration(path) {
        const node = path.node;
        if (node.start === null || node.end === null) return;

        const loc = getLocation(node.start, node.end);

        symbols.push({
          id: `${relativePath}:${node.id.name}:interface`,
          name: node.id.name,
          kind: 'interface',
          filePath,
          relativePath,
          ...loc,
          isExported: isExported(path),
          isDefaultExport: false,
          documentation: getDocumentation(node),
          modifiers: [],
        });
      },

      // TypeScript type aliases
      TSTypeAliasDeclaration(path) {
        const node = path.node;
        if (node.start === null || node.end === null) return;

        const loc = getLocation(node.start, node.end);

        symbols.push({
          id: `${relativePath}:${node.id.name}:type_alias`,
          name: node.id.name,
          kind: 'type_alias',
          filePath,
          relativePath,
          ...loc,
          isExported: isExported(path),
          isDefaultExport: false,
          documentation: getDocumentation(node),
          modifiers: [],
        });
      },

      // TypeScript enums
      TSEnumDeclaration(path) {
        const node = path.node;
        if (node.start === null || node.end === null) return;

        const loc = getLocation(node.start, node.end);
        const enumName = node.id.name;

        symbols.push({
          id: `${relativePath}:${enumName}:enum`,
          name: enumName,
          kind: 'enum',
          filePath,
          relativePath,
          ...loc,
          isExported: isExported(path),
          isDefaultExport: false,
          documentation: getDocumentation(node),
          modifiers: [],
        });

        // Extract enum members
        for (const member of node.members) {
          if (!t.isIdentifier(member.id)) continue;
          if (member.start === null || member.end === null) continue;

          const memberLoc = getLocation(member.start, member.end);

          symbols.push({
            id: `${relativePath}:${enumName}.${member.id.name}:enum_member`,
            name: member.id.name,
            kind: 'enum_member',
            filePath,
            relativePath,
            ...memberLoc,
            isExported: false,
            isDefaultExport: false,
            parentId: `${relativePath}:${enumName}:enum`,
            modifiers: [],
          });
        }
      },
    });

    return symbols;
  } catch (error) {
    // Gracefully handle parse errors
    return [];
  }
}

/**
 * Extract code symbols from source code (dispatcher - kept for backwards compatibility)
 * @deprecated Use specific extractors directly based on parser type
 */
export async function extractSymbols(
  code: string,
  filePath: string,
  relativePath: string,
  extension: string
): Promise<CodeSymbol[]> {
  // Dispatch to Solidity extraction for .sol files
  if (extension === '.sol') {
    return extractSoliditySymbols(code, filePath, relativePath);
  }

  // Dispatch to tree-sitter for supported languages
  if (isSupportedByTreeSitter(extension)) {
    return extractSymbolsTreeSitter(code, filePath, relativePath, extension);
  }

  // Default to Babel for JS/TS
  return extractSymbolsBabel(code, filePath, relativePath, extension);
}

/**
 * Extract symbols from Solidity source code
 */
export function extractSoliditySymbols(
  code: string,
  filePath: string,
  relativePath: string
): CodeSymbol[] {
  try {
    // Parse Solidity code with error tolerance
    const ast = parseSolidity(code, { loc: true, range: true, tolerant: true });

    const symbols: CodeSymbol[] = [];
    let currentContract: string | null = null;

    // Helper to calculate line/column from location
    const getLocation = (loc: { start: { line: number; column: number }; end: { line: number; column: number } } | undefined) => {
      if (!loc) {
        return { lineStart: 1, lineEnd: 1, columnStart: 0, columnEnd: 0 };
      }
      return {
        lineStart: loc.start.line,
        lineEnd: loc.end.line,
        columnStart: loc.start.column,
        columnEnd: loc.end.column,
      };
    };

    // Helper to extract documentation comments
    const getDocumentation = (node: unknown): string | undefined => {
      // Solidity uses NatSpec comments (///, /** */)
      // The parser doesn't preserve comments in the same way as Babel
      // We'll need to search backwards in the code for comments
      // For now, return undefined - can be enhanced later
      return undefined;
    };

    // Visit AST nodes
    // @ts-ignore - Solidity parser types are not well-defined
    visit(ast, {
      // @ts-ignore - Contract definition visitor
      ContractDefinition: (node: {
        name: string;
        kind: string;
        loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
      }) => {
        const loc = getLocation(node.loc);
        const modifiers: string[] = [];

        // Track contract kind (can be 'contract', 'library', 'interface', or 'abstract')
        if (node.kind === 'library') {
          modifiers.push('library');
        } else if (node.kind === 'interface') {
          modifiers.push('interface');
        } else if (node.kind === 'abstract') {
          modifiers.push('abstract');
        }

        currentContract = node.name;

        const kind: SymbolKind = node.kind === 'interface' ? 'interface' : 'class';

        symbols.push({
          id: `${relativePath}:${node.name}:${kind}`,
          name: node.name,
          kind,
          filePath,
          relativePath,
          ...loc,
          isExported: false, // Solidity doesn't have exports in the same way
          isDefaultExport: false,
          documentation: getDocumentation(node),
          modifiers,
        });
      },

      // @ts-ignore - Function definition visitor
      FunctionDefinition: (node: {
        name: string | null;
        visibility?: string;
        stateMutability?: string | null;
        isConstructor?: boolean;
        isReceiveEther?: boolean;
        isFallback?: boolean;
        isVirtual?: boolean;
        modifiers?: unknown[];
        parameters?: { parameters?: unknown[] };
        returnParameters?: { parameters?: unknown[] };
        loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
      }) => {
        const loc = getLocation(node.loc);
        const modifiers: string[] = [];

        // Determine function name
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

        // Add visibility modifiers
        if (node.visibility) {
          modifiers.push(node.visibility);
        }

        // Add state mutability modifiers
        if (node.stateMutability) {
          modifiers.push(node.stateMutability);
        }

        // Add virtual modifier
        if (node.isVirtual) {
          modifiers.push('virtual');
        }

        // Generate signature
        const params = node.parameters?.parameters || [];
        const returns = node.returnParameters?.parameters || [];
        const signature = `function ${functionName}(${params.length} params)${returns.length > 0 ? ' returns' : ''}`;

        symbols.push({
          id: `${relativePath}:${currentContract ? currentContract + '.' : ''}${functionName}:function`,
          name: functionName,
          kind: 'function',
          filePath,
          relativePath,
          ...loc,
          isExported: false,
          isDefaultExport: false,
          signature,
          documentation: getDocumentation(node),
          parentId: currentContract ? `${relativePath}:${currentContract}:class` : undefined,
          modifiers,
        });
      },

      // Modifier definitions
      // @ts-ignore - Modifier definition visitor
      ModifierDefinition: (node: {
        name: string;
        parameters?: { parameters?: unknown[] };
        loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
      }) => {
        const loc = getLocation(node.loc);
        const modifiers: string[] = ['modifier'];

        const params = node.parameters?.parameters || [];
        const signature = `modifier ${node.name}(${params.length} params)`;

        symbols.push({
          id: `${relativePath}:${currentContract ? currentContract + '.' : ''}${node.name}:function`,
          name: node.name,
          kind: 'function',
          filePath,
          relativePath,
          ...loc,
          isExported: false,
          isDefaultExport: false,
          signature,
          documentation: getDocumentation(node),
          parentId: currentContract ? `${relativePath}:${currentContract}:class` : undefined,
          modifiers,
        });
      },

      // Event definitions
      // @ts-ignore - Event definition visitor
      EventDefinition: (node: {
        name: string;
        parameters?: { parameters?: unknown[] };
        isAnonymous?: boolean;
        loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
      }) => {
        const loc = getLocation(node.loc);
        const modifiers: string[] = [];

        if (node.isAnonymous) {
          modifiers.push('anonymous');
        }

        symbols.push({
          id: `${relativePath}:${currentContract ? currentContract + '.' : ''}${node.name}:event`,
          name: node.name,
          kind: 'event',
          filePath,
          relativePath,
          ...loc,
          isExported: false,
          isDefaultExport: false,
          documentation: getDocumentation(node),
          parentId: currentContract ? `${relativePath}:${currentContract}:class` : undefined,
          modifiers,
        });
      },

      // @ts-ignore - State variable declaration visitor
      // State variable declarations
      StateVariableDeclaration: (node: {
        variables?: Array<{
          name: string;
          visibility?: string;
          isDeclaredConst?: boolean;
          isImmutable?: boolean;
          loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
        }>;
      }) => {
        const variables = node.variables || [];

        for (const variable of variables) {
          const loc = getLocation(variable.loc);
          const modifiers: string[] = [];

          if (variable.visibility) {
            modifiers.push(variable.visibility);
          }

          if (variable.isDeclaredConst) {
            modifiers.push('constant');
          }

          if (variable.isImmutable) {
            modifiers.push('immutable');
          }

          symbols.push({
            id: `${relativePath}:${currentContract ? currentContract + '.' : ''}${variable.name}:variable`,
            name: variable.name,
            kind: 'variable',
            filePath,
            relativePath,
            ...loc,
            isExported: false,
            isDefaultExport: false,
            documentation: getDocumentation(variable),
            parentId: currentContract ? `${relativePath}:${currentContract}:class` : undefined,
            modifiers,
          });
        }
      },

      // Struct definitions
      // @ts-ignore - Struct definition visitor
      StructDefinition: (node: {
        name: string;
        loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
      }) => {
        const loc = getLocation(node.loc);

        symbols.push({
          id: `${relativePath}:${currentContract ? currentContract + '.' : ''}${node.name}:interface`,
          name: node.name,
          kind: 'interface',
          filePath,
          relativePath,
          ...loc,
          isExported: false,
          isDefaultExport: false,
          documentation: getDocumentation(node),
          parentId: currentContract ? `${relativePath}:${currentContract}:class` : undefined,
          modifiers: [],
        });
      },

      // Enum definitions
      // @ts-ignore - Enum definition visitor
      EnumDefinition: (node: {
        name: string;
        members?: Array<{ name: string }>;
        loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
      }) => {
        const loc = getLocation(node.loc);
        const enumName = node.name;

        symbols.push({
          id: `${relativePath}:${currentContract ? currentContract + '.' : ''}${enumName}:enum`,
          name: enumName,
          kind: 'enum',
          filePath,
          relativePath,
          ...loc,
          isExported: false,
          isDefaultExport: false,
          documentation: getDocumentation(node),
          parentId: currentContract ? `${relativePath}:${currentContract}:class` : undefined,
          modifiers: [],
        });

        // Extract enum members
        const members = node.members || [];
        for (const member of members) {
          symbols.push({
            id: `${relativePath}:${currentContract ? currentContract + '.' : ''}${enumName}.${member.name}:enum_member`,
            name: member.name,
            kind: 'enum_member',
            filePath,
            relativePath,
            lineStart: loc.lineStart,
            lineEnd: loc.lineEnd,
            columnStart: loc.columnStart,
            columnEnd: loc.columnEnd,
            isExported: false,
            isDefaultExport: false,
            parentId: `${relativePath}:${currentContract ? currentContract + '.' : ''}${enumName}:enum`,
            modifiers: [],
          });
        }
      },

      // Custom error definitions
      // @ts-ignore - Custom error definition visitor
      CustomErrorDefinition: (node: {
        name: string;
        parameters?: { parameters?: unknown[] };
        loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
      }) => {
        const loc = getLocation(node.loc);

        symbols.push({
          id: `${relativePath}:${currentContract ? currentContract + '.' : ''}${node.name}:type_alias`,
          name: node.name,
          kind: 'type_alias',
          filePath,
          relativePath,
          ...loc,
          isExported: false,
          isDefaultExport: false,
          documentation: getDocumentation(node),
          parentId: currentContract ? `${relativePath}:${currentContract}:class` : undefined,
          modifiers: [],
        });
      },
    });

    return symbols;
  } catch (error) {
    // Gracefully handle parse errors
    return [];
  }
}
