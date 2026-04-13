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
  type Project,
} from '../../storage/project.js';
import { withWorktreeLock } from '../../storage/locks.js';
import { createSpinner } from '../utils/progress.js';
import { getServerUrl, queryServer } from '../../server/client.js';
import type {
  QueryDiffResponse,
  QueryProjectsResponse,
  QueryWorktreesResponse,
} from '../../server/query-server.js';
import {
  resolveHostedScopeForDirectory,
  type HostedScopeMatch,
} from '../utils/hosted-auto-detect.js';
import { formatMissingHostedScopeError } from '../utils/hosted-scope-errors.js';
import {
  writeHostedWorktreeBinding,
  type HostedWorktreeBindingReadResult,
} from '../utils/hosted-worktree-binding.js';
import { getGitContext } from '../utils/git-context.js';

async function persistHostedBindingForWorktree(
  directory: string,
  project: Pick<Project, 'id' | 'name'> | null,
  worktree: Pick<Worktree, 'id' | 'name' | 'branch'>,
): Promise<HostedWorktreeBindingReadResult | null> {
  if (!project) {
    return null;
  }

  try {
    return await writeHostedWorktreeBinding(directory, {
      projectId: project.id,
      projectName: project.name,
      worktreeId: worktree.id,
      worktreeName: worktree.name,
      branch: worktree.branch ?? undefined,
      serverUrl: getServerUrl(),
    });
  } catch (err) {
    if ((err as Error).message.includes('not inside a git repository')) {
      return null;
    }
    throw err;
  }
}

