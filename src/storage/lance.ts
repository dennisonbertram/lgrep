import * as lancedb from '@lancedb/lancedb';
import { mkdir, rm, readdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { DatabaseSettings } from './database-config.js';
import {
  POSTGRES_INDEXES_TABLE,
  getPostgresIndexTableName,
  quoteIdentifier,
  requirePostgresPool,
  vectorToSql,
} from './postgres.js';

/**
 * Index metadata stored in LanceDB and shadowed to meta.json in local mode.
 */
export interface IndexMetadata {
  schemaVersion: number;
  name: string;
  rootPath: string;
  status: 'building' | 'ready' | 'failed';
  model: string;
  modelDimensions: number;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
  chunkCount: number;
  generationId: number;
}

/**
 * Options for creating a new index.
 */
export interface CreateIndexOptions {
  name: string;
  rootPath: string;
  model: string;
  modelDimensions: number;
}

/**
 * Handle to an open index with its metadata.
 */
export interface IndexHandle {
  name: string;
  metadata: IndexMetadata;
  table: lancedb.Table | null;
}

/**
 * A document chunk with embedding vector.
 */
export interface DocumentChunk {
  id: string;
  filePath: string;
  relativePath: string;
  contentHash: string;
  chunkIndex: number;
  content: string;
  vector: Float32Array;
  language?: string;
  lineStart?: number;
  lineEnd?: number;
  fileType: string;
  createdAt: string;
}

/**
 * Search options for vector queries.
 */
export interface SearchOptions {
  limit: number;
}

/**
 * Search result with score.
 */
export interface SearchResult extends DocumentChunk {
  _score: number;
}

/**
 * Database connection wrapper.
 */
export interface IndexDatabase {
  path: string;
  mode: 'local' | 's3' | 'postgres';
  connection: lancedb.Connection | null;
  pool: Pool | null;
  tableExistence: Map<string, boolean>;
  close(): Promise<void>;
}

const CURRENT_SCHEMA_VERSION = 1;
const INDEX_METADATA_TABLE = '__indexes';
const TABLE_NAME = 'chunks';
const FILE_METADATA_TABLE_SUFFIX = 'files';
const INDEX_TABLE_SUFFIXES = [
  TABLE_NAME,
  FILE_METADATA_TABLE_SUFFIX,
  'symbols',
  'dependencies',
  'calls',
] as const;

interface PostgresIndexMetadataRow {
  index_name: string;
  root_path: string;
  status: 'building' | 'ready' | 'failed';
  model: string;
  model_dimensions: number;
  created_at: string | Date;
  updated_at: string | Date;
  document_count: number;
  chunk_count: number;
  generation_id: number;
  schema_version: number;
}

interface IndexMetadataRecord {
  name: string;
  root_path: string;
  status: 'building' | 'ready' | 'failed';
  model: string;
  model_dimensions: number;
  created_at: string;
  updated_at: string;
  document_count: number;
  chunk_count: number;
  generation_id: number;
  schema_version: number;
  [key: string]: unknown;
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function metadataToRecord(metadata: IndexMetadata): IndexMetadataRecord {
  return {
    name: metadata.name,
    root_path: metadata.rootPath,
    status: metadata.status,
    model: metadata.model,
    model_dimensions: metadata.modelDimensions,
    created_at: metadata.createdAt,
    updated_at: metadata.updatedAt,
    document_count: metadata.documentCount,
    chunk_count: metadata.chunkCount,
    generation_id: metadata.generationId,
    schema_version: metadata.schemaVersion,
  };
}

function recordToMetadata(record: Record<string, unknown>): IndexMetadata {
  return {
    schemaVersion: record['schema_version'] as number,
    name: record['name'] as string,
    rootPath: record['root_path'] as string,
    status: record['status'] as IndexMetadata['status'],
    model: record['model'] as string,
    modelDimensions: record['model_dimensions'] as number,
    createdAt: record['created_at'] as string,
    updatedAt: record['updated_at'] as string,
    documentCount: record['document_count'] as number,
    chunkCount: record['chunk_count'] as number,
    generationId: record['generation_id'] as number,
  };
}

function rowToMetadata(row: PostgresIndexMetadataRow): IndexMetadata {
  return {
    schemaVersion: row.schema_version,
    name: row.index_name,
    rootPath: row.root_path,
    status: row.status,
    model: row.model,
    modelDimensions: row.model_dimensions,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    documentCount: row.document_count,
    chunkCount: row.chunk_count,
    generationId: row.generation_id,
  };
}

function isPostgresDatabase(db: IndexDatabase): boolean {
  return db.mode === 'postgres';
}

function normalizeTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseVectorValue(value: unknown): Float32Array {
  if (value instanceof Float32Array) {
    return value;
  }

  if (Array.isArray(value)) {
    return new Float32Array(value as number[]);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const literal = trimmed.startsWith('[') ? trimmed.slice(1, -1) : trimmed;
    if (!literal) {
      return new Float32Array();
    }
    return new Float32Array(
      literal.split(',').map((entry) => Number(entry.trim()))
    );
  }

  return new Float32Array();
}

function getLegacyIndexDir(db: IndexDatabase, name: string): string {
  return join(db.path, name);
}

function getPostgresChunkTableName(indexName: string): string {
  return getPostgresIndexTableName(indexName, 'chunks');
}

function getPostgresFileTableName(indexName: string): string {
  return getPostgresIndexTableName(indexName, 'files');
}

function getKnownIndexTableNames(indexName: string, mode: IndexDatabase['mode'] = 'local'): string[] {
  if (mode === 'postgres') {
    return [
      getPostgresChunkTableName(indexName),
      getPostgresFileTableName(indexName),
      getPostgresIndexTableName(indexName, 'symbols'),
      getPostgresIndexTableName(indexName, 'dependencies'),
      getPostgresIndexTableName(indexName, 'calls'),
    ];
  }

  return INDEX_TABLE_SUFFIXES.map((suffix) => `${indexName}_${suffix}`);
}

async function ensurePostgresBaseTables(pool: Pool): Promise<void> {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (error) {
    throw new Error(
      `Failed to enable the pgvector extension. Ensure the "vector" extension is available for this database and the current user can enable it. Original error: ${error}`
    );
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(POSTGRES_INDEXES_TABLE)} (
      index_name TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT NOT NULL,
      model_dimensions INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      document_count INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      generation_id INTEGER NOT NULL,
      schema_version INTEGER NOT NULL
    )`
  );
}

async function ensurePostgresIndexTables(
  pool: Pool,
  metadata: IndexMetadata
): Promise<void> {
  const chunkTable = quoteIdentifier(getPostgresChunkTableName(metadata.name));
  const fileTable = quoteIdentifier(getPostgresFileTableName(metadata.name));
  const vectorDimensions = metadata.modelDimensions;
  const chunkVectorIndex = quoteIdentifier(`${getPostgresChunkTableName(metadata.name)}_vector_idx`);
  const chunkFileIndex = quoteIdentifier(`${getPostgresChunkTableName(metadata.name)}_file_idx`);
  const filePathIndex = quoteIdentifier(`${getPostgresFileTableName(metadata.name)}_path_idx`);

  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${chunkTable} (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      vector vector(${vectorDimensions}) NOT NULL,
      language TEXT,
      line_start INTEGER,
      line_end INTEGER,
      file_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${chunkVectorIndex}
      ON ${chunkTable}
      USING hnsw (vector vector_cosine_ops)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${chunkFileIndex}
      ON ${chunkTable} (file_path, chunk_index)`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${fileTable} (
      file_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${filePathIndex}
      ON ${fileTable} (file_path)`
  );
}

async function writeLegacyMetadata(db: IndexDatabase, metadata: IndexMetadata): Promise<void> {
  if (db.mode !== 'local') {
    return;
  }

  const indexDir = getLegacyIndexDir(db, metadata.name);
  await mkdir(indexDir, { recursive: true });
  await writeFile(join(indexDir, 'meta.json'), JSON.stringify(metadata, null, 2), 'utf-8');
}

async function readLegacyMetadata(db: IndexDatabase, name: string): Promise<IndexMetadata | null> {
  if (db.mode !== 'local') {
    return null;
  }

  try {
    const content = await readFile(join(getLegacyIndexDir(db, name), 'meta.json'), 'utf-8');
    return JSON.parse(content) as IndexMetadata;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function removeLegacyMetadata(db: IndexDatabase, name: string): Promise<void> {
  if (db.mode !== 'local') {
    return;
  }

  await rm(getLegacyIndexDir(db, name), { recursive: true, force: true });
}

async function tableExists(db: IndexDatabase, tableName: string): Promise<boolean> {
  const cached = db.tableExistence.get(tableName);
  if (cached !== undefined) {
    return cached;
  }

  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = $1
       ) AS exists`,
      [tableName]
    );
    const exists = result.rows[0]?.exists ?? false;
    db.tableExistence.set(tableName, exists);
    return exists;
  }

  const tableNames = await db.connection!.tableNames();
  let exists = tableNames.includes(tableName);
  if (!exists) {
    try {
      await db.connection!.openTable(tableName);
      exists = true;
    } catch {
      exists = false;
    }
  }
  db.tableExistence.set(tableName, exists);
  return exists;
}

function rememberTable(db: IndexDatabase, tableName: string, exists: boolean): void {
  db.tableExistence.set(tableName, exists);
}

async function getMetadataTableIfExists(db: IndexDatabase): Promise<lancedb.Table | null> {
  if (isPostgresDatabase(db)) {
    return null;
  }

  if (!(await tableExists(db, INDEX_METADATA_TABLE))) {
    return null;
  }

  return await db.connection!.openTable(INDEX_METADATA_TABLE);
}

async function ensureMetadataTable(db: IndexDatabase): Promise<lancedb.Table> {
  if (isPostgresDatabase(db)) {
    await ensurePostgresBaseTables(requirePostgresPool(db));
    throw new Error('ensureMetadataTable is not used for Postgres databases');
  }

  const table = await getMetadataTableIfExists(db);
  if (table) {
    return table;
  }

  const placeholder: IndexMetadataRecord = {
    name: '__placeholder__',
    root_path: '',
    status: 'building',
    model: '',
    model_dimensions: 0,
    created_at: '',
    updated_at: '',
    document_count: 0,
    chunk_count: 0,
    generation_id: 0,
    schema_version: CURRENT_SCHEMA_VERSION,
  };

  await db.connection!.createTable(INDEX_METADATA_TABLE, [placeholder]);
  rememberTable(db, INDEX_METADATA_TABLE, true);

  const createdTable = await db.connection!.openTable(INDEX_METADATA_TABLE);
  await createdTable.delete("name = '__placeholder__'");
  return createdTable;
}

async function saveMetadata(db: IndexDatabase, metadata: IndexMetadata): Promise<void> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    await pool.query(
      `INSERT INTO ${quoteIdentifier(POSTGRES_INDEXES_TABLE)} (
        index_name,
        root_path,
        status,
        model,
        model_dimensions,
        created_at,
        updated_at,
        document_count,
        chunk_count,
        generation_id,
        schema_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (index_name)
      DO UPDATE SET
        root_path = EXCLUDED.root_path,
        status = EXCLUDED.status,
        model = EXCLUDED.model,
        model_dimensions = EXCLUDED.model_dimensions,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        document_count = EXCLUDED.document_count,
        chunk_count = EXCLUDED.chunk_count,
        generation_id = EXCLUDED.generation_id,
        schema_version = EXCLUDED.schema_version`,
      [
        metadata.name,
        metadata.rootPath,
        metadata.status,
        metadata.model,
        metadata.modelDimensions,
        metadata.createdAt,
        metadata.updatedAt,
        metadata.documentCount,
        metadata.chunkCount,
        metadata.generationId,
        metadata.schemaVersion,
      ]
    );
    return;
  }

  const table = await ensureMetadataTable(db);
  await table.delete(`name = '${escapeSql(metadata.name)}'`);
  await table.add([metadataToRecord(metadata)]);
  await writeLegacyMetadata(db, metadata);
}

