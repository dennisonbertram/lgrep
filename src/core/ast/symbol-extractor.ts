/**
 * Symbol extraction from JavaScript/TypeScript code using Babel AST
 */

import * as parser from '@babel/parser';
import traverseDefault, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { CodeSymbol, SymbolKind } from './types.js';

// Handle CommonJS default export
const traverse = (traverseDefault as unknown as { default: typeof traverseDefault }).default || traverseDefault;

/**
 * Extract code symbols from source code
 */
export function extractSymbols(
  code: string,
  filePath: string,
  relativePath: string,
  extension: string
): CodeSymbol[] {
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
