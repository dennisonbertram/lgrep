import { parse } from '@babel/parser';
import traverseDefault from '@babel/traverse';
import * as t from '@babel/types';
import { parse as parseSolidity, visit } from '@solidity-parser/parser';
import { isSupportedByTreeSitter, extractDependenciesTreeSitter } from './tree-sitter/index.js';

// Handle CommonJS default export
const traverse = (traverseDefault as unknown as { default: typeof traverseDefault }).default || traverseDefault;

export interface ImportedName {
  name: string;
  alias: string | undefined;
  isType?: boolean;
}

export interface ExportedName {
  name: string;
  alias: string | undefined;
}

export interface BaseDependency {
  source: string;
  isExternal: boolean;
  line?: number;
  column?: number;
}

export interface ImportDependency extends BaseDependency {
  type: 'import';
  default?: string;
  namespace?: string;
  imported: ImportedName[];
  isTypeOnly: boolean;
}

export interface DynamicImportDependency extends BaseDependency {
  type: 'dynamic-import';
}

export interface RequireDependency extends BaseDependency {
  type: 'require';
}

export interface ExportDependency {
  type: 'export';
  source?: string;
  exported: ExportedName[];
  isExternal: boolean;
  line?: number;
  column?: number;
}

export interface ExportDefaultDependency {
  type: 'export-default';
  isExternal: boolean;
  line?: number;
  column?: number;
}

export interface ExportAllDependency extends BaseDependency {
  type: 'export-all';
  namespace?: string;
}

export type Dependency =
  | ImportDependency
  | DynamicImportDependency
  | RequireDependency
  | ExportDependency
  | ExportDefaultDependency
  | ExportAllDependency;

/**
 * Determines if a module path is external (node_modules) or local (relative path)
 */
function isExternalModule(source: string): boolean {
  // Relative paths start with . or ..
  if (source.startsWith('./') || source.startsWith('../')) {
    return false;
  }
  // Absolute paths (rare but possible)
  if (source.startsWith('/')) {
    return false;
  }
  // Everything else is external (bare specifiers, scoped packages)
  return true;
}

/**
 * Extract all import/export dependencies from source code
 */
