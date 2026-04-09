import type { CodeSymbol, CodeDependency, CallEdge, SymbolKind, DependencyKind, ImportedName } from '../types/code-intel.js';
import type { IndexDatabase } from './lance.js';
import {
  getPostgresIndexTableName,
  quoteIdentifier,
  requirePostgresPool,
  SHARED_SYMBOLS_TABLE,
  SHARED_DEPENDENCIES_TABLE,
  SHARED_CALLS_TABLE,
} from './postgres.js';

function isPostgresDatabase(db: IndexDatabase): boolean {
  return db.mode === 'postgres';
}

function getSymbolsTableName(db: IndexDatabase, indexName: string): string {
  return isPostgresDatabase(db)
    ? getPostgresIndexTableName(indexName, 'symbols')
    : `${indexName}_symbols`;
}

function getDependenciesTableName(db: IndexDatabase, indexName: string): string {
  return isPostgresDatabase(db)
    ? getPostgresIndexTableName(indexName, 'dependencies')
    : `${indexName}_dependencies`;
}

function getCallsTableName(db: IndexDatabase, indexName: string): string {
  return isPostgresDatabase(db)
    ? getPostgresIndexTableName(indexName, 'calls')
    : `${indexName}_calls`;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function mapSymbolRecord(record: Record<string, unknown>): CodeSymbol {
  return {
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
    isExported: asBoolean(record['is_exported']),
    isDefaultExport: asBoolean(record['is_default_export']),
    documentation: (record['documentation'] as string) || undefined,
    signature: (record['signature'] as string) || undefined,
    parentId: (record['parent_id'] as string) || undefined,
    modifiers: JSON.parse((record['modifiers'] as string) || '[]') as string[],
    summary: (record['summary'] as string) || undefined,
    summaryModel: (record['summary_model'] as string) || undefined,
    summaryGeneratedAt: (record['summary_generated_at'] as string) || undefined,
    bodyHash: (record['body_hash'] as string) || undefined,
  };
}

function mapDependencyRecord(record: Record<string, unknown>): CodeDependency {
  return {
    id: record['id'] as string,
    sourceFile: record['source_file'] as string,
    targetModule: record['target_module'] as string,
    resolvedPath: (record['resolved_path'] as string) || undefined,
    kind: record['kind'] as DependencyKind,
    names: JSON.parse((record['names'] as string) || '[]') as ImportedName[],
    line: record['line'] as number,
    isExternal: asBoolean(record['is_external']),
  };
}

function mapCallRecord(record: Record<string, unknown>): CallEdge {
  return {
    id: record['id'] as string,
    callerId: (record['caller_id'] as string) || undefined,
    callerFile: record['caller_file'] as string,
    calleeName: record['callee_name'] as string,
    calleeId: (record['callee_id'] as string) || undefined,
    calleeFile: (record['callee_file'] as string) || undefined,
    position: {
      line: record['line'] as number,
      column: record['column'] as number,
    },
    isMethodCall: asBoolean(record['is_method_call']),
    receiver: (record['receiver'] as string) || undefined,
    argumentCount: record['argument_count'] as number,
  };
}

/**
 * Add symbols to the code intelligence storage.
 */
export async function addSymbols(
  db: IndexDatabase,
  indexName: string,
  symbols: CodeSymbol[]
): Promise<void> {
  if (symbols.length === 0) return;

  const tableName = getSymbolsTableName(db, indexName);
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
    summary: symbol.summary ?? '',
    summary_model: symbol.summaryModel ?? '',
    summary_generated_at: symbol.summaryGeneratedAt ?? '',
    body_hash: symbol.bodyHash ?? '',
    index_name: indexName,
    created_at: new Date().toISOString(),
  }));

  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const values: string[] = [];
    const params: unknown[] = [];

    for (const record of records) {
      const base = params.length;
      params.push(
        record.id,
        record.name,
        record.kind,
        record.file_path,
        record.relative_path,
        record.line_start,
        record.line_end,
        record.column_start,
        record.column_end,
        record.is_exported,
        record.is_default_export,
        record.documentation,
        record.signature,
        record.parent_id,
        record.modifiers,
        record.summary,
        record.summary_model,
        record.summary_generated_at,
        record.body_hash,
        record.index_name,
        record.created_at
      );
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20}, $${base + 21})`
      );
    }

    await pool.query(
      `INSERT INTO ${quoteIdentifier(tableName)} (
        id,
        name,
        kind,
        file_path,
        relative_path,
        line_start,
        line_end,
        column_start,
        column_end,
        is_exported,
        is_default_export,
        documentation,
        signature,
        parent_id,
        modifiers,
        summary,
        summary_model,
        summary_generated_at,
        body_hash,
        index_name,
        created_at
      ) VALUES ${values.join(', ')}`,
      params
    );
    return;
  }

  try {
    const table = await db.connection!.openTable(tableName);
    await table.add(records);
  } catch {
    await db.connection!.createTable(tableName, records);
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
  const tableName = getSymbolsTableName(db, indexName);

  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options?.kind) {
      params.push(options.kind);
      clauses.push(`kind = $${params.length}`);
    }
    if (options?.file) {
      params.push(options.file);
      clauses.push(`file_path = $${params.length}`);
    }

    const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(tableName)}${whereClause}`,
      params
    );
    return result.rows.map(mapSymbolRecord);
  }

  try {
    const table = await db.connection!.openTable(tableName);
    let query = table.query();

    if (options?.kind) {
      query = query.where(`kind = '${options.kind}'`);
    }
    if (options?.file) {
      query = query.where(`file_path = '${options.file}'`);
    }

    const results = await query.toArray();

    return results.map((record: Record<string, unknown>) => mapSymbolRecord(record));
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
  const tableName = getSymbolsTableName(db, indexName);

  if (isPostgresDatabase(db)) {
    const result = await requirePostgresPool(db).query<Record<string, unknown>>(
      `SELECT *
         FROM ${quoteIdentifier(tableName)}
        WHERE LOWER(name) LIKE $1`,
      [`%${query.toLowerCase()}%`]
    );
    return result.rows.map(mapSymbolRecord);
  }

  try {
    const table = await db.connection!.openTable(tableName);
    const allSymbols = await table.query().toArray();

    const queryLower = query.toLowerCase();
    const matching = allSymbols.filter((record: Record<string, unknown>) => {
      const name = record['name'] as string;
      return name.toLowerCase().includes(queryLower);
    });

    return matching.map((record: Record<string, unknown>) => mapSymbolRecord(record));
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
  const tableName = getSymbolsTableName(db, indexName);

  if (isPostgresDatabase(db)) {
    await requirePostgresPool(db).query(
      `DELETE FROM ${quoteIdentifier(tableName)} WHERE file_path = $1`,
      [filePath]
    );
    return;
  }

  try {
    const table = await db.connection!.openTable(tableName);
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

  const tableName = getDependenciesTableName(db, indexName);
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

  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const values: string[] = [];
    const params: unknown[] = [];

    for (const record of records) {
      const base = params.length;
      params.push(
        record.id,
        record.source_file,
        record.target_module,
        record.resolved_path,
        record.kind,
        record.names,
        record.line,
        record.is_external,
        record.index_name,
        record.created_at
      );
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`
      );
    }

    await pool.query(
      `INSERT INTO ${quoteIdentifier(tableName)} (
        id,
        source_file,
        target_module,
        resolved_path,
        kind,
        names,
        line,
        is_external,
        index_name,
        created_at
      ) VALUES ${values.join(', ')}`,
      params
    );
    return;
  }

  try {
    const table = await db.connection!.openTable(tableName);
    await table.add(records);
  } catch {
    await db.connection!.createTable(tableName, records);
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
  const tableName = getDependenciesTableName(db, indexName);

  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options?.file) {
      params.push(options.file);
      clauses.push(`source_file = $${params.length}`);
    }
    if (options?.external !== undefined) {
      params.push(options.external ? 1 : 0);
      clauses.push(`is_external = $${params.length}`);
    }

    const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(tableName)}${whereClause}`,
      params
    );
    return result.rows.map(mapDependencyRecord);
  }

  try {
    const table = await db.connection!.openTable(tableName);
    let query = table.query();

    if (options?.file) {
      query = query.where(`source_file = '${options.file}'`);
    }
    if (options?.external !== undefined) {
      const externalVal = options.external ? 1 : 0;
      query = query.where(`is_external = ${externalVal}`);
    }

    const results = await query.toArray();

    return results.map((record: Record<string, unknown>) => mapDependencyRecord(record));
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
  const tableName = getDependenciesTableName(db, indexName);

  if (isPostgresDatabase(db)) {
    await requirePostgresPool(db).query(
      `DELETE FROM ${quoteIdentifier(tableName)} WHERE source_file = $1`,
      [filePath]
    );
    return;
  }

  try {
    const table = await db.connection!.openTable(tableName);
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

  const tableName = getCallsTableName(db, indexName);
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

  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const values: string[] = [];
    const params: unknown[] = [];

    for (const record of records) {
      const base = params.length;
      params.push(
        record.id,
        record.caller_id,
        record.caller_file,
        record.callee_name,
        record.callee_id,
        record.callee_file,
        record.line,
        record.column,
        record.is_method_call,
        record.receiver,
        record.argument_count,
        record.index_name,
        record.created_at
      );
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`
      );
    }

    await pool.query(
      `INSERT INTO ${quoteIdentifier(tableName)} (
        id,
        caller_id,
        caller_file,
        callee_name,
        callee_id,
        callee_file,
        line,
        "column",
        is_method_call,
        receiver,
        argument_count,
        index_name,
        created_at
      ) VALUES ${values.join(', ')}`,
      params
    );
    return;
  }

  try {
    const table = await db.connection!.openTable(tableName);
    await table.add(records);
  } catch {
    await db.connection!.createTable(tableName, records);
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
  const tableName = getCallsTableName(db, indexName);

  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options?.caller) {
      params.push(options.caller);
      clauses.push(`caller_id = $${params.length}`);
    }
    if (options?.callee) {
      params.push(options.callee);
      clauses.push(`callee_id = $${params.length}`);
    }

    const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(tableName)}${whereClause}`,
      params
    );
    return result.rows.map(mapCallRecord);
  }

  try {
    const table = await db.connection!.openTable(tableName);
    let query = table.query();

    if (options?.caller) {
      query = query.where(`caller_id = '${options.caller}'`);
    }
    if (options?.callee) {
      query = query.where(`callee_id = '${options.callee}'`);
    }

    const results = await query.toArray();

    return results.map((record: Record<string, unknown>) => mapCallRecord(record));
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
  const tableName = getCallsTableName(db, indexName);

  if (isPostgresDatabase(db)) {
    await requirePostgresPool(db).query(
      `DELETE FROM ${quoteIdentifier(tableName)} WHERE caller_file = $1`,
      [filePath]
    );
    return;
  }

  try {
    const table = await db.connection!.openTable(tableName);
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
  const tables = [
    getSymbolsTableName(db, indexName),
    getDependenciesTableName(db, indexName),
    getCallsTableName(db, indexName),
  ];

  for (const tableName of tables) {
    try {
      if (isPostgresDatabase(db)) {
        await requirePostgresPool(db).query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
      } else {
        await db.connection!.dropTable(tableName);
      }
    } catch {
      // Table doesn't exist, ignore
    }
  }
}

/**
 * Create the code intelligence tables for an index.
 * This should be called before parallel processing to avoid race conditions.
 */
export async function createCodeIntelTables(
  db: IndexDatabase,
  indexName: string
): Promise<void> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const symbolsTableName = quoteIdentifier(getSymbolsTableName(db, indexName));
    const depsTableName = quoteIdentifier(getDependenciesTableName(db, indexName));
    const callsTableName = quoteIdentifier(getCallsTableName(db, indexName));

    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${symbolsTableName} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        column_start INTEGER NOT NULL,
        column_end INTEGER NOT NULL,
        is_exported INTEGER NOT NULL,
        is_default_export INTEGER NOT NULL,
        documentation TEXT NOT NULL,
        signature TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        modifiers TEXT NOT NULL,
        summary TEXT NOT NULL,
        summary_model TEXT NOT NULL,
        summary_generated_at TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        index_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${getSymbolsTableName(db, indexName)}_name_idx`)}
        ON ${symbolsTableName} (LOWER(name))`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${getSymbolsTableName(db, indexName)}_file_idx`)}
        ON ${symbolsTableName} (file_path)`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${depsTableName} (
        id TEXT PRIMARY KEY,
        source_file TEXT NOT NULL,
        target_module TEXT NOT NULL,
        resolved_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        names TEXT NOT NULL,
        line INTEGER NOT NULL,
        is_external INTEGER NOT NULL,
        index_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${getDependenciesTableName(db, indexName)}_source_idx`)}
        ON ${depsTableName} (source_file)`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${callsTableName} (
        id TEXT PRIMARY KEY,
        caller_id TEXT NOT NULL,
        caller_file TEXT NOT NULL,
        callee_name TEXT NOT NULL,
        callee_id TEXT NOT NULL,
        callee_file TEXT NOT NULL,
        line INTEGER NOT NULL,
        "column" INTEGER NOT NULL,
        is_method_call INTEGER NOT NULL,
        receiver TEXT NOT NULL,
        argument_count INTEGER NOT NULL,
        index_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${getCallsTableName(db, indexName)}_caller_idx`)}
        ON ${callsTableName} (caller_id)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${getCallsTableName(db, indexName)}_callee_idx`)}
        ON ${callsTableName} (callee_id)`
    );
    return;
  }

  const tableNames = await db.connection!.tableNames();

  // Create symbols table if it doesn't exist
  const symbolsTableName = `${indexName}_symbols`;
  if (!tableNames.includes(symbolsTableName)) {
    const placeholder = {
      id: '__placeholder__',
      name: '',
      kind: 'function',
      file_path: '',
      relative_path: '',
      line_start: 0,
      line_end: 0,
      column_start: 0,
      column_end: 0,
      is_exported: 0,
      is_default_export: 0,
      documentation: '',
      signature: '',
      parent_id: '',
      modifiers: '[]',
      summary: '',
      summary_model: '',
      summary_generated_at: '',
      body_hash: '',
      index_name: indexName,
      created_at: new Date().toISOString(),
    };
    await db.connection!.createTable(symbolsTableName, [placeholder]);
    const table = await db.connection!.openTable(symbolsTableName);
    await table.delete("id = '__placeholder__'");
  }

  // Create dependencies table if it doesn't exist
  const depsTableName = `${indexName}_dependencies`;
  if (!tableNames.includes(depsTableName)) {
    const placeholder = {
      id: '__placeholder__',
      source_file: '',
      target_module: '',
      resolved_path: '',
      kind: 'import',
      names: '[]',
      line: 0,
      is_external: 0,
      index_name: indexName,
      created_at: new Date().toISOString(),
    };
    await db.connection!.createTable(depsTableName, [placeholder]);
    const table = await db.connection!.openTable(depsTableName);
    await table.delete("id = '__placeholder__'");
  }

  // Create calls table if it doesn't exist
  const callsTableName = `${indexName}_calls`;
  if (!tableNames.includes(callsTableName)) {
    const placeholder = {
      id: '__placeholder__',
      caller_id: '',
      caller_file: '',
      callee_name: '',
      callee_id: '',
      callee_file: '',
      line: 0,
      column: 0,
      is_method_call: 0,
      receiver: '',
      argument_count: 0,
      index_name: indexName,
      created_at: new Date().toISOString(),
    };
    await db.connection!.createTable(callsTableName, [placeholder]);
    const table = await db.connection!.openTable(callsTableName);
    await table.delete("id = '__placeholder__'");
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

/**
 * Update the summary for a specific symbol.
 */
export async function updateSymbolSummary(
  db: IndexDatabase,
  indexName: string,
  symbolId: string,
  summary: string,
  model: string
): Promise<void> {
  const tableName = getSymbolsTableName(db, indexName);

  if (isPostgresDatabase(db)) {
    const result = await requirePostgresPool(db).query(
      `UPDATE ${quoteIdentifier(tableName)}
          SET summary = $1,
              summary_model = $2,
              summary_generated_at = $3
        WHERE id = $4`,
      [summary, model, new Date().toISOString(), symbolId]
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Symbol with id ${symbolId} not found`);
    }
    return;
  }

  try {
    const table = await db.connection!.openTable(tableName);

    // Get the current symbol
    const results = await table.query().where(`id = '${symbolId}'`).toArray();

    if (results.length === 0) {
      throw new Error(`Symbol with id ${symbolId} not found`);
    }

    // Delete the old record
    await table.delete(`id = '${symbolId}'`);

    // Add updated record with summary
    const record = results[0] as Record<string, unknown>;
    const updatedRecord = {
      ...record,
      summary,
      summary_model: model,
      summary_generated_at: new Date().toISOString(),
    };

    await table.add([updatedRecord]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw error;
    }
    throw new Error(`Failed to update symbol summary: ${error}`);
  }
}