async function getStoredMetadata(db: IndexDatabase, name: string): Promise<IndexMetadata | null> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const result = await pool.query<PostgresIndexMetadataRow>(
      `SELECT *
         FROM ${quoteIdentifier(POSTGRES_INDEXES_TABLE)}
        WHERE index_name = $1
        LIMIT 1`,
      [name]
    );
    return result.rows[0] ? rowToMetadata(result.rows[0]) : null;
  }

  const table = await getMetadataTableIfExists(db);
  if (table) {
    const results = await table
      .query()
      .where(`name = '${escapeSql(name)}'`)
      .limit(1)
      .toArray();

    if (results.length > 0) {
      return recordToMetadata(results[0] as Record<string, unknown>);
    }
  }

  const legacy = await readLegacyMetadata(db, name);
  if (legacy) {
    await saveMetadata(db, legacy);
  }
  return legacy;
}

async function listStoredMetadata(db: IndexDatabase): Promise<IndexMetadata[]> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const result = await pool.query<PostgresIndexMetadataRow>(
      `SELECT *
         FROM ${quoteIdentifier(POSTGRES_INDEXES_TABLE)}
        ORDER BY index_name ASC`
    );
    return result.rows.map(rowToMetadata);
  }

  const table = await getMetadataTableIfExists(db);
  if (table) {
    const records = await table.query().toArray();
    const metadata = records.map((record: Record<string, unknown>) => recordToMetadata(record));
    if (metadata.length > 0) {
      return metadata;
    }
  }

  if (db.mode !== 'local') {
    return [];
  }

  const entries = await readdir(db.path, { withFileTypes: true });
  const legacyIndexes: IndexMetadata[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const legacy = await readLegacyMetadata(db, entry.name);
    if (!legacy) continue;

    legacyIndexes.push(legacy);
    await saveMetadata(db, legacy);
  }

  return legacyIndexes;
}

