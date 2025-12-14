import type { CodeSymbol, CodeDependency, CallEdge, SymbolKind, DependencyKind, ImportedName } from '../types/code-intel.js';
import type { IndexDatabase } from './lance.js';

/**
 * Add symbols to the code intelligence storage.
 */
export async function addSymbols(
  db: IndexDatabase,
  indexName: string,
  symbols: CodeSymbol[]
): Promise<void> {
  if (symbols.length === 0) return;

  const tableName = `${indexName}_symbols`;
  const records = symbols.map((symbol) => ({
    id: symbol.id,
    name: symbol.name,
    kind: symbol.kind,
    file_path: symbol.filePath,
    relative_path: symbol.relativePath,
    line_start: symbol.range.start.line,
    line_end: symbol.range.end.line,
    column_start: symbol.range.start.column,
    column_end: symbol.range.end.column,
    is_exported: symbol.isExported ? 1 : 0,
    is_default_export: symbol.isDefaultExport ? 1 : 0,
    documentation: symbol.documentation ?? '',
    signature: symbol.signature ?? '',
    parent_id: symbol.parentId ?? '',
    modifiers: JSON.stringify(symbol.modifiers),
    index_name: indexName,
    created_at: new Date().toISOString(),
  }));

  try {
    const table = await db.connection.openTable(tableName);
    await table.add(records);
  } catch {
    await db.connection.createTable(tableName, records);
  }
}

/**
 * Get symbols from the code intelligence storage.
 */
export async function getSymbols(
  db: IndexDatabase,
  indexName: string,
  options?: { kind?: SymbolKind; file?: string }
): Promise<CodeSymbol[]> {
  const tableName = `${indexName}_symbols`;

  try {
    const table = await db.connection.openTable(tableName);
    let query = table.query();

    if (options?.kind) {
      query = query.where(`kind = '${options.kind}'`);
    }
    if (options?.file) {
      query = query.where(`file_path = '${options.file}'`);
    }

    const results = await query.toArray();

    return results.map((record: Record<string, unknown>) => ({
      id: record['id'] as string,
      name: record['name'] as string,
      kind: record['kind'] as SymbolKind,
      filePath: record['file_path'] as string,
      relativePath: record['relative_path'] as string,
      range: {
        start: {
          line: record['line_start'] as number,
          column: record['column_start'] as number,
        },
        end: {
          line: record['line_end'] as number,
          column: record['column_end'] as number,
        },
      },
      isExported: (record['is_exported'] as number) === 1,
      isDefaultExport: (record['is_default_export'] as number) === 1,
      documentation: record['documentation'] as string || undefined,
      signature: record['signature'] as string || undefined,
      parentId: record['parent_id'] as string || undefined,
      modifiers: JSON.parse(record['modifiers'] as string) as string[],
    }));
  } catch {
    return [];
  }
}

/**
 * Search for symbols by name.
 */
export async function searchSymbols(
  db: IndexDatabase,
  indexName: string,
  query: string
): Promise<CodeSymbol[]> {
  const tableName = `${indexName}_symbols`;

  try {
    const table = await db.connection.openTable(tableName);
    const allSymbols = await table.query().toArray();

    const queryLower = query.toLowerCase();
    const matching = allSymbols.filter((record: Record<string, unknown>) => {
      const name = record['name'] as string;
      return name.toLowerCase().includes(queryLower);
    });

    return matching.map((record: Record<string, unknown>) => ({
      id: record['id'] as string,
      name: record['name'] as string,
      kind: record['kind'] as SymbolKind,
      filePath: record['file_path'] as string,
      relativePath: record['relative_path'] as string,
      range: {
        start: {
          line: record['line_start'] as number,
          column: record['column_start'] as number,
        },
        end: {
          line: record['line_end'] as number,
          column: record['column_end'] as number,
        },
      },
      isExported: (record['is_exported'] as number) === 1,
      isDefaultExport: (record['is_default_export'] as number) === 1,
      documentation: record['documentation'] as string || undefined,
      signature: record['signature'] as string || undefined,
      parentId: record['parent_id'] as string || undefined,
      modifiers: JSON.parse(record['modifiers'] as string) as string[],
    }));
  } catch {
    return [];
  }
}