async function resolveProjectForBinding(
  db: Awaited<ReturnType<typeof openConfiguredDatabase>>,
  projectNameOrId?: string,
): Promise<Project | null> {
  if (!projectNameOrId) {
    return null;
  }

  await ensureProjectTables(db);
  return await getProject(db, projectNameOrId);
}

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
      let project: Project | null = null;
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
        project = proj;
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
        chunkMaxTokens: effectiveChunkSize,
        chunkOverlap: effectiveChunkOverlap,
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
          const existingHashes = await contentHashesExist(db, allHashes, embedClient.model, dimensions, {
            chunkMaxTokens: effectiveChunkSize,
            chunkOverlap: effectiveChunkOverlap,
          });

          // Build doc chunks, reusing from shared store when possible
          for (const result of chunkingResults) {
            const docChunks: DocumentChunk[] = [];

            if (existingHashes.has(result.contentHash)) {
              // Reuse from shared store
              const shared = await getSharedChunksByHash(
                db,
                [result.contentHash],
                embedClient.model,
                dimensions,
                {
                  chunkMaxTokens: effectiveChunkSize,
                  chunkOverlap: effectiveChunkOverlap,
                },
              );
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
            await addSharedChunks(db, embedClient.model, dimensions, docChunks, {
              chunkMaxTokens: effectiveChunkSize,
              chunkOverlap: effectiveChunkOverlap,
            });

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
        const finalWorktree = (await getWorktree(db, wt.id))!;
        await persistHostedBindingForWorktree(absolutePath, project, finalWorktree);

        spinner?.succeed(
          `Created worktree "${opts.name}": ${files.length} files, ${totalChunks} chunks (${chunksReused} reused)`,
        );

        return {
          success: true,
          worktree: finalWorktree,
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
      let project: Project | null = null;
      let effectiveExcludes = config.excludes;
      if (opts.project) {
        await ensureProjectTables(db);
        const proj = await getProject(db, opts.project);
        if (!proj) throw new Error(`Project "${opts.project}" not found`);
        project = proj;
        projectId = proj.id;
      }

      // Find parent
      const parent = await getWorktree(db, opts.parent, projectId ? { projectId } : undefined);
      if (!parent) throw new Error(`Parent worktree "${opts.parent}" not found`);
      if (parent.projectId) {
        project = await resolveProjectForBinding(db, parent.projectId);
        if (project?.excludePatterns.length) {
          effectiveExcludes = [...config.excludes, ...project.excludePatterns];
        }
      }

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
          excludes: effectiveExcludes,
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
            maxTokens: parent.chunkMaxTokens,
            overlapTokens: parent.chunkOverlap,
          });

          // Check shared store
          const existsInShared = await contentHashesExist(db, [data.hash], embedClient.model, parent.modelDims, {
            chunkMaxTokens: parent.chunkMaxTokens,
            chunkOverlap: parent.chunkOverlap,
          });
          const docChunks: DocumentChunk[] = [];

          if (existsInShared.has(data.hash)) {
            const shared = await getSharedChunksByHash(
              db,
              [data.hash],
              embedClient.model,
              parent.modelDims,
              {
                chunkMaxTokens: parent.chunkMaxTokens,
                chunkOverlap: parent.chunkOverlap,
              },
            );
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
            await addSharedChunks(db, embedClient.model, parent.modelDims, docChunks, {
              chunkMaxTokens: parent.chunkMaxTokens,
              chunkOverlap: parent.chunkOverlap,
            });
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
        const finalWorktree = (await getWorktree(db, child.id))!;
        await persistHostedBindingForWorktree(absolutePath, project, finalWorktree);

        spinner?.succeed(
          `Forked "${opts.parent}" → "${opts.name}": ${added.length} added, ${modified.length} modified, ${deleted.length} deleted (${chunksReused} chunks reused)`,
        );

        return {
          success: true,
          worktree: finalWorktree,
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
  if (getServerUrl()) {
    const response = await queryServer({
      method: 'worktrees',
      project: opts.project,
      params: {},
    }) as QueryWorktreesResponse;

    return response.worktrees as Worktree[];
  }

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
// worktree resolve / bind
// ---------------------------------------------------------------------------

export interface WorktreeResolveOptions {
  path?: string;
  json?: boolean;
}

export interface WorktreeResolveResult {
  success: boolean;
  project?: string;
  worktree?: string;
  source?: HostedScopeMatch['source'];
  bindingPath?: string;
  repoRoot?: string;
  branch?: string;
  serverUrl?: string | null;
  error?: string;
}

export interface WorktreeBindOptions extends WorktreeResolveOptions {
  project: string;
  worktree: string;
  force?: boolean;
}

export interface WorktreeBindResult extends WorktreeResolveResult {
  bindingPath: string;
}

async function resolveBindableHostedTarget(
  projectName: string,
  worktreeName: string,
): Promise<{
  project: Pick<Project, 'id' | 'name'>;
  worktree: Pick<Worktree, 'id' | 'name' | 'branch'>;
}> {
  if (getServerUrl()) {
    const projects = await queryServer({
      method: 'projects',
      params: {},
    }) as QueryProjectsResponse;
    const project = projects.projects.find((entry) => entry.name === projectName);
    if (!project) {
      throw new Error(`Hosted project "${projectName}" not found.`);
    }

    const worktrees = await queryServer({
      method: 'worktrees',
      project: project.name,
      params: {},
    }) as QueryWorktreesResponse;
    const worktree = worktrees.worktrees.find((entry) => entry.name === worktreeName);
    if (!worktree) {
      throw new Error(`Hosted worktree "${worktreeName}" not found in project "${project.name}".`);
    }

    return {
      project: {
        id: project.id,
        name: project.name,
      },
      worktree: {
        id: worktree.id,
        name: worktree.name,
        branch: worktree.branch,
      },
    };
  }

  const db = await openConfiguredDatabase();
  try {
    await ensureProjectTables(db);
    await ensureWorktreeTables(db);
    const project = await getProject(db, projectName);
    if (!project) {
      throw new Error(`Project "${projectName}" not found.`);
    }

    const worktree = await getWorktree(db, worktreeName, { projectId: project.id });
    if (!worktree) {
      throw new Error(`Worktree "${worktreeName}" not found in project "${project.name}".`);
    }

    return {
      project: {
        id: project.id,
        name: project.name,
      },
      worktree: {
        id: worktree.id,
        name: worktree.name,
        branch: worktree.branch,
      },
    };
  } finally {
    await db.close();
  }
}

export async function runWorktreeResolveCommand(
  opts: WorktreeResolveOptions = {},
): Promise<WorktreeResolveResult> {
  const targetPath = resolve(opts.path ?? process.cwd());
  const git = getGitContext(targetPath);
  const scope = await resolveHostedScopeForDirectory(targetPath);

  if (!scope) {
    return {
      success: false,
      repoRoot: git?.repoRoot,
      branch: git?.branch,
      serverUrl: getServerUrl(),
      error: formatMissingHostedScopeError(targetPath),
    };
  }

  return {
    success: true,
    project: scope.project,
    worktree: scope.worktree,
    source: scope.source,
    bindingPath: scope.bindingPath,
    repoRoot: git?.repoRoot,
    branch: git?.branch,
    serverUrl: getServerUrl(),
  };
}

export async function runWorktreeBindCommand(
  opts: WorktreeBindOptions,
): Promise<WorktreeBindResult> {
  const targetPath = resolve(opts.path ?? process.cwd());
  const git = getGitContext(targetPath);
  if (!git) {
    throw new Error(`"${targetPath}" is not inside a git repository, so lgrep cannot bind it to a hosted worktree.`);
  }

  const target = await resolveBindableHostedTarget(opts.project, opts.worktree);
  if (!opts.force && target.worktree.branch && git.branch && target.worktree.branch !== git.branch) {
    throw new Error(
      `Current git branch "${git.branch}" does not match hosted worktree branch "${target.worktree.branch}". ` +
      'Bind the matching hosted worktree or pass --force if you intentionally want a non-matching binding.'
    );
  }

  const binding = await writeHostedWorktreeBinding(targetPath, {
    projectId: target.project.id,
    projectName: target.project.name,
    worktreeId: target.worktree.id,
    worktreeName: target.worktree.name,
    branch: target.worktree.branch ?? undefined,
    serverUrl: getServerUrl(),
  });

  return {
    success: true,
    project: binding.binding.projectName,
    worktree: binding.binding.worktreeName,
    source: 'binding',
    bindingPath: binding.path,
    repoRoot: binding.git.repoRoot,
    branch: binding.binding.branch,
    serverUrl: getServerUrl(),
  };
}

// ---------------------------------------------------------------------------
// worktree diff
// ---------------------------------------------------------------------------

export async function runWorktreeDiffCommand(
  a: string,
  b: string,
  opts: { json?: boolean } = {},
): Promise<WorktreeDiffEntry[]> {
  if (getServerUrl()) {
    const response = await queryServer({
      method: 'diff',
      params: { a, b },
    }) as QueryDiffResponse;

    return response.diffs;
  }

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
      const worktreeRoot = wt.rootPath;
      const project = wt.projectId ? await resolveProjectForBinding(db, wt.projectId) : null;
      let effectiveExcludes = config.excludes;
      if (project?.excludePatterns.length) {
        effectiveExcludes = [...config.excludes, ...project.excludePatterns];
      }

      const performUpdate = async (): Promise<WorktreeUpdateResult> => {
        spinner?.update('Initializing embedding model...');
        const embedClient = createEmbeddingClient({ model: wt.model });
        const dimensions = await embedClient.getModelDimensions();
        await ensureSharedTables(db, dimensions);
        await ensureSharedCodeIntelTables(db);

        // Walk current files
        spinner?.update('Discovering files...');
        const files = await walkFiles(worktreeRoot, {
          excludes: effectiveExcludes,
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
          await persistHostedBindingForWorktree(worktreeRoot, project, wt);
          spinner?.succeed(`Worktree "${wt.name}" is up to date`);
          return {
            success: true,
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
            chunksCreated: 0,
            chunksReused: 0,
          };
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
            maxTokens: wt.chunkMaxTokens,
            overlapTokens: wt.chunkOverlap,
          });

          const existsInShared = await contentHashesExist(db, [data.hash], embedClient.model, wt.modelDims, {
            chunkMaxTokens: wt.chunkMaxTokens,
            chunkOverlap: wt.chunkOverlap,
          });
          const docChunks: DocumentChunk[] = [];

          if (existsInShared.has(data.hash)) {
            const shared = await getSharedChunksByHash(
              db,
              [data.hash],
              embedClient.model,
              wt.modelDims,
              {
                chunkMaxTokens: wt.chunkMaxTokens,
                chunkOverlap: wt.chunkOverlap,
              },
            );
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
            await addSharedChunks(db, embedClient.model, wt.modelDims, docChunks, {
              chunkMaxTokens: wt.chunkMaxTokens,
              chunkOverlap: wt.chunkOverlap,
            });
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
        await persistHostedBindingForWorktree(worktreeRoot, project, wt);

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
      };

      const pool = db.mode === 'postgres' && db.pool ? db.pool : null;
      return pool
        ? await withWorktreeLock(pool, wt.id, 'update', async () => performUpdate())
        : await performUpdate();
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