/**
 * Open or create a LanceDB database at the specified path.
 */
export async function openDatabase(
  dbPathOrSettings: string | DatabaseSettings
): Promise<IndexDatabase> {
  const settings = typeof dbPathOrSettings === 'string'
    ? { mode: 'local' as const, uri: dbPathOrSettings }
    : dbPathOrSettings;

  if (settings.mode === 'postgres') {
    const pool = new Pool({
      connectionString: settings.uri,
    });
    await ensurePostgresBaseTables(pool);

    return {
      path: settings.uri,
      mode: 'postgres',
      connection: null,
      pool,
      tableExistence: new Map(),
      close: async () => {
        await pool.end();
      },
    };
  }

  if (settings.mode === 'local') {
    await mkdir(settings.uri, { recursive: true });
  }

  const connection = settings.storageOptions
    ? await lancedb.connect(settings.uri, { storageOptions: settings.storageOptions })
    : await lancedb.connect(settings.uri);

  return {
    path: settings.uri,
    mode: settings.mode,
    connection,
    pool: null,
    tableExistence: new Map(),
    close: async () => {
      // LanceDB connections don't require explicit close
      // but we keep the interface for consistency
    },
  };
}

/**
 * Create a new index with the given options.
 */
export async function createIndex(
  db: IndexDatabase,
  options: CreateIndexOptions
): Promise<IndexHandle> {
  const existing = await getStoredMetadata(db, options.name);
  if (existing) {
    throw new Error(`Index "${options.name}" already exists`);
  }

  // Create metadata
  const now = new Date().toISOString();
  const metadata: IndexMetadata = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: options.name,
    rootPath: options.rootPath,
    status: 'building',
    model: options.model,
    modelDimensions: options.modelDimensions,
    createdAt: now,
    updatedAt: now,
    documentCount: 0,
    chunkCount: 0,
    generationId: 1,
  };

  await saveMetadata(db, metadata);
  if (isPostgresDatabase(db)) {
    await ensurePostgresIndexTables(requirePostgresPool(db), metadata);
  }

  return {
    name: options.name,
    metadata,
    table: null,
  };
}

