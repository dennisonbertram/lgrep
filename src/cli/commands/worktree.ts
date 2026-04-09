import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { walkFiles } from '../../core/walker.js';
import { chunkText } from '../../core/chunker.js';
import { createEmbeddingClient } from '../../core/embeddings.js';
import { hashContent } from '../../core/hash.js';
import { loadConfig } from '../../storage/config.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import {
  ensureSharedTables,
  addSharedChunks,
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
import {
  ensureWorktreeTables,
  createWorktree,
  forkWorktree,
  getWorktree,
  listWorktrees,
  deleteWorktree,
  updateWorktreeStatus,
  refreshWorktreeCounts,
  getManifest,
  upsertManifestEntries,
  deleteManifestEntries,
  diffWorktrees,
  gcSharedChunks,
  type Worktree,
  type WorktreeDiffEntry,
} from '../../storage/worktree.js';
import { ALL_CODE_EXTENSIONS } from '../../core/ast/languages.js';
import { extractSymbols } from '../../core/ast/symbol-extractor.js';
import { extractDependencies } from '../../core/ast/dependency-extractor.js';
import { extractCalls } from '../../core/ast/call-extractor.js';
import {
  ensureSharedCodeIntelTables,
  addSharedSymbols,
  addSharedDependencies,
  addSharedCalls,
} from '../../storage/code-intel.js';
import type { CodeSymbol, CodeDependency, CallEdge } from '../../types/code-intel.js';
import {
  ensureProjectTables,
  getProject,
} from '../../storage/project.js';
import { createSpinner } from '../utils/progress.js';

// ---------------------------------------------------------------------------
// worktree create
// ---------------------------------------------------------------------------

export interface WorktreeCreateOptions {
  name: string;
  path: string;
  branch?: string;
  project?: string;
  json?: boolean;
}

export interface WorktreeCreateResult {
  success: boolean;
  worktree?: Worktree;
  filesProcessed: number;
  chunksCreated: number;
  chunksReused: number;
  error?: string;
}

