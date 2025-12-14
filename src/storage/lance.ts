import * as lancedb from '@lancedb/lancedb';
import { mkdir, rm, readdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Index metadata stored in meta.json for each index.
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
  connection: lancedb.Connection;
  close(): Promise<void>;
}

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Open or create a LanceDB database at the specified path.
 */
export async function openDatabase(dbPath: string): Promise<IndexDatabase> {
  // Ensure directory exists
  await mkdir(dbPath, { recursive: true });

  const connection = await lancedb.connect(dbPath);

  return {
    path: dbPath,
    connection,
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
  const indexDir = join(db.path, options.name);

  // Check if index already exists
  try {
    await access(indexDir);
    throw new Error(`Index "${options.name}" already exists`);
  } catch (err) {
    // Expected - directory shouldn't exist
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  // Create index directory
  await mkdir(indexDir, { recursive: true });

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

  // Write metadata
  const metaPath = join(indexDir, 'meta.json');
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

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
  const indexDir = join(db.path, name);
  const metaPath = join(indexDir, 'meta.json');

  try {
    const metaContent = await readFile(metaPath, 'utf-8');
    const metadata = JSON.parse(metaContent) as IndexMetadata;

    return {
      name,
      metadata,
      table: null,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Delete an index by name.
 */
export async function deleteIndex(
  db: IndexDatabase,
  name: string
): Promise<boolean> {
  const indexDir = join(db.path, name);

  try {
    await access(indexDir);
    await rm(indexDir, { recursive: true, force: true });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * List all indexes in the database.
 */
export async function listIndexes(db: IndexDatabase): Promise<IndexHandle[]> {
  const entries = await readdir(db.path, { withFileTypes: true });
  const indexes: IndexHandle[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const handle = await getIndex(db, entry.name);
    if (handle) {
      indexes.push(handle);
    }
  }

  return indexes;
}

const TABLE_NAME = 'chunks';

/**
 * Get or create the LanceDB table for an index.
 */
async function getOrCreateTable(
  db: IndexDatabase,
  handle: IndexHandle
): Promise<lancedb.Table> {
  const tableNames = await db.connection.tableNames();
  const fullTableName = `${handle.name}_${TABLE_NAME}`;

  if (tableNames.includes(fullTableName)) {
    return await db.connection.openTable(fullTableName);
  }

  // Table doesn't exist yet, return null - will be created on first add
  throw new Error('TABLE_NOT_EXISTS');
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
  const language = record['language'] as string;
  const lineStart = record['line_start'] as number;
  const lineEnd = record['line_end'] as number;

  return {
    id: record['id'] as string,
    filePath: record['file_path'] as string,
    relativePath: record['relative_path'] as string,
    contentHash: record['content_hash'] as string,
    chunkIndex: record['chunk_index'] as number,
    content: record['content'] as string,
    vector: new Float32Array(record['vector'] as number[]),
    language: language === '' ? undefined : language,
    lineStart: lineStart === -1 ? undefined : lineStart,
    lineEnd: lineEnd === -1 ? undefined : lineEnd,
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

  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  const records = chunks.map(chunkToRecord);

  try {
    // Try to open existing table and add
    const table = await db.connection.openTable(fullTableName);
    await table.add(records);
  } catch {
    // Table doesn't exist, create it with the first batch
    await db.connection.createTable(fullTableName, records);
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
  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  const tableNames = await db.connection.tableNames();

  if (!tableNames.includes(fullTableName)) {
    return [];
  }

  const table = await db.connection.openTable(fullTableName);
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
  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  const tableNames = await db.connection.tableNames();

  if (!tableNames.includes(fullTableName)) {
    return 0;
  }

  const table = await db.connection.openTable(fullTableName);
  return await table.countRows();
}

/**
 * Update the status of an index and sync chunk count.
 */
export async function updateIndexStatus(
  db: IndexDatabase,
  handle: IndexHandle,
  status: 'building' | 'ready' | 'failed'
): Promise<void> {
  const metaPath = join(db.path, handle.name, 'meta.json');
  const chunkCount = await getChunkCount(db, handle);

  const metadata: IndexMetadata = {
    ...handle.metadata,
    status,
    chunkCount,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  handle.metadata = metadata;
}