/**
 * Get an existing index by name.
 */
export async function getIndex(
  db: IndexDatabase,
  name: string
): Promise<IndexHandle | null> {
  const metadata = await getStoredMetadata(db, name);
  if (!metadata) {
    return null;
  }

  return {
    name,
    metadata,
    table: null,
  };
}

/**
 * Delete an index by name.
 */
export async function deleteIndex(
  db: IndexDatabase,
  name: string
): Promise<boolean> {
  const existing = await getStoredMetadata(db, name);
  if (!existing) {
    return false;
  }

  const metadataTable = await getMetadataTableIfExists(db);
  if (metadataTable) {
    await metadataTable.delete(`name = '${escapeSql(name)}'`);
  }

  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    await pool.query(
      `DELETE FROM ${quoteIdentifier(POSTGRES_INDEXES_TABLE)}
        WHERE index_name = $1`,
      [name]
    );
  }

  const candidateTables = isPostgresDatabase(db)
    ? new Set(getKnownIndexTableNames(name, 'postgres'))
    : new Set([
        ...(await db.connection!.tableNames()).filter((tableName) => tableName.startsWith(`${name}_`)),
        ...getKnownIndexTableNames(name),
      ]);

  for (const tableName of candidateTables) {
    try {
      if (isPostgresDatabase(db)) {
        await requirePostgresPool(db).query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
      } else {
        await db.connection!.dropTable(tableName);
      }
    } catch {
      // Ignore missing tables to keep delete idempotent across backends
    }
    rememberTable(db, tableName, false);
  }

  await removeLegacyMetadata(db, name);
  return true;
}

/**
 * List all indexes in the database.
 */
export async function listIndexes(db: IndexDatabase): Promise<IndexHandle[]> {
  const metadata = await listStoredMetadata(db);
  return metadata.map((entry) => ({
    name: entry.name,
    metadata: entry,
    table: null,
  }));
}

/**
 * File metadata record for hash optimization.
 */
export interface FileMetadata {
  file_path: string;
  content_hash: string;
  chunk_count: number;
  updated_at: string;
  [key: string]: unknown;  // Index signature for LanceDB compatibility
}