export async function runWorktreeCreateCommand(
  opts: WorktreeCreateOptions,
): Promise<WorktreeCreateResult> {
  const absolutePath = resolve(opts.path);
  const spinner = opts.json ? null : createSpinner('Initializing...');

  try {
    spinner?.start();

    const config = await loadConfig();
    const db = await openConfiguredDatabase();
    const cacheSettings = await resolveCacheSettings(config);
    const cache = await openEmbeddingCache(cacheSettings.location, {
      enabled: config.cacheEnabled,
      maxEntries: config.cacheMaxEntries,
      ttlHours: config.cacheTtlHours,
      settings: cacheSettings,
    });

    try {
      // Resolve project if specified
      let projectId: string | undefined;
      let effectiveModel = config.model;
      let effectiveChunkSize = config.chunkSize;
      let effectiveChunkOverlap = config.chunkOverlap;
      let effectiveExcludes = config.excludes;

      await ensureWorktreeTables(db);

      if (opts.project) {
        await ensureProjectTables(db);
        const proj = await getProject(db, opts.project);
        if (!proj) throw new Error(`Project "${opts.project}" not found`);
        projectId = proj.id;
        effectiveModel = proj.model;
        effectiveChunkSize = proj.chunkMaxTokens;
        effectiveChunkOverlap = proj.chunkOverlap;
        if (proj.excludePatterns.length > 0) {
          effectiveExcludes = [...config.excludes, ...proj.excludePatterns];
        }
      }

      spinner?.update('Initializing embedding model...');
      const embedClient = createEmbeddingClient({ model: effectiveModel });
      const dimensions = await embedClient.getModelDimensions();

      // Ensure tables exist
      await ensureSharedTables(db, dimensions);
      await ensureSharedCodeIntelTables(db);

      // Create worktree record
      spinner?.update('Creating worktree...');
      const wt = await createWorktree(db, {
        name: opts.name,
        rootPath: absolutePath,
        branch: opts.branch,
        projectId,
        model: embedClient.model,
        modelDims: dimensions,
      });

      try {
        // Walk files
        spinner?.update('Discovering files...');
        const files = await walkFiles(absolutePath, {
          excludes: effectiveExcludes,
          secretExcludes: config.secretExcludes,
          maxFileSize: config.maxFileSize,
        });

        let totalChunks = 0;
        let chunksReused = 0;
        const manifestEntries: Array<{ relativePath: string; contentHash: string; chunkCount: number }> = [];

        const parallelLimit = config.parallelFiles ?? 10;
        const embedBatchSize = config.embedBatchSize ?? 10;
        let processedFiles = 0;

        for (let batchStart = 0; batchStart < files.length; batchStart += parallelLimit) {
          const fileBatch = files.slice(batchStart, batchStart + parallelLimit);

          // Phase 1: Read + hash
          const fileDataResults = await Promise.all(
            fileBatch.map(async (file) => {
              const content = await readFile(file.absolutePath, 'utf-8');
              const contentHash = hashContent(content);
              return { file, content, contentHash };
            }),
          );

          // Phase 2: Chunk
          const chunkingResults = fileDataResults.map(({ file, content, contentHash }) => {
            const textChunks = chunkText(content, {
              maxTokens: effectiveChunkSize,
              overlapTokens: effectiveChunkOverlap,
            });
            return { file, content, contentHash, fileType: file.extension, textChunks };
          });

          // Phase 2.5: Check shared store
          const allHashes = chunkingResults.map((r) => r.contentHash);
          const existingHashes = await contentHashesExist(db, allHashes, embedClient.model);

          // Build doc chunks, reusing from shared store when possible
          for (const result of chunkingResults) {
            const docChunks: DocumentChunk[] = [];

            if (existingHashes.has(result.contentHash)) {
              // Reuse from shared store
              const shared = await getSharedChunksByHash(db, [result.contentHash], embedClient.model);
              for (const tc of result.textChunks) {
                const sc = shared.find((s) => s.chunkIndex === tc.index);
                if (sc) {
                  docChunks.push({
                    id: randomUUID(),
                    filePath: result.file.absolutePath,
                    relativePath: result.file.relativePath,
                    contentHash: result.contentHash,
                    chunkIndex: tc.index,
                    content: tc.content,
                    vector: sc.vector,
                    lineStart: tc.startLine,
                    lineEnd: tc.endLine,
                    fileType: result.fileType,
                    createdAt: new Date().toISOString(),
                  });
                  chunksReused++;
                }
              }

              if (docChunks.length === result.textChunks.length) {
                // All chunks resolved from shared store
                manifestEntries.push({
                  relativePath: result.file.relativePath,
                  contentHash: result.contentHash,
                  chunkCount: docChunks.length,
                });
                totalChunks += docChunks.length;
                continue;
              }
            }

            // Need to embed (either not in shared store or partial hit)
            const toEmbed = result.textChunks.filter(
              (tc) => !docChunks.some((dc) => dc.chunkIndex === tc.index),
            );

            for (let i = 0; i < toEmbed.length; i += embedBatchSize) {
              const batch = toEmbed.slice(i, i + embedBatchSize);
              const contents = batch.map((c) => c.content);

              // Try cache first
              const cached = await getEmbeddings(cache, embedClient.model, contents);
              const uncached: typeof batch = [];
              for (const tc of batch) {
                const vec = cached.get(tc.content);
                if (vec) {
                  docChunks.push({
                    id: randomUUID(),
                    filePath: result.file.absolutePath,
                    relativePath: result.file.relativePath,
                    contentHash: result.contentHash,
                    chunkIndex: tc.index,
                    content: tc.content,
                    vector: vec,
                    lineStart: tc.startLine,
                    lineEnd: tc.endLine,
                    fileType: result.fileType,
                    createdAt: new Date().toISOString(),
                  });
                } else {
                  uncached.push(tc);
                }
              }

              if (uncached.length > 0) {
                const embedResult = await embedClient.embed(uncached.map((c) => c.content));
                const cacheWrites: Array<{ content: string; vector: Float32Array }> = [];

                for (let j = 0; j < uncached.length; j++) {
                  const tc = uncached[j]!;
                  const embedding = embedResult.embeddings[j];
                  if (!embedding) continue;
                  const vector = new Float32Array(embedding);
                  cacheWrites.push({ content: tc.content, vector });
                  docChunks.push({
                    id: randomUUID(),
                    filePath: result.file.absolutePath,
                    relativePath: result.file.relativePath,
                    contentHash: result.contentHash,
                    chunkIndex: tc.index,
                    content: tc.content,
                    vector,
                    lineStart: tc.startLine,
                    lineEnd: tc.endLine,
                    fileType: result.fileType,
                    createdAt: new Date().toISOString(),
                  });
                }
                await setEmbeddings(cache, embedClient.model, cacheWrites);
              }
            }

            // Write to shared store
            await addSharedChunks(db, embedClient.model, docChunks);

            // Extract code intelligence for new content
            if (ALL_CODE_EXTENSIONS.includes(result.file.extension)) {
              try {
                const rawSymbols = await extractSymbols(
                  result.content, result.file.absolutePath,
                  result.file.relativePath, result.file.extension,
                );
                const symbols = convertSymbols(rawSymbols, result.file.absolutePath, result.file.relativePath, result.content);
                await addSharedSymbols(db, result.contentHash, symbols);

                const rawDeps = await extractDependencies(result.content, result.file.absolutePath);
                const deps = convertDeps(rawDeps, result.file.absolutePath);
                await addSharedDependencies(db, result.contentHash, deps);

                const rawCalls = await extractCalls(result.content, result.file.absolutePath);
                const calls = convertCalls(rawCalls, result.file.absolutePath, result.file.relativePath);
                await addSharedCalls(db, result.contentHash, calls);
              } catch {
                // Graceful degradation
              }
            }

            manifestEntries.push({
              relativePath: result.file.relativePath,
              contentHash: result.contentHash,
              chunkCount: docChunks.length,
            });
            totalChunks += docChunks.length;
          }

          processedFiles += fileBatch.length;
          spinner?.update(`Processing files (${processedFiles}/${files.length})`);
        }

        // Write manifest
        spinner?.update('Writing manifest...');
        await upsertManifestEntries(db, wt.id, manifestEntries);
        await refreshWorktreeCounts(db, wt.id);
        await updateWorktreeStatus(db, wt.id, 'ready');

        spinner?.succeed(
          `Created worktree "${opts.name}": ${files.length} files, ${totalChunks} chunks (${chunksReused} reused)`,
        );

        return {
          success: true,
          worktree: (await getWorktree(db, wt.id))!,
          filesProcessed: files.length,
          chunksCreated: totalChunks - chunksReused,
          chunksReused,
        };
      } catch (err) {
        await updateWorktreeStatus(db, wt.id, 'failed');
        throw err;
      }
    } finally {
      await db.close();
      await cache.close();
    }
  } catch (err) {
    spinner?.fail('Worktree creation failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// worktree fork
// ---------------------------------------------------------------------------

export interface WorktreeForkOptions {
  parent: string;
  name: string;
  path: string;
  branch?: string;
  project?: string;
  json?: boolean;
}

export interface WorktreeForkResult {
  success: boolean;
  worktree?: Worktree;
  filesChanged: number;
  filesAdded: number;
  filesDeleted: number;
  chunksCreated: number;
  chunksReused: number;
  error?: string;
}

export async function runWorktreeForkCommand(
  opts: WorktreeForkOptions,
): Promise<WorktreeForkResult> {
  const absolutePath = resolve(opts.path);
  const spinner = opts.json ? null : createSpinner('Initializing...');

  try {
    spinner?.start();

    const config = await loadConfig();
    const db = await openConfiguredDatabase();
    const cacheSettings = await resolveCacheSettings(config);
    const cache = await openEmbeddingCache(cacheSettings.location, {
      enabled: config.cacheEnabled,
      maxEntries: config.cacheMaxEntries,
      ttlHours: config.cacheTtlHours,
      settings: cacheSettings,
    });

    try {
      await ensureWorktreeTables(db);

      // Resolve project scope for parent lookup
      let projectId: string | undefined;
      if (opts.project) {
        await ensureProjectTables(db);
        const proj = await getProject(db, opts.project);
        if (!proj) throw new Error(`Project "${opts.project}" not found`);
        projectId = proj.id;
      }

      // Find parent
      const parent = await getWorktree(db, opts.parent, projectId ? { projectId } : undefined);
      if (!parent) throw new Error(`Parent worktree "${opts.parent}" not found`);

      spinner?.update('Initializing embedding model...');
      const embedClient = createEmbeddingClient({ model: parent.model });
      const dimensions = await embedClient.getModelDimensions();
      await ensureSharedTables(db, dimensions);
      await ensureSharedCodeIntelTables(db);

      // Fork (copies manifest)
      spinner?.update('Forking worktree...');
      const child = await forkWorktree(db, parent.id, {
        name: opts.name,
        rootPath: absolutePath,
        branch: opts.branch,
        projectId: parent.projectId ?? undefined,
      });

      try {
        // Walk new path
        spinner?.update('Discovering files...');
        const files = await walkFiles(absolutePath, {
          excludes: config.excludes,
          secretExcludes: config.secretExcludes,
          maxFileSize: config.maxFileSize,
        });

        // Get current manifest (from parent copy)
        const manifest = await getManifest(db, child.id);

        // Compute hashes for all files in the new path
        spinner?.update('Computing file hashes...');
        const newFileMap = new Map<string, { hash: string; file: typeof files[0]; content: string }>();
        for (const file of files) {
          const content = await readFile(file.absolutePath, 'utf-8');
          const hash = hashContent(content);
          newFileMap.set(file.relativePath, { hash, file, content });
        }

        // Diff against manifest
        const added: string[] = [];
        const modified: string[] = [];
        const deleted: string[] = [];

        for (const [relPath, entry] of manifest) {
          const newFile = newFileMap.get(relPath);
          if (!newFile) {
            deleted.push(relPath);
          } else if (newFile.hash !== entry.contentHash) {
            modified.push(relPath);
          }
        }
        for (const relPath of newFileMap.keys()) {
          if (!manifest.has(relPath)) {
            added.push(relPath);
          }
        }

        spinner?.update(
          `Diff: ${added.length} added, ${modified.length} modified, ${deleted.length} deleted`,
        );

        // Delete removed files from manifest
        if (deleted.length > 0) {
          await deleteManifestEntries(db, child.id, deleted);
        }

        // Process changed and added files
        const toProcess = [...added, ...modified];
        let chunksCreated = 0;
        let chunksReused = 0;
        const manifestUpdates: Array<{ relativePath: string; contentHash: string; chunkCount: number }> = [];

        const embedBatchSize = config.embedBatchSize ?? 10;

        for (const relPath of toProcess) {
          const data = newFileMap.get(relPath);
          if (!data) continue;

          const textChunks = chunkText(data.content, {
            maxTokens: config.chunkSize,
            overlapTokens: config.chunkOverlap,
          });

          // Check shared store
          const existsInShared = await contentHashesExist(db, [data.hash], embedClient.model);
          const docChunks: DocumentChunk[] = [];

          if (existsInShared.has(data.hash)) {
            const shared = await getSharedChunksByHash(db, [data.hash], embedClient.model);
            for (const tc of textChunks) {
              const sc = shared.find((s) => s.chunkIndex === tc.index);
              if (sc) {
                docChunks.push({
                  id: randomUUID(),
                  filePath: data.file.absolutePath,
                  relativePath: data.file.relativePath,
                  contentHash: data.hash,
                  chunkIndex: tc.index,
                  content: tc.content,
                  vector: sc.vector,
                  lineStart: tc.startLine,
                  lineEnd: tc.endLine,
                  fileType: data.file.extension,
                  createdAt: new Date().toISOString(),
                });
                chunksReused++;
              }
            }
          }

          // Embed remaining chunks
          const remaining = textChunks.filter(
            (tc) => !docChunks.some((dc) => dc.chunkIndex === tc.index),
          );

          for (let i = 0; i < remaining.length; i += embedBatchSize) {
            const batch = remaining.slice(i, i + embedBatchSize);
            const contents = batch.map((c) => c.content);

            const cached = await getEmbeddings(cache, embedClient.model, contents);
            const uncached: typeof batch = [];
            for (const tc of batch) {
              const vec = cached.get(tc.content);
              if (vec) {
                docChunks.push({
                  id: randomUUID(),
                  filePath: data.file.absolutePath,
                  relativePath: data.file.relativePath,
                  contentHash: data.hash,
                  chunkIndex: tc.index,
                  content: tc.content,
                  vector: vec,
                  lineStart: tc.startLine,
                  lineEnd: tc.endLine,
                  fileType: data.file.extension,
                  createdAt: new Date().toISOString(),
                });
              } else {
                uncached.push(tc);
              }
            }

            if (uncached.length > 0) {
              const embedResult = await embedClient.embed(uncached.map((c) => c.content));
              const cacheWrites: Array<{ content: string; vector: Float32Array }> = [];

              for (let j = 0; j < uncached.length; j++) {
                const tc = uncached[j]!;
                const embedding = embedResult.embeddings[j];
                if (!embedding) continue;
                const vector = new Float32Array(embedding);
                cacheWrites.push({ content: tc.content, vector });
                docChunks.push({
                  id: randomUUID(),
                  filePath: data.file.absolutePath,
                  relativePath: data.file.relativePath,
                  contentHash: data.hash,
                  chunkIndex: tc.index,
                  content: tc.content,
                  vector,
                  lineStart: tc.startLine,
                  lineEnd: tc.endLine,
                  fileType: data.file.extension,
                  createdAt: new Date().toISOString(),
                });
              }
              await setEmbeddings(cache, embedClient.model, cacheWrites);
              chunksCreated += uncached.length;
            }
          }

          // Write to shared store
          if (docChunks.length > 0) {
            await addSharedChunks(db, embedClient.model, docChunks);
          }

          // Code intelligence for new content
          if (!existsInShared.has(data.hash) && ALL_CODE_EXTENSIONS.includes(data.file.extension)) {
            try {
              const rawSymbols = await extractSymbols(
                data.content, data.file.absolutePath,
                data.file.relativePath, data.file.extension,
              );
              const symbols = convertSymbols(rawSymbols, data.file.absolutePath, data.file.relativePath, data.content);
              await addSharedSymbols(db, data.hash, symbols);

              const rawDeps = await extractDependencies(data.content, data.file.absolutePath);
              const deps = convertDeps(rawDeps, data.file.absolutePath);
              await addSharedDependencies(db, data.hash, deps);

              const rawCalls = await extractCalls(data.content, data.file.absolutePath);
              const calls = convertCalls(rawCalls, data.file.absolutePath, data.file.relativePath);
              await addSharedCalls(db, data.hash, calls);
            } catch {
              // Graceful degradation
            }
          }

          manifestUpdates.push({
            relativePath: relPath,
            contentHash: data.hash,
            chunkCount: docChunks.length,
          });
        }

        // Update manifest
        if (manifestUpdates.length > 0) {
          await upsertManifestEntries(db, child.id, manifestUpdates);
        }

        await refreshWorktreeCounts(db, child.id);
        await updateWorktreeStatus(db, child.id, 'ready');

        spinner?.succeed(
          `Forked "${opts.parent}" → "${opts.name}": ${added.length} added, ${modified.length} modified, ${deleted.length} deleted (${chunksReused} chunks reused)`,
        );

        return {
          success: true,
          worktree: (await getWorktree(db, child.id))!,
          filesChanged: modified.length,
          filesAdded: added.length,
          filesDeleted: deleted.length,
          chunksCreated,
          chunksReused,
        };
      } catch (err) {
        await updateWorktreeStatus(db, child.id, 'failed');
        throw err;
      }
    } finally {
      await db.close();
      await cache.close();
    }
  } catch (err) {
    spinner?.fail('Worktree fork failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// worktree list
// ---------------------------------------------------------------------------

export async function runWorktreeListCommand(
  opts: { project?: string; json?: boolean } = {},
): Promise<Worktree[]> {
  const db = await openConfiguredDatabase();
  try {
    await ensureWorktreeTables(db);

    let projectId: string | undefined;
    if (opts.project) {
      await ensureProjectTables(db);
      const proj = await getProject(db, opts.project);
      if (!proj) throw new Error(`Project "${opts.project}" not found`);
      projectId = proj.id;
    }

    return await listWorktrees(db, projectId ? { projectId } : undefined);
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// worktree diff
// ---------------------------------------------------------------------------

export async function runWorktreeDiffCommand(
  a: string,
  b: string,
  opts: { json?: boolean } = {},
): Promise<WorktreeDiffEntry[]> {
  const db = await openConfiguredDatabase();
  try {
    await ensureWorktreeTables(db);

    const wtA = await getWorktree(db, a);
    if (!wtA) throw new Error(`Worktree "${a}" not found`);
    const wtB = await getWorktree(db, b);
    if (!wtB) throw new Error(`Worktree "${b}" not found`);

    return await diffWorktrees(db, wtA.id, wtB.id);
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// worktree delete
// ---------------------------------------------------------------------------

export async function runWorktreeDeleteCommand(
  name: string,
  opts: { json?: boolean } = {},
): Promise<boolean> {
  const db = await openConfiguredDatabase();
  try {
    await ensureWorktreeTables(db);
    return await deleteWorktree(db, name);
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// worktree update (incremental)
// ---------------------------------------------------------------------------

export interface WorktreeUpdateResult {
  success: boolean;
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  chunksCreated: number;
  chunksReused: number;
}

export async function runWorktreeUpdateCommand(
  nameOrId: string,
  opts: { json?: boolean } = {},
): Promise<WorktreeUpdateResult> {
  const spinner = opts.json ? null : createSpinner('Initializing...');

  try {
    spinner?.start();

    const config = await loadConfig();
    const db = await openConfiguredDatabase();
    const cacheSettings = await resolveCacheSettings(config);
    const cache = await openEmbeddingCache(cacheSettings.location, {
      enabled: config.cacheEnabled,
      maxEntries: config.cacheMaxEntries,
      ttlHours: config.cacheTtlHours,
      settings: cacheSettings,
    });

    try {
      await ensureWorktreeTables(db);

      const wt = await getWorktree(db, nameOrId);
      if (!wt) throw new Error(`Worktree "${nameOrId}" not found`);
      if (!wt.rootPath) throw new Error(`Worktree "${nameOrId}" has no root path`);

      spinner?.update('Initializing embedding model...');
      const embedClient = createEmbeddingClient({ model: wt.model });
      const dimensions = await embedClient.getModelDimensions();
      await ensureSharedTables(db, dimensions);
      await ensureSharedCodeIntelTables(db);

      // Walk current files
      spinner?.update('Discovering files...');
      const files = await walkFiles(wt.rootPath, {
        excludes: config.excludes,
        secretExcludes: config.secretExcludes,
        maxFileSize: config.maxFileSize,
      });

      // Get existing manifest
      const manifest = await getManifest(db, wt.id);

      // Compute hashes
      spinner?.update('Computing file hashes...');
      const newMap = new Map<string, { hash: string; file: typeof files[0]; content: string }>();
      for (const file of files) {
        const content = await readFile(file.absolutePath, 'utf-8');
        newMap.set(file.relativePath, { hash: hashContent(content), file, content });
      }

      // Diff
      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];

      for (const [relPath, entry] of manifest) {
        const n = newMap.get(relPath);
        if (!n) deleted.push(relPath);
        else if (n.hash !== entry.contentHash) modified.push(relPath);
      }
      for (const relPath of newMap.keys()) {
        if (!manifest.has(relPath)) added.push(relPath);
      }

      if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
        spinner?.succeed(`Worktree "${wt.name}" is up to date`);
        return { success: true, filesAdded: 0, filesModified: 0, filesDeleted: 0, chunksCreated: 0, chunksReused: 0 };
      }

      spinner?.update(
        `${added.length} added, ${modified.length} modified, ${deleted.length} deleted`,
      );

      if (deleted.length > 0) {
        await deleteManifestEntries(db, wt.id, deleted);
      }

      const toProcess = [...added, ...modified];
      let chunksCreated = 0;
      let chunksReused = 0;
      const manifestUpdates: Array<{ relativePath: string; contentHash: string; chunkCount: number }> = [];
      const embedBatchSize = config.embedBatchSize ?? 10;

      for (const relPath of toProcess) {
        const data = newMap.get(relPath);
        if (!data) continue;

        const textChunks = chunkText(data.content, {
          maxTokens: config.chunkSize,
          overlapTokens: config.chunkOverlap,
        });

        const existsInShared = await contentHashesExist(db, [data.hash], embedClient.model);
        const docChunks: DocumentChunk[] = [];

        if (existsInShared.has(data.hash)) {
          const shared = await getSharedChunksByHash(db, [data.hash], embedClient.model);
          for (const tc of textChunks) {
            const sc = shared.find((s) => s.chunkIndex === tc.index);
            if (sc) {
              docChunks.push({
                id: randomUUID(),
                filePath: data.file.absolutePath,
                relativePath: data.file.relativePath,
                contentHash: data.hash,
                chunkIndex: tc.index,
                content: tc.content,
                vector: sc.vector,
                lineStart: tc.startLine,
                lineEnd: tc.endLine,
                fileType: data.file.extension,
                createdAt: new Date().toISOString(),
              });
              chunksReused++;
            }
          }
        }

        // Embed remaining
        const remaining = textChunks.filter(
          (tc) => !docChunks.some((dc) => dc.chunkIndex === tc.index),
        );
        for (let i = 0; i < remaining.length; i += embedBatchSize) {
          const batch = remaining.slice(i, i + embedBatchSize);
          const cached = await getEmbeddings(cache, embedClient.model, batch.map((c) => c.content));
          const uncached: typeof batch = [];
          for (const tc of batch) {
            const vec = cached.get(tc.content);
            if (vec) {
              docChunks.push({
                id: randomUUID(),
                filePath: data.file.absolutePath,
                relativePath: data.file.relativePath,
                contentHash: data.hash,
                chunkIndex: tc.index,
                content: tc.content,
                vector: vec,
                lineStart: tc.startLine,
                lineEnd: tc.endLine,
                fileType: data.file.extension,
                createdAt: new Date().toISOString(),
              });
            } else {
              uncached.push(tc);
            }
          }
          if (uncached.length > 0) {
            const embedResult = await embedClient.embed(uncached.map((c) => c.content));
            const cacheWrites: Array<{ content: string; vector: Float32Array }> = [];
            for (let j = 0; j < uncached.length; j++) {
              const tc = uncached[j]!;
              const embedding = embedResult.embeddings[j];
              if (!embedding) continue;
              const vector = new Float32Array(embedding);
              cacheWrites.push({ content: tc.content, vector });
              docChunks.push({
                id: randomUUID(),
                filePath: data.file.absolutePath,
                relativePath: data.file.relativePath,
                contentHash: data.hash,
                chunkIndex: tc.index,
                content: tc.content,
                vector,
                lineStart: tc.startLine,
                lineEnd: tc.endLine,
                fileType: data.file.extension,
                createdAt: new Date().toISOString(),
              });
            }
            await setEmbeddings(cache, embedClient.model, cacheWrites);
            chunksCreated += uncached.length;
          }
        }

        if (docChunks.length > 0) {
          await addSharedChunks(db, embedClient.model, docChunks);
        }

        if (!existsInShared.has(data.hash) && ALL_CODE_EXTENSIONS.includes(data.file.extension)) {
          try {
            const rawSymbols = await extractSymbols(
              data.content, data.file.absolutePath,
              data.file.relativePath, data.file.extension,
            );
            const symbols = convertSymbols(rawSymbols, data.file.absolutePath, data.file.relativePath, data.content);
            await addSharedSymbols(db, data.hash, symbols);

            const rawDeps = await extractDependencies(data.content, data.file.absolutePath);
            const deps = convertDeps(rawDeps, data.file.absolutePath);
            await addSharedDependencies(db, data.hash, deps);

            const rawCalls = await extractCalls(data.content, data.file.absolutePath);
            const calls = convertCalls(rawCalls, data.file.absolutePath, data.file.relativePath);
            await addSharedCalls(db, data.hash, calls);
          } catch { /* graceful */ }
        }

        manifestUpdates.push({
          relativePath: relPath,
          contentHash: data.hash,
          chunkCount: docChunks.length,
        });
      }

      if (manifestUpdates.length > 0) {
        await upsertManifestEntries(db, wt.id, manifestUpdates);
      }
      await refreshWorktreeCounts(db, wt.id);

      spinner?.succeed(
        `Updated "${wt.name}": ${added.length} added, ${modified.length} modified, ${deleted.length} deleted`,
      );

      return {
        success: true,
        filesAdded: added.length,
        filesModified: modified.length,
        filesDeleted: deleted.length,
        chunksCreated,
        chunksReused,
      };
    } finally {
      await db.close();
      await cache.close();
    }
  } catch (err) {
    spinner?.fail('Worktree update failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// worktree gc
// ---------------------------------------------------------------------------

export async function runWorktreeGcCommand(
  opts: { json?: boolean } = {},
): Promise<number> {
  const db = await openConfiguredDatabase();
  try {
    await ensureWorktreeTables(db);
    return await gcSharedChunks(db);
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// Code-intel conversion helpers (shared with index.ts)
// ---------------------------------------------------------------------------

function convertSymbols(
  rawSymbols: Array<{
    id: string; name: string; kind: string;
    filePath: string; relativePath: string;
    lineStart: number; lineEnd: number;
    columnStart: number; columnEnd: number;
    isExported: boolean; isDefaultExport: boolean;
    signature?: string; documentation?: string;
    parentId?: string; modifiers: string[];
  }>,
  filePath: string,
  relativePath: string,
  content: string,
): CodeSymbol[] {
  return rawSymbols.map((sym) => {
    const base: CodeSymbol = {
      id: sym.id,
      name: sym.name,
      kind: sym.kind as CodeSymbol['kind'],
      filePath,
      relativePath,
      range: {
        start: { line: sym.lineStart, column: sym.columnStart },
        end: { line: sym.lineEnd, column: sym.columnEnd },
      },
      isExported: sym.isExported,
      isDefaultExport: sym.isDefaultExport,
      signature: sym.signature,
      documentation: sym.documentation,
      parentId: sym.parentId,
      modifiers: sym.modifiers,
    };
    const lines = content.split('\n');
    const code = lines.slice(sym.lineStart, sym.lineEnd + 1).join('\n');
    return { ...base, bodyHash: hashContent(code) };
  });
}

function convertDeps(
  rawDeps: Array<{
    type: string; source?: string; isExternal: boolean;
    line?: number; column?: number;
    imported?: Array<{ name: string; alias?: string; isType?: boolean }>;
    default?: string; namespace?: string;
    exported?: Array<{ name: string; alias?: string }>;
  }>,
  sourceFile: string,
): CodeDependency[] {
  return rawDeps.map((dep, index) => {
    let kind: CodeDependency['kind'];
    switch (dep.type) {
      case 'import': kind = 'import'; break;
      case 'dynamic-import': kind = 'dynamic-import'; break;
      case 'require': kind = 'require'; break;
      default: kind = 'export-from'; break;
    }
    const names: CodeDependency['names'] = [];
    if (dep.default) names.push({ name: dep.default, alias: undefined });
    if (dep.namespace) names.push({ name: dep.namespace, alias: undefined });
    if (dep.imported) for (const imp of dep.imported) names.push({ name: imp.name, alias: imp.alias });
    if (dep.exported) for (const exp of dep.exported) names.push({ name: exp.name, alias: exp.alias });

    return {
      id: `${sourceFile}:${dep.source || 'export'}:${dep.line || index}`,
      sourceFile,
      targetModule: dep.source || '',
      kind,
      names,
      line: dep.line || 0,
      isExternal: dep.isExternal,
    };
  });
}

function convertCalls(
  rawCalls: Array<{
    callee: string; caller: string | null; receiver?: string;
    type: string; line?: number; column?: number; argumentCount: number;
  }>,
  filePath: string,
  relativePath: string,
): CallEdge[] {
  return rawCalls.map((call) => {
    const callerId = call.caller
      ? `${relativePath}:${call.caller}:function`
      : `${relativePath}:__top_level__:function`;
    return {
      id: `${callerId}->${call.callee}:${call.line || 0}`,
      callerId,
      callerFile: filePath,
      calleeName: call.callee,
      calleeId: undefined,
      calleeFile: undefined,
      position: { line: call.line || 0, column: call.column || 0 },
      isMethodCall: call.type === 'method',
      receiver: call.receiver,
      argumentCount: call.argumentCount,
    };
  });
}
