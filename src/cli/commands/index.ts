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
  getIndex,
  addChunks,
  updateIndexStatus,
  getFileContentHashes,
  deleteChunksByFilePath,
  type DocumentChunk,
} from '../../storage/lance.js';
import {
  openEmbeddingCache,
  getEmbedding,
  setEmbedding,
} from '../../storage/cache.js';
import { getDbPath, getCachePath } from '../utils/paths.js';
import { createSpinner } from '../utils/progress.js';

/**
 * Options for the index command.
 */
export interface IndexOptions {
  name?: string;
  showProgress?: boolean;
  mode?: 'create' | 'update';
  json?: boolean;
}

/**
 * Result of the index command.
 */
export interface IndexResult {
  success: boolean;
  indexName: string;
  filesProcessed: number;
  chunksCreated: number;
  filesSkipped?: number;
  filesUpdated?: number;
  filesAdded?: number;
  filesDeleted?: number;
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
  const showProgress = options.showProgress ?? true;
  const mode = options.mode ?? 'create';

  // Create spinner if progress is enabled
  const spinner = showProgress ? createSpinner('Initializing...') : null;

  try {
    spinner?.start();

    // Verify path exists
    try {
      await access(absolutePath);
    } catch {
      throw new Error(`Path does not exist: ${absolutePath}`);
    }

    // Determine index name
    const indexName = options.name ?? basename(absolutePath);

    // Load config
    spinner?.update('Loading configuration...');
    const config = await loadConfig();

    // Open database and cache
    spinner?.update('Opening database...');
    const dbPath = getDbPath();
    const cachePath = getCachePath();
    const db = await openDatabase(dbPath);
    const cache = await openEmbeddingCache(cachePath);

    try {
      // Create embedding client and get dimensions
      spinner?.update('Initializing embedding model...');
      const embedClient = createEmbeddingClient({ model: config.model });
      const dimensions = await embedClient.getModelDimensions();

      // Get or create index based on mode
      let handle;
      let existingHashes: Map<string, string> = new Map();

      if (mode === 'update') {
        // Update mode: index must exist
        spinner?.update('Loading existing index...');
        handle = await getIndex(db, indexName);
        if (!handle) {
          throw new Error(`Index "${indexName}" does not exist. Use mode='create' to create a new index.`);
        }

        // Get existing file hashes for incremental comparison
        existingHashes = await getFileContentHashes(db, handle);
      } else {
        // Create mode: index must not exist
        spinner?.update('Creating index...');
        handle = await createIndex(db, {
          name: indexName,
          rootPath: absolutePath,
          model: config.model,
          modelDimensions: dimensions,
        });
      }

      // Walk files
      spinner?.update('Discovering files...');
      const files = await walkFiles(absolutePath, {
        excludes: config.excludes,
        secretExcludes: config.secretExcludes,
        maxFileSize: config.maxFileSize,
      });

      // Track stats
      let totalChunks = 0;
      let filesSkipped = 0;
      let filesUpdated = 0;
      let filesAdded = 0;

      // Build set of current file paths for deletion detection
      const currentFilePaths = new Set(files.map(f => f.absolutePath));

      // Process files
      let processedFiles = 0;
      for (const file of files) {
        processedFiles++;
        spinner?.update(
          `Processing files (${processedFiles}/${files.length}): ${file.relativePath}`
        );

        // Read file to compute hash
        const content = await readFile(file.absolutePath, 'utf-8');
        const currentHash = hashContent(content);
        const existingHash = existingHashes.get(file.absolutePath);

        // Check if file has changed
        if (mode === 'update' && existingHash === currentHash) {
          // File unchanged - skip it
          filesSkipped++;
          continue;
        }

        // File is new or changed
        if (mode === 'update' && existingHash) {
          // File changed - delete old chunks first
          await deleteChunksByFilePath(db, handle, file.absolutePath);
          filesUpdated++;
        } else if (mode === 'update') {
          // New file in update mode
          filesAdded++;
        }

        // Process the file
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

      // Handle deleted files in update mode
      let filesDeleted = 0;
      if (mode === 'update') {
        for (const existingPath of Array.from(existingHashes.keys())) {
          if (!currentFilePaths.has(existingPath)) {
            // File was deleted - remove its chunks
            await deleteChunksByFilePath(db, handle, existingPath);
            filesDeleted++;
          }
        }
      }

      // Update index status to ready
      spinner?.update('Finalizing index...');
      await updateIndexStatus(db, handle, 'ready');

      // Success message
      if (mode === 'update') {
        const changes: string[] = [];
        if (filesSkipped > 0) changes.push(`${filesSkipped} unchanged`);
        if (filesUpdated > 0) changes.push(`${filesUpdated} updated`);
        if (filesAdded > 0) changes.push(`${filesAdded} added`);
        if (filesDeleted > 0) changes.push(`${filesDeleted} deleted`);

        spinner?.succeed(
          `Updated "${indexName}": ${changes.join(', ')} (${totalChunks} new chunks)`
        );
      } else {
        spinner?.succeed(
          `Indexed ${files.length} files (${totalChunks} chunks) as "${indexName}"`
        );
      }

      return {
        success: true,
        indexName,
        filesProcessed: files.length,
        chunksCreated: totalChunks,
        filesSkipped: mode === 'update' ? filesSkipped : undefined,
        filesUpdated: mode === 'update' ? filesUpdated : undefined,
        filesAdded: mode === 'update' ? filesAdded : undefined,
        filesDeleted: mode === 'update' ? filesDeleted : undefined,
      };
    } catch (err) {
      throw err;
    } finally {
      await db.close();
      await cache.close();
    }
  } catch (err) {
    spinner?.fail('Indexing failed');
    throw err;
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
