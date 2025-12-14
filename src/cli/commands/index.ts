import { basename, resolve } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { walkFiles, type WalkResult } from '../../core/walker.js';
import { chunkText } from '../../core/chunker.js';
import { createEmbeddingClient } from '../../core/embeddings.js';
import { hashContent } from '../../core/hash.js';
import { loadConfig } from '../../storage/config.js';
import {
  openDatabase,
  createIndex,
  addChunks,
  updateIndexStatus,
  type DocumentChunk,
} from '../../storage/lance.js';
import {
  openEmbeddingCache,
  getEmbedding,
  setEmbedding,
} from '../../storage/cache.js';
import { getDbPath, getCachePath } from '../utils/paths.js';

/**
 * Options for the index command.
 */
export interface IndexOptions {
  name?: string;
}

/**
 * Result of the index command.
 */
export interface IndexResult {
  success: boolean;
  indexName: string;
  filesProcessed: number;
  chunksCreated: number;
  error?: string;
}

/**
 * Run the index command.
 *
 * @param sourcePath - Path to the directory to index
 * @param options - Index options
 * @returns Index result
 */
export async function runIndexCommand(
  sourcePath: string,
  options: IndexOptions = {}
): Promise<IndexResult> {
  const absolutePath = resolve(sourcePath);

  // Verify path exists
  try {
    await access(absolutePath);
  } catch {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  // Determine index name
  const indexName = options.name ?? basename(absolutePath);

  // Load config
  const config = await loadConfig();

  // Open database and cache
  const dbPath = getDbPath();
  const cachePath = getCachePath();
  const db = await openDatabase(dbPath);
  const cache = await openEmbeddingCache(cachePath);

  try {
    // Create embedding client and get dimensions
    const embedClient = createEmbeddingClient({ model: config.model });
    const dimensions = await embedClient.getModelDimensions();

    // Create index
    const handle = await createIndex(db, {
      name: indexName,
      rootPath: absolutePath,
      model: config.model,
      modelDimensions: dimensions,
    });

    // Walk files
    const files = await walkFiles(absolutePath, {
      excludes: config.excludes,
      secretExcludes: config.secretExcludes,
      maxFileSize: config.maxFileSize,
    });

    // Process files and create chunks
    let totalChunks = 0;

    for (const file of files) {
      const chunks = await processFile(
        file,
        embedClient,
        cache,
        config.chunkSize,
        config.chunkOverlap
      );

      if (chunks.length > 0) {
        await addChunks(db, handle, chunks);
        totalChunks += chunks.length;
      }
    }

    // Update index status to ready
    await updateIndexStatus(db, handle, 'ready');

    return {
      success: true,
      indexName,
      filesProcessed: files.length,
      chunksCreated: totalChunks,
    };
  } catch (err) {
    throw err;
  } finally {
    await db.close();
    await cache.close();
  }
}

/**
 * Process a single file: read, chunk, embed.
 */
async function processFile(
  file: WalkResult,
  embedClient: Awaited<ReturnType<typeof createEmbeddingClient>>,
  cache: Awaited<ReturnType<typeof openEmbeddingCache>>,
  chunkSize: number,
  chunkOverlap: number
): Promise<DocumentChunk[]> {
  // Read file content
  const content = await readFile(file.absolutePath, 'utf-8');
  const contentHash = hashContent(content);
  const fileType = file.extension;

  // Chunk the content
  const textChunks = chunkText(content, {
    maxTokens: chunkSize,
    overlapTokens: chunkOverlap,
  });

  const documentChunks: DocumentChunk[] = [];

  for (const chunk of textChunks) {
    // Check cache first
    let vector = await getEmbedding(cache, embedClient.model, chunk.content);

    if (!vector) {
      // Generate embedding
      const result = await embedClient.embed(chunk.content);
      const embedding = result.embeddings[0];
      if (!embedding) {
        throw new Error(`Failed to generate embedding for chunk ${chunk.index}`);
      }
      vector = new Float32Array(embedding);

      // Cache it
      await setEmbedding(cache, embedClient.model, chunk.content, vector);
    }

    documentChunks.push({
      id: randomUUID(),
      filePath: file.absolutePath,
      relativePath: file.relativePath,
      contentHash,
      chunkIndex: chunk.index,
      content: chunk.content,
      vector,
      lineStart: chunk.startLine,
      lineEnd: chunk.endLine,
      fileType,
      createdAt: new Date().toISOString(),
    });
  }

  return documentChunks;
}