/**
 * Convert a DocumentChunk to a LanceDB record.
 * Note: We use empty string for missing language and -1 for missing line numbers
 * because LanceDB cannot infer types from null columns.
 */
function chunkToRecord(chunk: DocumentChunk): Record<string, unknown> {
  return {
    id: chunk.id,
    file_path: chunk.filePath,
    relative_path: chunk.relativePath,
    content_hash: chunk.contentHash,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    vector: Array.from(chunk.vector),
    language: chunk.language ?? '',
    line_start: chunk.lineStart ?? -1,
    line_end: chunk.lineEnd ?? -1,
    file_type: chunk.fileType,
    created_at: chunk.createdAt,
  };
}

/**
 * Convert a LanceDB record to a DocumentChunk.
 */
function recordToChunk(record: Record<string, unknown>): DocumentChunk {
  const language = record['language'];
  const lineStart = record['line_start'];
  const lineEnd = record['line_end'];

  return {
    id: record['id'] as string,
    filePath: record['file_path'] as string,
    relativePath: record['relative_path'] as string,
    contentHash: record['content_hash'] as string,
    chunkIndex: record['chunk_index'] as number,
    content: record['content'] as string,
    vector: parseVectorValue(record['vector']),
    language: typeof language === 'string' && language !== '' ? language : undefined,
    lineStart: typeof lineStart === 'number' && lineStart !== -1 ? lineStart : undefined,
    lineEnd: typeof lineEnd === 'number' && lineEnd !== -1 ? lineEnd : undefined,
    fileType: record['file_type'] as string,
    createdAt: record['created_at'] as string,
  };
}

/**
 * Add chunks to an index.
 */