/**
 * Delete symbols by file path.
 */
export async function deleteSymbolsByFile(
  db: IndexDatabase,
  indexName: string,
  filePath: string
): Promise<void> {
  const tableName = `${indexName}_symbols`;

  try {
    const table = await db.connection.openTable(tableName);
    await table.delete(`file_path = '${filePath}'`);
  } catch {
    // Table doesn't exist, nothing to delete
  }
}

/**
 * Add dependencies to the code intelligence storage.
 */
export async function addDependencies(
  db: IndexDatabase,
  indexName: string,
  deps: CodeDependency[]
): Promise<void> {
  if (deps.length === 0) return;

  const tableName = `${indexName}_dependencies`;
  const records = deps.map((dep) => ({
    id: dep.id,
    source_file: dep.sourceFile,
    target_module: dep.targetModule,
    resolved_path: dep.resolvedPath ?? '',
    kind: dep.kind,
    names: JSON.stringify(dep.names),
    line: dep.line,
    is_external: dep.isExternal ? 1 : 0,
    index_name: indexName,
    created_at: new Date().toISOString(),
  }));

  try {
    const table = await db.connection.openTable(tableName);
    await table.add(records);
  } catch {
    await db.connection.createTable(tableName, records);
  }
}

/**
 * Get dependencies from the code intelligence storage.
 */
export async function getDependencies(
  db: IndexDatabase,
  indexName: string,
  options?: { file?: string; external?: boolean }
): Promise<CodeDependency[]> {
  const tableName = `${indexName}_dependencies`;

  try {
    const table = await db.connection.openTable(tableName);
    let query = table.query();

    if (options?.file) {
      query = query.where(`source_file = '${options.file}'`);
    }
    if (options?.external !== undefined) {
      const externalVal = options.external ? 1 : 0;
      query = query.where(`is_external = ${externalVal}`);
    }

    const results = await query.toArray();

    return results.map((record: Record<string, unknown>) => ({
      id: record['id'] as string,
      sourceFile: record['source_file'] as string,
      targetModule: record['target_module'] as string,
      resolvedPath: record['resolved_path'] as string || undefined,
      kind: record['kind'] as DependencyKind,
      names: JSON.parse(record['names'] as string) as ImportedName[],
      line: record['line'] as number,
      isExternal: (record['is_external'] as number) === 1,
    }));
  } catch {
    return [];
  }
}

/**
 * Get dependency graph.
 */
export async function getDependencyGraph(
  db: IndexDatabase,
  indexName: string
): Promise<{ imports: Map<string, string[]>; importedBy: Map<string, string[]> }> {
  const deps = await getDependencies(db, indexName);

  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();

  for (const dep of deps) {
    const source = dep.sourceFile;
    const target = dep.targetModule;

    if (!imports.has(source)) {
      imports.set(source, []);
    }
    imports.get(source)!.push(target);

    if (!importedBy.has(target)) {
      importedBy.set(target, []);
    }
    importedBy.get(target)!.push(source);
  }

  return { imports, importedBy };
}

/**
 * Delete dependencies by file path.
 */
export async function deleteDependenciesByFile(
  db: IndexDatabase,
  indexName: string,
  filePath: string
): Promise<void> {
  const tableName = `${indexName}_dependencies`;

  try {
    const table = await db.connection.openTable(tableName);
    await table.delete(`source_file = '${filePath}'`);
  } catch {
    // Table doesn't exist, nothing to delete
  }
}

/**
 * Add calls to the code intelligence storage.
 */