/**
 * Get symbols that do not have summaries yet.
 */
export async function getSymbolsWithoutSummaries(
  db: IndexDatabase,
  indexName: string
): Promise<CodeSymbol[]> {
  const tableName = getSymbolsTableName(db, indexName);

  if (isPostgresDatabase(db)) {
    const result = await requirePostgresPool(db).query<Record<string, unknown>>(
      `SELECT *
         FROM ${quoteIdentifier(tableName)}
        WHERE summary = '' OR summary IS NULL`
    );
    return result.rows.map(mapSymbolRecord);
  }

  try {
    const table = await db.connection!.openTable(tableName);
    const results = await table.query().toArray();

    // Filter for symbols without summaries
    const unsummarized = results.filter((record: Record<string, unknown>) => {
      const summary = record['summary'] as string;
      return !summary || summary === '';
    });

    return unsummarized.map((record: Record<string, unknown>) => mapSymbolRecord(record));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Shared content-addressable code intelligence store (Postgres only)
// ---------------------------------------------------------------------------

/**
 * Ensure the shared code intelligence tables exist.
 */
export async function ensureSharedCodeIntelTables(
  db: IndexDatabase
): Promise<void> {
  if (!isPostgresDatabase(db)) return;

  const pool = requirePostgresPool(db);

  // Shared symbols table
  const symbolsTable = quoteIdentifier(SHARED_SYMBOLS_TABLE);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${symbolsTable} (
      id SERIAL,
      content_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      column_start INTEGER NOT NULL,
      column_end INTEGER NOT NULL,
      is_exported INTEGER NOT NULL,
      is_default_export INTEGER NOT NULL,
      documentation TEXT NOT NULL,
      signature TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      modifiers JSONB NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      summary_model TEXT NOT NULL DEFAULT '',
      body_hash TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (content_hash, name, kind, line_start)
    )`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${SHARED_SYMBOLS_TABLE}_hash_idx`)}
      ON ${symbolsTable} (content_hash)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${SHARED_SYMBOLS_TABLE}_name_idx`)}
      ON ${symbolsTable} (LOWER(name))`
  );

  // Shared dependencies table
  const depsTable = quoteIdentifier(SHARED_DEPENDENCIES_TABLE);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${depsTable} (
      id SERIAL,
      content_hash TEXT NOT NULL,
      target_module TEXT NOT NULL,
      resolved_path TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      names JSONB NOT NULL DEFAULT '[]',
      line INTEGER NOT NULL,
      is_external INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (content_hash, target_module, line)
    )`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${SHARED_DEPENDENCIES_TABLE}_hash_idx`)}
      ON ${depsTable} (content_hash)`
  );

  // Shared calls table
  const callsTable = quoteIdentifier(SHARED_CALLS_TABLE);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${callsTable} (
      id SERIAL,
      content_hash TEXT NOT NULL,
      caller_name TEXT NOT NULL DEFAULT '',
      callee_name TEXT NOT NULL,
      callee_file TEXT NOT NULL DEFAULT '',
      line INTEGER NOT NULL,
      "column" INTEGER NOT NULL,
      is_method_call INTEGER NOT NULL,
      receiver TEXT NOT NULL DEFAULT '',
      argument_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (content_hash, callee_name, line, "column")
    )`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${SHARED_CALLS_TABLE}_hash_idx`)}
      ON ${callsTable} (content_hash)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${SHARED_CALLS_TABLE}_callee_idx`)}
      ON ${callsTable} (callee_name)`
  );
}

/**
 * Add symbols to the shared content-addressable store.
 * Uses INSERT ... ON CONFLICT DO NOTHING for concurrent-safe writes.
 */
export async function addSharedSymbols(
  db: IndexDatabase,
  contentHash: string,
  symbols: CodeSymbol[]
): Promise<void> {
  if (symbols.length === 0) return;
  if (!isPostgresDatabase(db)) return;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(SHARED_SYMBOLS_TABLE);
  const values: string[] = [];
  const params: unknown[] = [];

  for (const symbol of symbols) {
    const base = params.length;
    params.push(
      contentHash,
      symbol.name,
      symbol.kind,
      symbol.range.start.line,
      symbol.range.end.line,
      symbol.range.start.column,
      symbol.range.end.column,
      symbol.isExported ? 1 : 0,
      symbol.isDefaultExport ? 1 : 0,
      symbol.documentation ?? '',
      symbol.signature ?? '',
      symbol.parentId ?? '',
      JSON.stringify(symbol.modifiers),
      symbol.summary ?? '',
      symbol.summaryModel ?? '',
      symbol.bodyHash ?? ''
    );
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}::jsonb, $${base + 14}, $${base + 15}, $${base + 16})`
    );
  }

  await pool.query(
    `INSERT INTO ${table} (
      content_hash, name, kind,
      line_start, line_end, column_start, column_end,
      is_exported, is_default_export,
      documentation, signature, parent_id,
      modifiers, summary, summary_model, body_hash
    ) VALUES ${values.join(', ')}
    ON CONFLICT (content_hash, name, kind, line_start) DO NOTHING`,
    params
  );
}