export async function addChunks(
  db: IndexDatabase,
  handle: IndexHandle,
  chunks: DocumentChunk[]
): Promise<number> {
  if (chunks.length === 0) return 0;

  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    await ensurePostgresIndexTables(pool, handle.metadata);
    const tableName = quoteIdentifier(getPostgresChunkTableName(handle.name));
    const values: string[] = [];
    const params: unknown[] = [];

    for (const chunk of chunks) {
      const base = params.length;
      params.push(
        chunk.id,
        chunk.filePath,
        chunk.relativePath,
        chunk.contentHash,
        chunk.chunkIndex,
        chunk.content,
        vectorToSql(chunk.vector),
        chunk.language ?? null,
        chunk.lineStart ?? null,
        chunk.lineEnd ?? null,
        chunk.fileType,
        chunk.createdAt
      );
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::vector, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`
      );
    }

    await pool.query(
      `INSERT INTO ${tableName} (
        id,
        file_path,
        relative_path,
        content_hash,
        chunk_index,
        content,
        vector,
        language,
        line_start,
        line_end,
        file_type,
        created_at
      ) VALUES ${values.join(', ')}`,
      params
    );
    return chunks.length;
  }

  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  const records = chunks.map(chunkToRecord);

  try {
    // Try to open existing table and add
    const table = await db.connection!.openTable(fullTableName);
    await table.add(records);
    rememberTable(db, fullTableName, true);
  } catch {
    // Table doesn't exist, create it with the first batch
    await db.connection!.createTable(fullTableName, records);
    rememberTable(db, fullTableName, true);
  }

  return chunks.length;
}

/**
 * Search for chunks by vector similarity.
 */
export async function searchChunks(
  db: IndexDatabase,
  handle: IndexHandle,
  queryVector: Float32Array,
  options: SearchOptions
): Promise<SearchResult[]> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const tableName = quoteIdentifier(getPostgresChunkTableName(handle.name));
    const result = await pool.query<Record<string, unknown>>(
      `SELECT
         id,
         file_path,
         relative_path,
         content_hash,
         chunk_index,
         content,
         vector::text AS vector,
         language,
         line_start,
         line_end,
         file_type,
         created_at::text AS created_at,
         (vector <=> $1::vector) AS _distance
       FROM ${tableName}
       ORDER BY vector <=> $1::vector
       LIMIT $2`,
      [vectorToSql(queryVector), options.limit]
    );

    return result.rows.map((row) => {
      const chunk = recordToChunk(row);
      return {
        ...chunk,
        _score: Number(row['_distance'] ?? 0),
      };
    });
  }

  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  if (!(await tableExists(db, fullTableName))) {
    return [];
  }

  const table = await db.connection!.openTable(fullTableName);
  const query = table.query().nearestTo(Array.from(queryVector));
  const results = await query
    .distanceType('cosine')
    .limit(options.limit)
    .toArray();

  return results.map((r: Record<string, unknown>) => {
    const chunk = recordToChunk(r);
    return {
      ...chunk,
      _score: r['_distance'] as number,
    };
  });
}

/**
 * Get the number of chunks in an index.
 */
export async function getChunkCount(
  db: IndexDatabase,
  handle: IndexHandle
): Promise<number> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM ${quoteIdentifier(getPostgresChunkTableName(handle.name))}`
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  if (!(await tableExists(db, fullTableName))) {
    return 0;
  }

  const table = await db.connection!.openTable(fullTableName);
  return await table.countRows();
}

/**
 * Get the number of unique files tracked by an index.
 */
export async function getDocumentCount(
  db: IndexDatabase,
  handle: IndexHandle
): Promise<number> {
  const metadataHashes = await getFileMetadataHashes(db, handle);
  if (metadataHashes.size > 0) {
    return metadataHashes.size;
  }

  if (isPostgresDatabase(db)) {
    const result = await requirePostgresPool(db).query<{ count: string }>(
      `SELECT COUNT(DISTINCT file_path)::text AS count
         FROM ${quoteIdentifier(getPostgresChunkTableName(handle.name))}`
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  if (!(await tableExists(db, fullTableName))) {
    return 0;
  }

  const table = await db.connection!.openTable(fullTableName);
  const records = await table.query().select(['file_path']).toArray();
  return new Set(records.map((record) => record['file_path'] as string)).size;
}

/**
 * Update the status of an index and sync chunk and file counts.
 */
export async function updateIndexStatus(
  db: IndexDatabase,
  handle: IndexHandle,
  status: 'building' | 'ready' | 'failed'
): Promise<void> {
  const [chunkCount, documentCount] = await Promise.all([
    getChunkCount(db, handle),
    getDocumentCount(db, handle),
  ]);

  const metadata: IndexMetadata = {
    ...handle.metadata,
    status,
    documentCount,
    chunkCount,
    updatedAt: new Date().toISOString(),
  };

  await saveMetadata(db, metadata);
  handle.metadata = metadata;
}

/**
 * Get content hashes for all files in an index.
 * Returns a Map of filePath -> contentHash.
 * This is used for incremental indexing to detect which files have changed.
 */
export async function getFileContentHashes(
  db: IndexDatabase,
  handle: IndexHandle
): Promise<Map<string, string>> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const result = await pool.query<{ file_path: string; content_hash: string }>(
      `SELECT DISTINCT ON (file_path) file_path, content_hash
         FROM ${quoteIdentifier(getPostgresChunkTableName(handle.name))}
        ORDER BY file_path, chunk_index ASC`
    );

    return new Map(result.rows.map((row) => [row.file_path, row.content_hash]));
  }

  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  if (!(await tableExists(db, fullTableName))) {
    return new Map();
  }

  const table = await db.connection!.openTable(fullTableName);

  // Query distinct file paths and their content hashes
  // We use a simple approach: get all records and deduplicate in memory
  const records = await table.query().select(['file_path', 'content_hash']).toArray();

  const hashMap = new Map<string, string>();
  for (const record of records) {
    const filePath = record['file_path'] as string;
    const contentHash = record['content_hash'] as string;

    // Store the first hash we find for each file (all chunks from same file have same hash)
    if (!hashMap.has(filePath)) {
      hashMap.set(filePath, contentHash);
    }
  }

  return hashMap;
}

/**
 * Get all chunks for a specific file path.
 * Returns chunks ordered by chunk index.
 */
export async function getChunksByFilePath(
  db: IndexDatabase,
  handle: IndexHandle,
  filePath: string
): Promise<DocumentChunk[]> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const result = await pool.query<Record<string, unknown>>(
      `SELECT
         id,
         file_path,
         relative_path,
         content_hash,
         chunk_index,
         content,
         vector::text AS vector,
         language,
         line_start,
         line_end,
         file_type,
         created_at::text AS created_at
       FROM ${quoteIdentifier(getPostgresChunkTableName(handle.name))}
       WHERE file_path = $1
       ORDER BY chunk_index ASC`,
      [filePath]
    );
    return result.rows.map(recordToChunk);
  }

  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  if (!(await tableExists(db, fullTableName))) {
    return [];
  }

  const table = await db.connection!.openTable(fullTableName);

  // Query for all chunks matching this file path
  const records = await table
    .query()
    .where(`file_path = '${filePath.replace(/'/g, "''")}'`)
    .toArray();

  // Convert records to chunks and sort by chunk index
  const chunks = records.map((r: Record<string, unknown>) => recordToChunk(r));
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

  return chunks;
}

/**
 * Delete all chunks for a specific file path.
 * Returns the number of chunks deleted.
 */
