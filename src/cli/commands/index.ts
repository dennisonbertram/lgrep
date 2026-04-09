import { basename, resolve, dirname, join } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { walkFiles, type WalkResult } from '../../core/walker.js';
import { chunkText } from '../../core/chunker.js';
import { createEmbeddingClient } from '../../core/embeddings.js';
import { hashContent } from '../../core/hash.js';
import { loadConfig } from '../../storage/config.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import { ALL_CODE_EXTENSIONS } from '../../core/ast/languages.js';
import {
  createIndex,
  getIndex,
  addChunks,
  addSharedChunks,
  updateIndexStatus,
  getFileContentHashes,
  getFileMetadataHashes,
  createFileMetadataTable,
  upsertFileMetadata,
  deleteFileMetadata,
  deleteChunksByFilePath,
  deleteAllChunks,
  ensureSharedTables,
  contentHashesExist,
  getSharedChunksByHash,
  type DocumentChunk,
} from '../../storage/lance.js';
import {
  openEmbeddingCache,
  getEmbeddings,
  setEmbeddings,
} from '../../storage/cache.js';
import { resolveCacheSettings } from '../../storage/cache-config.js';
import { createSpinner } from '../utils/progress.js';
import { extractSymbols } from '../../core/ast/symbol-extractor.js';
import { extractDependencies } from '../../core/ast/dependency-extractor.js';
import { extractCalls } from '../../core/ast/call-extractor.js';
import {
  addSymbols,
  addDependencies,
  addCalls,
  addSharedSymbols,
  addSharedDependencies,
  addSharedCalls,
  updateSymbolSummary,
  createCodeIntelTables,
  ensureSharedCodeIntelTables,
} from '../../storage/code-intel.js';
import type { CodeSymbol, CodeDependency, CallEdge } from '../../types/code-intel.js';
import { createSummarizerClient } from '../../core/summarizer.js';
import { existsSync } from 'node:fs';

/**
 * Options for the index command.
 */
export interface IndexOptions {
  name?: string;
  showProgress?: boolean;
  mode?: 'create' | 'update';
  json?: boolean;
  summarize?: boolean;     // Default: true
  resummarize?: boolean;   // Default: false
  retry?: boolean;         // Default: false - retry a failed index
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
  symbolsSummarized?: number;
  summarizationSkipped?: boolean;
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
    const db = await openConfiguredDatabase();
    spinner?.update('Opening embedding cache...');
    const cacheSettings = await resolveCacheSettings(config);
    const cache = await openEmbeddingCache(cacheSettings.location, {
      enabled: config.cacheEnabled,
      maxEntries: config.cacheMaxEntries,
      ttlHours: config.cacheTtlHours,
      settings: cacheSettings,
    });

    // Declare handle outside try block so it's accessible in catch for failure marking
    let handle: Awaited<ReturnType<typeof getIndex>> | Awaited<ReturnType<typeof createIndex>> | undefined;