export async function addCalls(
  db: IndexDatabase,
  indexName: string,
  calls: CallEdge[]
): Promise<void> {
  if (calls.length === 0) return;

  const tableName = `${indexName}_calls`;
  const records = calls.map((call) => ({
    id: call.id,
    caller_id: call.callerId ?? '',
    caller_file: call.callerFile,
    callee_name: call.calleeName,
    callee_id: call.calleeId ?? '',
    callee_file: call.calleeFile ?? '',
    line: call.position.line,
    column: call.position.column,
    is_method_call: call.isMethodCall ? 1 : 0,
    receiver: call.receiver ?? '',
    argument_count: call.argumentCount,
    index_name: indexName,
    created_at: new Date().toISOString(),
  }));

  try {
    const table = await db.connection.openTable(tableName);
    await table.add(records);
  } catch {
    await db.connection.createTable(tableName, records);
  }
}

/**
 * Get calls from the code intelligence storage.
 */
export async function getCalls(
  db: IndexDatabase,
  indexName: string,
  options?: { caller?: string; callee?: string }
): Promise<CallEdge[]> {
  const tableName = `${indexName}_calls`;

  try {
    const table = await db.connection.openTable(tableName);
    let query = table.query();

    if (options?.caller) {
      query = query.where(`caller_id = '${options.caller}'`);
    }
    if (options?.callee) {
      query = query.where(`callee_id = '${options.callee}'`);
    }

    const results = await query.toArray();

    return results.map((record: Record<string, unknown>) => ({
      id: record['id'] as string,
      callerId: record['caller_id'] as string || undefined,
      callerFile: record['caller_file'] as string,
      calleeName: record['callee_name'] as string,
      calleeId: record['callee_id'] as string || undefined,
      calleeFile: record['callee_file'] as string || undefined,
      position: {
        line: record['line'] as number,
        column: record['column'] as number,
      },
      isMethodCall: (record['is_method_call'] as number) === 1,
      receiver: record['receiver'] as string || undefined,
      argumentCount: record['argument_count'] as number,
    }));
  } catch {
    return [];
  }
}

/**
 * Get call graph.
 */
export async function getCallGraph(
  db: IndexDatabase,
  indexName: string
): Promise<{ calls: Map<string, string[]>; calledBy: Map<string, string[]> }> {
  const allCalls = await getCalls(db, indexName);

  const calls = new Map<string, string[]>();
  const calledBy = new Map<string, string[]>();

  for (const call of allCalls) {
    if (call.callerId && call.calleeId) {
      if (!calls.has(call.callerId)) {
        calls.set(call.callerId, []);
      }
      calls.get(call.callerId)!.push(call.calleeId);

      if (!calledBy.has(call.calleeId)) {
        calledBy.set(call.calleeId, []);
      }
      calledBy.get(call.calleeId)!.push(call.callerId);
    }
  }

  return { calls, calledBy };
}

/**
 * Delete calls by file path.
 */
export async function deleteCallsByFile(
  db: IndexDatabase,
  indexName: string,
  filePath: string
): Promise<void> {
  const tableName = `${indexName}_calls`;

  try {
    const table = await db.connection.openTable(tableName);
    await table.delete(`caller_file = '${filePath}'`);
  } catch {
    // Table doesn't exist, nothing to delete
  }
}

/**
 * Clear all code intelligence data for an index.
 */
export async function clearCodeIntel(
  db: IndexDatabase,
  indexName: string
): Promise<void> {
  const tables = [`${indexName}_symbols`, `${indexName}_dependencies`, `${indexName}_calls`];

  for (const tableName of tables) {
    try {
      await db.connection.dropTable(tableName);
    } catch {
      // Table doesn't exist, ignore
    }
  }
}

/**
 * Get statistics about code intelligence data.
 */
export async function getCodeIntelStats(
  db: IndexDatabase,
  indexName: string
): Promise<{ symbols: number; dependencies: number; calls: number }> {
  const [symbols, dependencies, calls] = await Promise.all([
    getSymbols(db, indexName),
    getDependencies(db, indexName),
    getCalls(db, indexName),
  ]);

  return {
    symbols: symbols.length,
    dependencies: dependencies.length,
    calls: calls.length,
  };
}