export async function deleteChunksByFilePath(
  db: IndexDatabase,
  handle: IndexHandle,
  filePath: string
): Promise<number> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM ${quoteIdentifier(getPostgresChunkTableName(handle.name))}
        WHERE file_path = $1`,
      [filePath]
    );
    const count = Number(countResult.rows[0]?.count ?? '0');
    if (count === 0) {
      return 0;
    }
    await pool.query(
      `DELETE FROM ${quoteIdentifier(getPostgresChunkTableName(handle.name))}
        WHERE file_path = $1`,
      [filePath]
    );
    return count;
  }

  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  if (!(await tableExists(db, fullTableName))) {
    return 0;
  }

  const table = await db.connection!.openTable(fullTableName);

  // First, count how many chunks we're deleting
  const existingChunks = await getChunksByFilePath(db, handle, filePath);
  const deleteCount = existingChunks.length;

  if (deleteCount === 0) {
    return 0;
  }

  // Delete all chunks for this file path
  await table.delete(`file_path = '${filePath.replace(/'/g, "''")}'`);

  return deleteCount;
}

/**
 * Delete all chunks from an index.
 * Returns the number of chunks deleted.
 */
export async function deleteAllChunks(
  db: IndexDatabase,
  handle: IndexHandle
): Promise<number> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const count = await getChunkCount(db, handle);
    if (count === 0) {
      return 0;
    }
    await pool.query(
      `TRUNCATE TABLE ${quoteIdentifier(getPostgresChunkTableName(handle.name))}`
    );
    return count;
  }

  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  if (!(await tableExists(db, fullTableName))) {
    return 0;
  }

  // Count existing chunks first
  const count = await getChunkCount(db, handle);
  if (count === 0) {
    return 0;
  }

  // Delete all chunks by dropping and recreating table
  // This is more efficient than deleting row by row
  await db.connection!.dropTable(fullTableName);
  rememberTable(db, fullTableName, false);

  // Recreate empty table with same schema
  await db.connection!.createTable(fullTableName, [
    {
      id: '',
      file_path: '',
      relative_path: '',
      content_hash: '',
      chunk_index: 0,
      content: '',
      vector: new Float32Array(handle.metadata.modelDimensions),
      line_start: 0,
      line_end: 0,
      file_type: '',
      created_at: '',
    },
  ]);
  rememberTable(db, fullTableName, true);

  // Delete the placeholder row
  const table = await db.connection!.openTable(fullTableName);
  await table.delete("id = ''");

  return count;
}

/**
 * Create or ensure the file metadata table exists for an index.
 * This table stores file-level information for efficient hash lookups.
 */
export async function createFileMetadataTable(
  db: IndexDatabase,
  handle: IndexHandle
): Promise<void> {
  if (isPostgresDatabase(db)) {
    await ensurePostgresIndexTables(requirePostgresPool(db), handle.metadata);
    return;
  }

  const fullTableName = `${handle.name}_${FILE_METADATA_TABLE_SUFFIX}`;
  if (await tableExists(db, fullTableName)) {
    // Table already exists
    return;
  }

  // Create table with placeholder record
  const placeholder: FileMetadata = {
    file_path: '__placeholder__',
    content_hash: '',
    chunk_count: 0,
    updated_at: new Date().toISOString(),
  };

  await db.connection!.createTable(fullTableName, [placeholder]);
  rememberTable(db, fullTableName, true);

  // Delete the placeholder
  const table = await db.connection!.openTable(fullTableName);
  await table.delete("file_path = '__placeholder__'");
}

/**
 * Upsert file metadata for a single file.
 * If the file already exists, updates its hash and chunk count.
 * If the file doesn't exist, inserts a new record.
 */
export async function upsertFileMetadata(
  db: IndexDatabase,
  handle: IndexHandle,
  filePath: string,
  contentHash: string,
  chunkCount: number
): Promise<void> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    await pool.query(
      `INSERT INTO ${quoteIdentifier(getPostgresFileTableName(handle.name))} (
        file_path,
        content_hash,
        chunk_count,
        updated_at
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (file_path)
      DO UPDATE SET
        content_hash = EXCLUDED.content_hash,
        chunk_count = EXCLUDED.chunk_count,
        updated_at = EXCLUDED.updated_at`,
      [filePath, contentHash, chunkCount, new Date().toISOString()]
    );
    return;
  }

  const fullTableName = `${handle.name}_${FILE_METADATA_TABLE_SUFFIX}`;
  if (!(await tableExists(db, fullTableName))) {
    throw new Error(`File metadata table does not exist for index "${handle.name}"`);
  }

  const table = await db.connection!.openTable(fullTableName);

  // Check if file already exists
  const existing = await table
    .query()
    .where(`file_path = '${filePath.replace(/'/g, "''")}'`)
    .toArray();

  if (existing.length > 0) {
    // Update existing record by deleting and reinserting
    await table.delete(`file_path = '${filePath.replace(/'/g, "''")}'`);
  }

  // Insert new record
  const record: FileMetadata = {
    file_path: filePath,
    content_hash: contentHash,
    chunk_count: chunkCount,
    updated_at: new Date().toISOString(),
  };

  await table.add([record]);
}