/**
 * Add dependencies to the shared content-addressable store.
 */
export async function addSharedDependencies(
  db: IndexDatabase,
  contentHash: string,
  deps: CodeDependency[]
): Promise<void> {
  if (deps.length === 0) return;
  if (!isPostgresDatabase(db)) return;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(SHARED_DEPENDENCIES_TABLE);
  const values: string[] = [];
  const params: unknown[] = [];

  for (const dep of deps) {
    const base = params.length;
    params.push(
      contentHash,
      dep.targetModule,
      dep.resolvedPath ?? '',
      dep.kind,
      JSON.stringify(dep.names),
      dep.line,
      dep.isExternal ? 1 : 0
    );
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7})`
    );
  }

  await pool.query(
    `INSERT INTO ${table} (
      content_hash, target_module, resolved_path,
      kind, names, line, is_external
    ) VALUES ${values.join(', ')}
    ON CONFLICT (content_hash, target_module, line) DO NOTHING`,
    params
  );
}

/**
 * Add calls to the shared content-addressable store.
 */
export async function addSharedCalls(
  db: IndexDatabase,
  contentHash: string,
  calls: CallEdge[]
): Promise<void> {
  if (calls.length === 0) return;
  if (!isPostgresDatabase(db)) return;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(SHARED_CALLS_TABLE);
  const values: string[] = [];
  const params: unknown[] = [];

  for (const call of calls) {
    const base = params.length;
    params.push(
      contentHash,
      call.callerFile ?? '',
      call.calleeName,
      call.calleeFile ?? '',
      call.position.line,
      call.position.column,
      call.isMethodCall ? 1 : 0,
      call.receiver ?? '',
      call.argumentCount
    );
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
    );
  }

  await pool.query(
    `INSERT INTO ${table} (
      content_hash, caller_name, callee_name, callee_file,
      line, "column", is_method_call, receiver, argument_count
    ) VALUES ${values.join(', ')}
    ON CONFLICT (content_hash, callee_name, line, "column") DO NOTHING`,
    params
  );
}

/**
 * Retrieve shared symbols by content hash.
 */
export async function getSharedSymbolsByHash(
  db: IndexDatabase,
  contentHashes: string[]
): Promise<CodeSymbol[]> {
  if (contentHashes.length === 0) return [];
  if (!isPostgresDatabase(db)) return [];

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(SHARED_SYMBOLS_TABLE);
  const params: unknown[] = [];

  const hashPlaceholders = contentHashes.map((hash) => {
    params.push(hash);
    return `$${params.length}`;
  });

  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${table}
      WHERE content_hash IN (${hashPlaceholders.join(', ')})`,
    params
  );

  return result.rows.map((row) => ({
    id: String(row['id']),
    name: row['name'] as string,
    kind: row['kind'] as SymbolKind,
    filePath: '', // Shared symbols don't store file paths
    relativePath: '',
    range: {
      start: {
        line: row['line_start'] as number,
        column: row['column_start'] as number,
      },
      end: {
        line: row['line_end'] as number,
        column: row['column_end'] as number,
      },
    },
    isExported: asBoolean(row['is_exported']),
    isDefaultExport: asBoolean(row['is_default_export']),
    documentation: (row['documentation'] as string) || undefined,
    signature: (row['signature'] as string) || undefined,
    parentId: (row['parent_id'] as string) || undefined,
    modifiers: Array.isArray(row['modifiers'])
      ? (row['modifiers'] as string[])
      : JSON.parse((row['modifiers'] as string) || '[]') as string[],
    summary: (row['summary'] as string) || undefined,
    summaryModel: (row['summary_model'] as string) || undefined,
    bodyHash: (row['body_hash'] as string) || undefined,
  }));
}
