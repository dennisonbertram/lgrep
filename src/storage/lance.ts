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
const FILE_METADATA_TABLE_SUFFIX = 'files';

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

/**
 * Get content hashes for all files in an index.
 * Returns a Map of filePath -> contentHash.
 * This is used for incremental indexing to detect which files have changed.
 */
export async function getFileContentHashes(
  db: IndexDatabase,
  handle: IndexHandle
): Promise<Map<string, string>> {
  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  const tableNames = await db.connection.tableNames();

  if (!tableNames.includes(fullTableName)) {
    return new Map();
  }

  const table = await db.connection.openTable(fullTableName);

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
  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  const tableNames = await db.connection.tableNames();

  if (!tableNames.includes(fullTableName)) {
    return [];
  }

  const table = await db.connection.openTable(fullTableName);

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
  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  const tableNames = await db.connection.tableNames();

  if (!tableNames.includes(fullTableName)) {
    return 0;
  }

  const table = await db.connection.openTable(fullTableName);

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
  const fullTableName = `${handle.name}_${TABLE_NAME}`;
  const tableNames = await db.connection.tableNames();

  if (!tableNames.includes(fullTableName)) {
    return 0;
  }

  // Count existing chunks first
  const count = await getChunkCount(db, handle);
  if (count === 0) {
    return 0;
  }

  // Delete all chunks by dropping and recreating table
  // This is more efficient than deleting row by row
  await db.connection.dropTable(fullTableName);

  // Recreate empty table with same schema
  await db.connection.createTable(fullTableName, [
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

  // Delete the placeholder row
  const table = await db.connection.openTable(fullTableName);
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
  const fullTableName = `${handle.name}_${FILE_METADATA_TABLE_SUFFIX}`;
  const tableNames = await db.connection.tableNames();

  if (tableNames.includes(fullTableName)) {
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

  await db.connection.createTable(fullTableName, [placeholder]);

  // Delete the placeholder
  const table = await db.connection.openTable(fullTableName);
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
  const fullTableName = `${handle.name}_${FILE_METADATA_TABLE_SUFFIX}`;
  const tableNames = await db.connection.tableNames();

  if (!tableNames.includes(fullTableName)) {
    throw new Error(`File metadata table does not exist for index "${handle.name}"`);
  }

  const table = await db.connection.openTable(fullTableName);

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
  const fullTableName = `${handle.name}_${FILE_METADATA_TABLE_SUFFIX}`;
  const tableNames = await db.connection.tableNames();

  if (!tableNames.includes(fullTableName)) {
    // Metadata table doesn't exist - return empty map
    // This handles migration case for old indexes
    return new Map();
  }

  const table = await db.connection.openTable(fullTableName);
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
  const fullTableName = `${handle.name}_${FILE_METADATA_TABLE_SUFFIX}`;
  const tableNames = await db.connection.tableNames();

  if (!tableNames.includes(fullTableName)) {
    // Table doesn't exist - nothing to delete
    return;
  }

  const table = await db.connection.openTable(fullTableName);
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