/**
 * Get content hashes for all files in an index from the metadata table.
 * This is much more efficient than loading all chunks.
 * Returns a Map of filePath -> contentHash.
 */
export async function getFileMetadataHashes(
  db: IndexDatabase,
  handle: IndexHandle
): Promise<Map<string, string>> {
  if (isPostgresDatabase(db)) {
    const pool = requirePostgresPool(db);
    const result = await pool.query<{ file_path: string; content_hash: string }>(
      `SELECT file_path, content_hash
         FROM ${quoteIdentifier(getPostgresFileTableName(handle.name))}`
    );
    return new Map(result.rows.map((row) => [row.file_path, row.content_hash]));
  }

  const fullTableName = `${handle.name}_${FILE_METADATA_TABLE_SUFFIX}`;
  if (!(await tableExists(db, fullTableName))) {
    // Metadata table doesn't exist - return empty map
    // This handles migration case for old indexes
    return new Map();
  }

  const table = await db.connection!.openTable(fullTableName);
  const records = await table.query().select(['file_path', 'content_hash']).toArray();

  const hashMap = new Map<string, string>();
  for (const record of records) {
    const filePath = record['file_path'] as string;
    const contentHash = record['content_hash'] as string;
    hashMap.set(filePath, contentHash);
  }

  return hashMap;
}

/**
 * Delete file metadata for a specific file path.
 */
export async function deleteFileMetadata(
  db: IndexDatabase,
  handle: IndexHandle,
  filePath: string
): Promise<void> {
  if (isPostgresDatabase(db)) {
    await requirePostgresPool(db).query(
      `DELETE FROM ${quoteIdentifier(getPostgresFileTableName(handle.name))}
        WHERE file_path = $1`,
      [filePath]
    );
    return;
  }

  const fullTableName = `${handle.name}_${FILE_METADATA_TABLE_SUFFIX}`;
  if (!(await tableExists(db, fullTableName))) {
    // Table doesn't exist - nothing to delete
    return;
  }

  const table = await db.connection!.openTable(fullTableName);
  await table.delete(`file_path = '${filePath.replace(/'/g, "''")}'`);
}

/**
 * Calculate cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i];
    const bVal = b[i];
    if (aVal !== undefined && bVal !== undefined) {
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Rerank search results using Maximal Marginal Relevance (MMR) algorithm.
 *
 * MMR = λ * sim(query, doc) - (1-λ) * max(sim(doc, selected_docs))
 *
 * @param results - Initial search results sorted by relevance
 * @param queryVector - The query embedding vector
 * @param lambda - Trade-off parameter between relevance (1.0) and diversity (0.0)
 * @returns Reranked results with diversity considered
 */
export function rerankerWithMMR(
  results: SearchResult[],
  queryVector: Float32Array,
  lambda: number
): SearchResult[] {
  // Edge cases
  if (results.length === 0) {
    return [];
  }
  if (results.length === 1) {
    return results;
  }

  // Validate lambda
  if (lambda < 0 || lambda > 1) {
    throw new Error('Lambda must be between 0.0 and 1.0');
  }

  const selected: SearchResult[] = [];
  const remaining = [...results];

  // First result is always the most relevant
  selected.push(remaining.shift()!);

  // Iteratively select remaining results
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      if (!candidate) continue;

      // Calculate relevance to query (convert distance to similarity)
      // LanceDB returns cosine distance, where smaller is better
      // Similarity = 1 - distance
      const queryRelevance = 1 - candidate._score;

      // Calculate maximum similarity to already selected documents
      let maxSelectedSimilarity = 0;
      for (const selectedDoc of selected) {
        const similarity = cosineSimilarity(candidate.vector, selectedDoc.vector);
        maxSelectedSimilarity = Math.max(maxSelectedSimilarity, similarity);
      }

      // MMR score
      const mmrScore = lambda * queryRelevance - (1 - lambda) * maxSelectedSimilarity;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    // Add the best candidate to selected and remove from remaining
    const bestCandidate = remaining.splice(bestIdx, 1)[0];
    if (bestCandidate) {
      selected.push(bestCandidate);
    }
  }

  return selected;
}