    try {
      // Create embedding client and get dimensions
      spinner?.update('Initializing embedding model...');
      const embedClient = createEmbeddingClient({ model: config.model });
      const dimensions = await embedClient.getModelDimensions();

      // Get or create index based on mode
      let existingHashes: Map<string, string> = new Map();

      if (options.retry) {
        // Retry mode: index must exist and be in failed state
        spinner?.update('Loading failed index for retry...');
        handle = await getIndex(db, indexName);
        if (!handle) {
          throw new Error(`Index "${indexName}" does not exist. Cannot retry non-existent index.`);
        }
        if (handle.metadata.status !== 'failed') {
          throw new Error(`Index "${indexName}" is not in failed state (current: ${handle.metadata.status}). Cannot retry.`);
        }

        // Delete all existing chunks and start fresh
        spinner?.update('Clearing failed index data...');
        await deleteAllChunks(db, handle);

        // Ensure code intelligence tables exist
        await createCodeIntelTables(db, indexName);

        // Update status to building
        await updateIndexStatus(db, handle, 'building');
      } else if (mode === 'update') {
        // Update mode: index must exist
        spinner?.update('Loading existing index...');
        handle = await getIndex(db, indexName);
        if (!handle) {
          throw new Error(`Index "${indexName}" does not exist. Use mode='create' to create a new index.`);
        }

        // Get existing file hashes for incremental comparison
        // Try metadata table first (fast), fall back to chunk scan (slow)
        const metadataHashes = await getFileMetadataHashes(db, handle);

        // If we have metadata, use it; otherwise fall back to chunk scan
        // This handles migration from old indexes that don't have metadata tables
        if (metadataHashes.size > 0) {
          existingHashes = metadataHashes;
        } else {
          // No metadata or empty - fall back to chunk scan (migration path)
          existingHashes = await getFileContentHashes(db, handle);
        }

        // Ensure code intelligence tables exist (for migration from older indexes)
        await createCodeIntelTables(db, indexName);
      } else {
        // Create mode: index must not exist
        spinner?.update('Creating index...');
        handle = await createIndex(db, {
          name: indexName,
          rootPath: absolutePath,
          model: config.model,
          modelDimensions: dimensions,
        });
        // Create file metadata table for hash optimization
        await createFileMetadataTable(db, handle);
        // Create code intelligence tables to avoid race conditions in parallel processing
        await createCodeIntelTables(db, indexName);
      }

      // Ensure shared content-addressable tables exist (Postgres only, no-op for local)
      await ensureSharedTables(db, dimensions);
      await ensureSharedCodeIntelTables(db);

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
      let totalSymbolsSummarized = 0;

      // Build set of current file paths for deletion detection
      const currentFilePaths = new Set(files.map(f => f.absolutePath));

      // Accumulate chunks for batched writes
      const pendingChunks: DocumentChunk[] = [];

      // Track file metadata for batch upsert
      const fileMetadataMap = new Map<string, { hash: string; chunkCount: number }>();

      // Initialize summarizer once if summarization is enabled
      // This avoids creating the client inside the loop
      let summarizer: Awaited<ReturnType<typeof createSummarizerClient>> | null = null;
      let summarizationSkipped = false;
      if (options.summarize !== false) {
        summarizer = createSummarizerClient({
          model: config.summarizationModel,
        });

        // Check if summarizer is available
        const health = await summarizer.healthCheck();
        if (!health.healthy || !health.modelAvailable) {
          if (showProgress && !options.json) {
            console.warn('⚠ Summarization skipped: Ollama not available');
          }
          summarizationSkipped = true;
          summarizer = null;
        }
      }

      // Process files in parallel batches
      let processedFiles = 0;
      const parallelLimit = config.parallelFiles ?? 10;
      const embedBatchSize = config.embedBatchSize ?? 10;
      const dbBatchSize = config.dbBatchSize ?? 250;
      const cacheLookupBatchSize = Math.max(embedBatchSize, dbBatchSize);
      
      // Skip cache for fresh indexes (mode='create') - cache won't have any hits anyway
      const skipCache = mode === 'create' && !options.retry;

      // Process files in batches for parallel execution
      for (let batchStart = 0; batchStart < files.length; batchStart += parallelLimit) {
        const fileBatch = files.slice(batchStart, batchStart + parallelLimit);

        // Phase 1: Read files and compute hashes in parallel
        const fileDataResults = await Promise.all(
          fileBatch.map(async (file) => {
            const content = await readFile(file.absolutePath, 'utf-8');
            const currentHash = hashContent(content);
            const existingHash = existingHashes.get(file.absolutePath);
            return { file, content, currentHash, existingHash };
          })
        );

        // Filter files that need processing and handle updates
        const filesToProcess: Array<{
          file: WalkResult;
          content: string;
          currentHash: string;
        }> = [];

        for (const { file, content, currentHash, existingHash } of fileDataResults) {
          // Check if file has changed
          if (mode === 'update' && existingHash === currentHash) {
            filesSkipped++;
            continue;
          }

          // File is new or changed
          if (mode === 'update' && existingHash) {
            await deleteChunksByFilePath(db, handle, file.absolutePath);
            filesUpdated++;
          } else if (mode === 'update') {
            filesAdded++;
          }

          filesToProcess.push({ file, content, currentHash });
        }

        // Phase 2: Chunk files in parallel
        const chunkingResults = await Promise.all(
          filesToProcess.map(async ({ file, content, currentHash }) => {
            const contentHash = hashContent(content);
            const fileType = file.extension;

            const textChunks = chunkText(content, {
              maxTokens: config.chunkSize,
              overlapTokens: config.chunkOverlap,
            });

            return {
              file,
              content,
              currentHash,
              contentHash,
              fileType,
              textChunks,
            };
          })
        );

        // Phase 2.5: Check shared store for already-embedded content hashes
        const allContentHashes = chunkingResults
          .filter((r) => r != null)
          .map((r) => r.currentHash);
        const existingSharedHashes = await contentHashesExist(
          db,
          allContentHashes,
          embedClient.model,
          dimensions,
          {
            chunkMaxTokens: config.chunkSize,
            chunkOverlap: config.chunkOverlap,
          }
        );

        // Phase 3: Check cache for embeddings and collect uncached chunks
        type UncachedChunk = {
          chunkContent: string;
          fileIndex: number;
          chunkIndex: number;
          textChunk: { index: number; startLine?: number; endLine?: number };
        };

        const cachedDocumentChunks: Map<number, DocumentChunk[]> = new Map();
        const uncachedChunks: UncachedChunk[] = [];
        const cacheCandidates: UncachedChunk[] = [];

        // Initialize doc chunk arrays for each file
        for (let fileIndex = 0; fileIndex < chunkingResults.length; fileIndex++) {
          const result = chunkingResults[fileIndex];
          if (result) {
            cachedDocumentChunks.set(fileIndex, new Array(result.textChunks.length));
          }
        }

        // Collect hashes that need shared store lookup
        const sharedLookupHashes: string[] = [];
        const sharedLookupFileIndexes: number[] = [];
        for (let fileIndex = 0; fileIndex < chunkingResults.length; fileIndex++) {
          const result = chunkingResults[fileIndex];
          if (result && existingSharedHashes.has(result.currentHash)) {
            sharedLookupHashes.push(result.currentHash);
            sharedLookupFileIndexes.push(fileIndex);
          }
        }

        // Fetch shared chunks for files that already exist in the shared store
        const sharedChunksMap = new Map<string, DocumentChunk[]>();
        if (sharedLookupHashes.length > 0) {
          const sharedChunks = await getSharedChunksByHash(
            db,
            sharedLookupHashes,
            embedClient.model,
            dimensions,
            {
              chunkMaxTokens: config.chunkSize,
              chunkOverlap: config.chunkOverlap,
            },
          );
          for (const chunk of sharedChunks) {
            const existing = sharedChunksMap.get(chunk.contentHash) ?? [];
            existing.push(chunk);
            sharedChunksMap.set(chunk.contentHash, existing);
          }
        }

        // Files resolved from shared store are marked so we skip embedding
        const resolvedFromShared = new Set<number>();

        for (let fileIndex = 0; fileIndex < chunkingResults.length; fileIndex++) {
          const result = chunkingResults[fileIndex];
          const docChunks = cachedDocumentChunks.get(fileIndex);
          if (!result || !docChunks) continue;

          // Try to resolve from shared store first
          const sharedForFile = sharedChunksMap.get(result.currentHash);
          if (sharedForFile && sharedForFile.length >= result.textChunks.length) {
            // Build doc chunks from shared store vectors
            for (let chunkIndex = 0; chunkIndex < result.textChunks.length; chunkIndex++) {
              const textChunk = result.textChunks[chunkIndex];
              if (!textChunk) continue;

              const sharedChunk = sharedForFile.find((sc) => sc.chunkIndex === textChunk.index);
              if (sharedChunk) {
                docChunks[chunkIndex] = {
                  id: randomUUID(),
                  filePath: result.file.absolutePath,
                  relativePath: result.file.relativePath,
                  contentHash: result.contentHash,
                  chunkIndex: textChunk.index,
                  content: textChunk.content,
                  vector: sharedChunk.vector,
                  lineStart: textChunk.startLine,
                  lineEnd: textChunk.endLine,
                  fileType: result.fileType,
                  createdAt: new Date().toISOString(),
                };
              }
            }
            resolvedFromShared.add(fileIndex);
            continue;
          }

          for (let chunkIndex = 0; chunkIndex < result.textChunks.length; chunkIndex++) {
            const textChunk = result.textChunks[chunkIndex];
            if (!textChunk) continue;

            const candidate = {
              chunkContent: textChunk.content,
              fileIndex,
              chunkIndex,
              textChunk,
            };

            if (skipCache) {
              uncachedChunks.push(candidate);
              continue;
            }

            cacheCandidates.push(candidate);
          }
        }

        for (let i = 0; i < cacheCandidates.length; i += cacheLookupBatchSize) {
          const lookupBatch = cacheCandidates.slice(i, i + cacheLookupBatchSize);
          const cachedEmbeddings = await getEmbeddings(
            cache,
            embedClient.model,
            lookupBatch.map((candidate) => candidate.chunkContent)
          );

          for (const item of lookupBatch) {
            const cached = cachedEmbeddings.get(item.chunkContent);
            const chunkingResult = chunkingResults[item.fileIndex];
            const docChunks = cachedDocumentChunks.get(item.fileIndex);

            if (cached && chunkingResult && docChunks) {
              docChunks[item.chunkIndex] = {
                id: randomUUID(),
                filePath: chunkingResult.file.absolutePath,
                relativePath: chunkingResult.file.relativePath,
                contentHash: chunkingResult.contentHash,
                chunkIndex: item.textChunk.index,
                content: item.chunkContent,
                vector: cached,
                lineStart: item.textChunk.startLine,
                lineEnd: item.textChunk.endLine,
                fileType: chunkingResult.fileType,
                createdAt: new Date().toISOString(),
              };
            } else {
              uncachedChunks.push(item);
            }
          }
        }

        // Phase 4: Batch embed uncached chunks across all files in this batch
        for (let i = 0; i < uncachedChunks.length; i += embedBatchSize) {
          const embedBatch = uncachedChunks.slice(i, i + embedBatchSize);
          const contents = embedBatch.map((c) => c.chunkContent);

          // Generate embeddings for the batch
          const embedResult = await embedClient.embed(contents);
          const cacheWrites: Array<{ content: string; vector: Float32Array }> = [];

          // Store results and cache
          for (let j = 0; j < embedBatch.length; j++) {
            const item = embedBatch[j];
            if (!item) continue;

            const embedding = embedResult.embeddings[j];
            if (!embedding) {
              throw new Error(`Failed to generate embedding for chunk`);
            }

            const vector = new Float32Array(embedding);
            const chunkingResult = chunkingResults[item.fileIndex];
            if (!chunkingResult) continue;

            cacheWrites.push({
              content: item.chunkContent,
              vector,
            });

            // Store the document chunk
            const docChunks = cachedDocumentChunks.get(item.fileIndex);
            if (docChunks) {
              docChunks[item.chunkIndex] = {
                id: randomUUID(),
                filePath: chunkingResult.file.absolutePath,
                relativePath: chunkingResult.file.relativePath,
                contentHash: chunkingResult.contentHash,
                chunkIndex: item.textChunk.index,
                content: item.chunkContent,
                vector,
                lineStart: item.textChunk.startLine,
                lineEnd: item.textChunk.endLine,
                fileType: chunkingResult.fileType,
                createdAt: new Date().toISOString(),
              };
            }
          }

          await setEmbeddings(cache, embedClient.model, cacheWrites);
        }

        // Phase 5: Collect all chunks from this batch and add to pending
        for (let fileIndex = 0; fileIndex < chunkingResults.length; fileIndex++) {
          const result = chunkingResults[fileIndex];
          if (!result) continue;

          const docChunks = cachedDocumentChunks.get(fileIndex);
          if (!docChunks) continue;

          const validChunks = docChunks.filter((c): c is DocumentChunk => c !== undefined);

          if (validChunks.length > 0) {
            pendingChunks.push(...validChunks);

            fileMetadataMap.set(result.file.absolutePath, {
              hash: result.currentHash,
              chunkCount: validChunks.length,
            });

            // Flush when we reach the batch threshold
            while (pendingChunks.length >= dbBatchSize) {
              const batch = pendingChunks.splice(0, dbBatchSize);
              await addChunks(db, handle, batch);
              // Dual-write to shared content-addressable store
              await addSharedChunks(db, embedClient.model, dimensions, batch, {
                chunkMaxTokens: config.chunkSize,
                chunkOverlap: config.chunkOverlap,
              });
              totalChunks += batch.length;
            }
          }
        }

        // Phase 6: Extract code intelligence in parallel for this batch
        // Return counts from each file to avoid race conditions
        const codeIntelResults = await Promise.all(
          chunkingResults.map(async (result) => {
            const counts = { symbols: 0, deps: 0, calls: 0, summarized: 0 };
            if (!ALL_CODE_EXTENSIONS.includes(result.file.extension)) return counts;

            try {
              // Extract symbols
              const rawSymbols = await extractSymbols(
                result.content,
                result.file.absolutePath,
                result.file.relativePath,
                result.file.extension
              );
              const symbols = convertSymbols(
                rawSymbols,
                result.file.absolutePath,
                result.file.relativePath,
                result.content
              );
              await addSymbols(db, indexName, symbols);
              // Dual-write to shared content-addressable store
              await addSharedSymbols(db, result.currentHash, symbols);
              counts.symbols = symbols.length;

              // Summarize symbols if enabled
              if (summarizer && symbols.length > 0) {
                for (const symbol of symbols) {
                  if (symbol.summary && !options.resummarize) continue;
                  if (symbol.kind === 'import' || symbol.kind === 'export') continue;

                  try {
                    const code = getSymbolCode(result.content, symbol);
                    const summary = await summarizer.summarizeSymbol({
                      name: symbol.name,
                      kind: symbol.kind,
                      signature: symbol.signature,
                      documentation: symbol.documentation,
                      code,
                    });

                    await updateSymbolSummary(
                      db,
                      indexName,
                      symbol.id,
                      summary,
                      config.summarizationModel
                    );

                    counts.summarized++;
                  } catch {
                    // Log but don't fail indexing
                  }
                }
              }

              // Extract dependencies
              const rawDeps = await extractDependencies(result.content, result.file.absolutePath);
              const deps = convertDependencies(rawDeps, result.file.absolutePath);
              await addDependencies(db, indexName, deps);
              // Dual-write to shared content-addressable store
              await addSharedDependencies(db, result.currentHash, deps);
              counts.deps = deps.length;

              // Extract calls
              const rawCalls = await extractCalls(result.content, result.file.absolutePath);
              const calls = convertCalls(rawCalls, result.file.absolutePath, result.file.relativePath);
              await addCalls(db, indexName, calls);
              // Dual-write to shared content-addressable store
              await addSharedCalls(db, result.currentHash, calls);
              counts.calls = calls.length;
            } catch {
              // Gracefully handle code intelligence extraction errors
            }

            return counts;
          })
        );

        // Aggregate counts from parallel extraction
        for (const counts of codeIntelResults) {
          totalSymbols += counts.symbols;
          totalDependencies += counts.deps;
          totalCalls += counts.calls;
          totalSymbolsSummarized += counts.summarized;
        }

        // Update progress for batch
        processedFiles += fileBatch.length;
        spinner?.update(
          `Processing files (${processedFiles}/${files.length})`
        );
      }

      // Flush any remaining chunks after all files are processed
      if (pendingChunks.length > 0) {
        await addChunks(db, handle, pendingChunks);
        // Dual-write to shared content-addressable store
        await addSharedChunks(db, embedClient.model, dimensions, pendingChunks, {
          chunkMaxTokens: config.chunkSize,
          chunkOverlap: config.chunkOverlap,
        });
        totalChunks += pendingChunks.length;
      }

      // Handle deleted files in update mode
      let filesDeleted = 0;
      if (mode === 'update') {
        for (const existingPath of Array.from(existingHashes.keys())) {
          if (!currentFilePaths.has(existingPath)) {
            // File was deleted - remove its chunks and metadata
            await deleteChunksByFilePath(db, handle, existingPath);
            await deleteFileMetadata(db, handle, existingPath);
            filesDeleted++;
          }
        }
      }

      // Upsert file metadata for all processed files
      // Ensure metadata table exists first (for update mode with old indexes)
      try {
        await createFileMetadataTable(db, handle);
      } catch {
        // Table already exists, continue
      }

      // Upsert metadata for all processed files
      for (const [filePath, { hash, chunkCount }] of fileMetadataMap.entries()) {
        await upsertFileMetadata(db, handle, filePath, hash, chunkCount);
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
        symbolsSummarized: totalSymbolsSummarized > 0 ? totalSymbolsSummarized : undefined,
        summarizationSkipped: summarizationSkipped ? true : undefined,
      };
    } catch (err) {
      // Mark index as failed before re-throwing
      if (handle) {
        try {
          await updateIndexStatus(db, handle, 'failed');
        } catch {
          // Ignore errors when marking as failed
        }
      }
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
  relativePath: string,
  content: string
): CodeSymbol[] {
  return rawSymbols.map(sym => {
    const baseSymbol: CodeSymbol = {
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
    };

    const code = getSymbolCode(content, baseSymbol);
    const bodyHash = hashContent(code);

    return {
      ...baseSymbol,
      bodyHash,
    };
  });
}

/**
 * Convert dependency extractor output to storage format
 */
const MODULE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const INDEX_FILE_NAMES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs'];

function resolveModulePath(sourceFile: string, targetModule?: string): string | undefined {
  if (!targetModule) {
    return undefined;
  }

  if (!targetModule.startsWith('.') && !targetModule.startsWith('/')) {
    return undefined;
  }

  const importerDir = dirname(sourceFile);
  const basePath = resolve(importerDir, targetModule);

  const candidates = new Set<string>();
  candidates.add(basePath);
  for (const ext of MODULE_EXTENSIONS) {
    candidates.add(basePath + ext);
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
    for (const indexFile of INDEX_FILE_NAMES) {
      const indexCandidate = join(candidate, indexFile);
      if (existsSync(indexCandidate)) {
        return indexCandidate;
      }
    }
  }

  return undefined;
}

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

    const resolvedPath = resolveModulePath(sourceFile, dep.source);

    return {
      id,
      sourceFile,
      targetModule: dep.source || '',
      resolvedPath,
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
 * Get the code for a symbol from file content.
 */
function getSymbolCode(
  content: string,
  symbol: CodeSymbol
): string {
  const lines = content.split('\n');
  const startLine = symbol.range?.start?.line ?? 0;
  const endLine = symbol.range?.end?.line ?? startLine + 10;

  return lines.slice(startLine, endLine + 1).join('\n');
}
