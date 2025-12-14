import { basename, resolve, extname } from 'node:path';
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
import { extractSymbols } from '../../core/ast/symbol-extractor.js';
import { extractDependencies } from '../../core/ast/dependency-extractor.js';
import { extractCalls } from '../../core/ast/call-extractor.js';
import {
  addSymbols,
  addDependencies,
  addCalls,
} from '../../storage/code-intel.js';
import type { CodeSymbol, CodeDependency, CallEdge } from '../../types/code-intel.js';

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
  symbolsIndexed?: number;
  dependenciesIndexed?: number;
  callsIndexed?: number;
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
      let totalSymbols = 0;
      let totalDependencies = 0;
      let totalCalls = 0;

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

        // Extract code intelligence for JS/TS files
        const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
        if (CODE_EXTENSIONS.includes(file.extension)) {
          try {
            // Extract symbols
            const rawSymbols = extractSymbols(
              content,
              file.absolutePath,
              file.relativePath,
              file.extension
            );
            const symbols = convertSymbols(rawSymbols, file.absolutePath, file.relativePath);
            await addSymbols(db, indexName, symbols);
            totalSymbols += symbols.length;

            // Extract dependencies
            const rawDeps = extractDependencies(content, file.absolutePath);
            const deps = convertDependencies(rawDeps, file.absolutePath);
            await addDependencies(db, indexName, deps);
            totalDependencies += deps.length;

            // Extract calls
            const rawCalls = extractCalls(content, file.absolutePath);
            const calls = convertCalls(rawCalls, file.absolutePath, file.relativePath);
            await addCalls(db, indexName, calls);
            totalCalls += calls.length;
          } catch (error) {
            // Gracefully handle code intelligence extraction errors
            // Don't fail the entire indexing if AST parsing fails
          }
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
        symbolsIndexed: totalSymbols,
        dependenciesIndexed: totalDependencies,
        callsIndexed: totalCalls,
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
 * Convert symbol extractor output to storage format
 */
function convertSymbols(
  rawSymbols: Array<{
    id: string;
    name: string;
    kind: string;
    filePath: string;
    relativePath: string;
    lineStart: number;
    lineEnd: number;
    columnStart: number;
    columnEnd: number;
    isExported: boolean;
    isDefaultExport: boolean;
    signature?: string;
    documentation?: string;
    parentId?: string;
    modifiers: string[];
  }>,
  filePath: string,
  relativePath: string
): CodeSymbol[] {
  return rawSymbols.map(sym => ({
    id: sym.id,
    name: sym.name,
    kind: sym.kind as CodeSymbol['kind'],
    filePath,
    relativePath,
    range: {
      start: {
        line: sym.lineStart,
        column: sym.columnStart,
      },
      end: {
        line: sym.lineEnd,
        column: sym.columnEnd,
      },
    },
    isExported: sym.isExported,
    isDefaultExport: sym.isDefaultExport,
    signature: sym.signature,
    documentation: sym.documentation,
    parentId: sym.parentId,
    modifiers: sym.modifiers,
  }));
}

/**
 * Convert dependency extractor output to storage format
 */
function convertDependencies(
  rawDeps: Array<{
    type: string;
    source?: string;
    isExternal: boolean;
    line?: number;
    column?: number;
    imported?: Array<{ name: string; alias?: string; isType?: boolean }>;
    default?: string;
    namespace?: string;
    exported?: Array<{ name: string; alias?: string }>;
  }>,
  sourceFile: string
): CodeDependency[] {
  return rawDeps.map((dep, index) => {
    const id = `${sourceFile}:${dep.source || 'export'}:${dep.line || index}`;

    // Map type to DependencyKind
    let kind: CodeDependency['kind'];
    switch (dep.type) {
      case 'import':
        kind = 'import';
        break;
      case 'dynamic-import':
        kind = 'dynamic-import';
        break;
      case 'require':
        kind = 'require';
        break;
      case 'export':
      case 'export-default':
      case 'export-all':
        kind = 'export-from';
        break;
      default:
        kind = 'import';
    }

    // Convert imported/exported names
    const names: CodeDependency['names'] = [];

    if (dep.default) {
      names.push({ name: dep.default, alias: undefined });
    }

    if (dep.namespace) {
      names.push({ name: dep.namespace, alias: undefined });
    }

    if (dep.imported) {
      for (const imp of dep.imported) {
        names.push({
          name: imp.name,
          alias: imp.alias,
        });
      }
    }

    if (dep.exported) {
      for (const exp of dep.exported) {
        names.push({
          name: exp.name,
          alias: exp.alias,
        });
      }
    }

    return {
      id,
      sourceFile,
      targetModule: dep.source || '',
      resolvedPath: undefined,
      kind,
      names,
      line: dep.line || 0,
      isExternal: dep.isExternal,
    };
  });
}

/**
 * Convert call extractor output to storage format
 */
function convertCalls(
  rawCalls: Array<{
    callee: string;
    caller: string | null;
    receiver?: string;
    type: string;
    line?: number;
    column?: number;
    argumentCount: number;
  }>,
  filePath: string,
  relativePath: string
): CallEdge[] {
  return rawCalls.map(call => {
    const callerId = call.caller
      ? `${relativePath}:${call.caller}:function`
      : `${relativePath}:__top_level__:function`;

    const id = `${callerId}->${call.callee}:${call.line || 0}`;

    return {
      id,
      callerId,
      callerFile: filePath,
      calleeName: call.callee,
      calleeId: undefined,
      calleeFile: undefined,
      position: {
        line: call.line || 0,
        column: call.column || 0,
      },
      isMethodCall: call.type === 'method',
      receiver: call.receiver,
      argumentCount: call.argumentCount,
    };
  });
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