export async function extractDependencies(code: string, filePath: string): Promise<Dependency[]> {
  if (!code.trim()) {
    return [];
  }

  // Dispatch to Solidity extraction for .sol files
  const extension = filePath.split('.').pop() || '';
  if (extension === 'sol') {
    return extractSolidityDependencies(code, filePath);
  }

  // Dispatch to tree-sitter for supported languages
  if (isSupportedByTreeSitter(`.${extension}`)) {
    return extractDependenciesTreeSitter(code, filePath, `.${extension}`);
  }

  const dependencies: Dependency[] = [];

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
    // Return empty array on parse errors
    return [];
  }

  traverse(ast, {
    // Import declarations: import { x } from 'y'
    ImportDeclaration(path) {
      const node = path.node;
      const source = node.source.value;

      const imported: ImportedName[] = [];
      let defaultImport: string | undefined;
      let namespaceImport: string | undefined;

      for (const specifier of node.specifiers) {
        if (t.isImportDefaultSpecifier(specifier)) {
          defaultImport = specifier.local.name;
        } else if (t.isImportNamespaceSpecifier(specifier)) {
          namespaceImport = specifier.local.name;
        } else if (t.isImportSpecifier(specifier)) {
          const importedName = t.isIdentifier(specifier.imported)
            ? specifier.imported.name
            : specifier.imported.value;
          const localName = specifier.local.name;
          const item: ImportedName = {
            name: importedName,
            alias: importedName !== localName ? localName : undefined,
          };
          if (specifier.importKind === 'type') {
            item.isType = true;
          }
          imported.push(item);
        }
      }

      dependencies.push({
        type: 'import',
        source,
        default: defaultImport,
        namespace: namespaceImport,
        imported,
        isTypeOnly: node.importKind === 'type',
        isExternal: isExternalModule(source),
        line: node.loc?.start.line,
        column: node.loc?.start.column,
      });
    },

    // Dynamic imports: import('./module')
    CallExpression(path) {
      const node = path.node;

      // Dynamic import
      if (t.isImport(node.callee) && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          dependencies.push({
            type: 'dynamic-import',
            source: arg.value,
            isExternal: isExternalModule(arg.value),
            line: node.loc?.start.line,
            column: node.loc?.start.column,
          });
        }
      }

      // require() calls
      if (
        t.isIdentifier(node.callee) &&
        node.callee.name === 'require' &&
        node.arguments.length > 0
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          dependencies.push({
            type: 'require',
            source: arg.value,
            isExternal: isExternalModule(arg.value),
            line: node.loc?.start.line,
            column: node.loc?.start.column,
          });
        }
      }
    },

    // Export named: export { x, y }; export { x } from 'y'
    ExportNamedDeclaration(path) {
      const node = path.node;
      const source = node.source?.value;

      // If this is export * as ns from 'module', it's handled by ExportAllDeclaration
      // Check if it's a namespace export
      if (
        node.specifiers.length === 1 &&
        t.isExportNamespaceSpecifier(node.specifiers[0]) &&
        source
      ) {
        const specifier = node.specifiers[0];
        dependencies.push({
          type: 'export-all',
          source,
          namespace: specifier.exported.name,
          isExternal: isExternalModule(source),
          line: node.loc?.start.line,
          column: node.loc?.start.column,
        });
        return;
      }

      const exported: ExportedName[] = [];

      for (const specifier of node.specifiers) {
        if (t.isExportSpecifier(specifier)) {
          const exportedName = t.isIdentifier(specifier.exported)
            ? specifier.exported.name
            : specifier.exported.value;
          const localName = specifier.local.name;
          exported.push({
            name: localName,
            alias: localName !== exportedName ? exportedName : undefined,
          });
        }
      }

      dependencies.push({
        type: 'export',
        source,
        exported,
        isExternal: source ? isExternalModule(source) : false,
        line: node.loc?.start.line,
        column: node.loc?.start.column,
      });
    },

    // Export default: export default X
    ExportDefaultDeclaration(path) {
      const node = path.node;

      dependencies.push({
        type: 'export-default',
        isExternal: false,
        line: node.loc?.start.line,
        column: node.loc?.start.column,
      });
    },

    // Export all: export * from 'y'; export * as ns from 'y'
    ExportAllDeclaration(path) {
      const node = path.node;
      const source = node.source.value;

      dependencies.push({
        type: 'export-all',
        source,
        namespace: undefined, // ExportAllDeclaration doesn't have 'exported' property
        isExternal: isExternalModule(source),
        line: node.loc?.start.line,
        column: node.loc?.start.column,
      });
    },
  });

  return dependencies;
}

/**
 * Extract dependencies from Solidity source code
 */
function extractSolidityDependencies(code: string, filePath: string): Dependency[] {
  try {
    const ast = parseSolidity(code, { loc: true, range: true, tolerant: true });

    const dependencies: Dependency[] = [];

    // Visit AST nodes
    // @ts-ignore - Solidity parser types are not well-defined
    visit(ast, {
      // @ts-ignore - Import directive visitor
      ImportDirective: (node: {
        path: string;
        symbolAliases?: Array<[string, string | null]> | null;
        unitAlias?: string | null;
        loc?: { start: { line: number; column: number } };
      }) => {
        const source = node.path;
        const imported: ImportedName[] = [];
        let namespaceImport: string | undefined;

        // Check for namespace import: import * as Utils from "./Utils.sol"
        if (node.unitAlias) {
          namespaceImport = node.unitAlias;
        }

        // Check for named imports: import { Token, IERC20 as ERC20 } from "./Token.sol"
        if (node.symbolAliases && node.symbolAliases.length > 0) {
          for (const [name, alias] of node.symbolAliases) {
            imported.push({
              name,
              alias: alias || undefined,
            });
          }
        }

        dependencies.push({
          type: 'import',
          source,
          default: undefined, // Solidity doesn't have default imports
          namespace: namespaceImport,
          imported,
          isTypeOnly: false, // Solidity doesn't distinguish type imports
          isExternal: isExternalModule(source),
          line: node.loc?.start.line,
          column: node.loc?.start.column,
        });
      },
    });

    return dependencies;
  } catch (error) {
    // Gracefully handle parse errors
    return [];
  }
}
