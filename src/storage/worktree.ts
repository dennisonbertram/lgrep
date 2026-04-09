import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { IndexDatabase } from './lance.js';
import { quoteIdentifier, requirePostgresPool } from './postgres.js';

// ---------------------------------------------------------------------------
// Table names
// ---------------------------------------------------------------------------

export const WORKTREES_TABLE = 'lgrep_worktrees';
export const WORKTREE_MANIFESTS_TABLE = 'lgrep_worktree_manifests';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Worktree {
  id: string;
  name: string;
  rootPath: string | null;
  repoUrl: string | null;
  branch: string | null;
  baseCommit: string | null;
  parentId: string | null;
  projectId: string | null;
  model: string;
  modelDims: number;
  chunkMaxTokens: number;
  chunkOverlap: number;
  status: 'building' | 'ready' | 'failed';
  fileCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManifestEntry {
  relativePath: string;
  contentHash: string;
  chunkCount: number;
  updatedAt: string;
}

export interface WorktreeDiffEntry {
  path: string;
  changeType: 'added' | 'deleted' | 'modified';
}

export interface CreateWorktreeOptions {
  name: string;
  rootPath?: string;
  repoUrl?: string;
  branch?: string;
  baseCommit?: string;
  parentId?: string;
  projectId?: string;
  model: string;
  modelDims: number;
  chunkMaxTokens: number;
  chunkOverlap: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function isPostgres(db: IndexDatabase): boolean {
  return db.mode === 'postgres';
}

/**
 * Ensure the worktree tables exist. Must be called once before any
 * worktree read/write operations. Postgres only – no-op for local.
 */
export async function ensureWorktreeTables(db: IndexDatabase): Promise<void> {
  if (!isPostgres(db)) return;

  const pool = requirePostgresPool(db);
  const wt = quoteIdentifier(WORKTREES_TABLE);
  const wm = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${wt} (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      root_path    TEXT,
      repo_url     TEXT,
      branch       TEXT,
      base_commit  TEXT,
      parent_id    TEXT REFERENCES ${wt}(id) ON DELETE SET NULL,
      project_id   TEXT,
      model        TEXT NOT NULL,
      model_dims   INT NOT NULL,
      chunk_max_tokens INT NOT NULL DEFAULT 500,
      chunk_overlap INT NOT NULL DEFAULT 50,
      status       TEXT NOT NULL DEFAULT 'building',
      file_count   INT NOT NULL DEFAULT 0,
      chunk_count  INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE ${wt} ADD COLUMN IF NOT EXISTS project_id TEXT`);
  await pool.query(`ALTER TABLE ${wt} ADD COLUMN IF NOT EXISTS chunk_max_tokens INT NOT NULL DEFAULT 500`);
  await pool.query(`ALTER TABLE ${wt} ADD COLUMN IF NOT EXISTS chunk_overlap INT NOT NULL DEFAULT 50`);
  await pool.query(`ALTER TABLE ${wt} DROP CONSTRAINT IF EXISTS ${quoteIdentifier(`${WORKTREES_TABLE}_name_key`)}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${wm} (
      worktree_id    TEXT NOT NULL REFERENCES ${wt}(id) ON DELETE CASCADE,
      relative_path  TEXT NOT NULL,
      content_hash   TEXT NOT NULL,
      chunk_count    INT NOT NULL DEFAULT 0,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (worktree_id, relative_path)
    )
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${WORKTREE_MANIFESTS_TABLE}_hash_idx`)}
      ON ${wm} (content_hash)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${WORKTREE_MANIFESTS_TABLE}_wt_idx`)}
      ON ${wm} (worktree_id)`
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier('uq_worktree_name_legacy')}
      ON ${wt} (name)
      WHERE project_id IS NULL`
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier('uq_worktree_name_per_project')}
      ON ${wt} (project_id, name)
      WHERE project_id IS NOT NULL`
  );
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

function rowToWorktree(row: Record<string, unknown>): Worktree {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    rootPath: (row['root_path'] as string) ?? null,
    repoUrl: (row['repo_url'] as string) ?? null,
    branch: (row['branch'] as string) ?? null,
    baseCommit: (row['base_commit'] as string) ?? null,
    parentId: (row['parent_id'] as string) ?? null,
    projectId: (row['project_id'] as string) ?? null,
    model: row['model'] as string,
    modelDims: row['model_dims'] as number,
    chunkMaxTokens: row['chunk_max_tokens'] as number,
    chunkOverlap: row['chunk_overlap'] as number,
    status: row['status'] as Worktree['status'],
    fileCount: row['file_count'] as number,
    chunkCount: row['chunk_count'] as number,
    createdAt: normalizeTs(row['created_at']),
    updatedAt: normalizeTs(row['updated_at']),
  };
}

function normalizeTs(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ---------------------------------------------------------------------------
// Worktree operations
// ---------------------------------------------------------------------------

/**
 * Create a new worktree with an empty manifest.
 */
export async function createWorktree(
  db: IndexDatabase,
  opts: CreateWorktreeOptions,
): Promise<Worktree> {
  if (!isPostgres(db)) throw new Error('Worktrees require a Postgres database');

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREES_TABLE);
  const id = randomUUID();
  const now = new Date().toISOString();

  await pool.query(
    `INSERT INTO ${table}
       (id, name, root_path, repo_url, branch, base_commit, parent_id, project_id,
        model, model_dims, chunk_max_tokens, chunk_overlap, status, file_count, chunk_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'building', 0, 0, $13, $13)`,
    [
      id,
      opts.name,
      opts.rootPath ?? null,
      opts.repoUrl ?? null,
      opts.branch ?? null,
      opts.baseCommit ?? null,
      opts.parentId ?? null,
      opts.projectId ?? null,
      opts.model,
      opts.modelDims,
      opts.chunkMaxTokens,
      opts.chunkOverlap,
      now,
    ],
  );

  return {
    id,
    name: opts.name,
    rootPath: opts.rootPath ?? null,
    repoUrl: opts.repoUrl ?? null,
    branch: opts.branch ?? null,
    baseCommit: opts.baseCommit ?? null,
    parentId: opts.parentId ?? null,
    projectId: opts.projectId ?? null,
    model: opts.model,
    modelDims: opts.modelDims,
    chunkMaxTokens: opts.chunkMaxTokens,
    chunkOverlap: opts.chunkOverlap,
    status: 'building',
    fileCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Fork a worktree by copying the parent's manifest.
 * Returns the new worktree (still in 'building' status).
 */
export async function forkWorktree(
  db: IndexDatabase,
  parentId: string,
  opts: Omit<CreateWorktreeOptions, 'model' | 'modelDims' | 'chunkMaxTokens' | 'chunkOverlap'> & {
    model?: string;
    modelDims?: number;
  },
): Promise<Worktree> {
  if (!isPostgres(db)) throw new Error('Worktrees require a Postgres database');

  const parent = await getWorktree(db, parentId);
  if (!parent) throw new Error(`Parent worktree "${parentId}" not found`);

  const pool = requirePostgresPool(db);
  const wt = quoteIdentifier(WORKTREES_TABLE);
  const wm = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  const child = await createWorktree(db, {
    ...opts,
    parentId,
    model: opts.model ?? parent.model,
    modelDims: opts.modelDims ?? parent.modelDims,
    chunkMaxTokens: parent.chunkMaxTokens,
    chunkOverlap: parent.chunkOverlap,
  });

  // Copy parent's manifest
  await pool.query(
    `INSERT INTO ${wm} (worktree_id, relative_path, content_hash, chunk_count, updated_at)
     SELECT $1, relative_path, content_hash, chunk_count, NOW()
     FROM ${wm}
     WHERE worktree_id = $2`,
    [child.id, parentId],
  );

  // Copy parent's file/chunk counts
  await pool.query(
    `UPDATE ${wt}
        SET file_count = (SELECT COUNT(*) FROM ${wm} WHERE worktree_id = $1),
            chunk_count = (SELECT COALESCE(SUM(chunk_count), 0) FROM ${wm} WHERE worktree_id = $1)
      WHERE id = $1`,
    [child.id],
  );

  return (await getWorktree(db, child.id))!;
}

/**
 * Get a worktree by ID or name, optionally scoped to a project.
 */
export async function getWorktree(
  db: IndexDatabase,
  idOrName: string,
  opts?: { projectId?: string },
): Promise<Worktree | null> {
  if (!isPostgres(db)) return null;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREES_TABLE);

  if (opts?.projectId) {
    const result = await pool.query<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE (id = $1 OR name = $1) AND project_id = $2 LIMIT 1`,
      [idOrName, opts.projectId],
    );
    if (result.rows.length === 0) return null;
    return rowToWorktree(result.rows[0]!);
  }

  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = $1 OR name = $1 ORDER BY created_at DESC`,
    [idOrName],
  );

  if (result.rows.length === 0) return null;
  const idMatch = result.rows.find((row) => row['id'] === idOrName);
  if (idMatch) {
    return rowToWorktree(idMatch);
  }
  if (result.rows.length > 1) {
    throw new Error(`Multiple worktrees named "${idOrName}" found. Specify a project or use the worktree ID.`);
  }
  return rowToWorktree(result.rows[0]!);
}

/**
 * List worktrees, optionally filtered by project.
 */
export async function listWorktrees(
  db: IndexDatabase,
  opts?: { projectId?: string },
): Promise<Worktree[]> {
  if (!isPostgres(db)) return [];

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREES_TABLE);

  if (opts?.projectId) {
    const result = await pool.query<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE project_id = $1 ORDER BY created_at DESC`,
      [opts.projectId],
    );
    return result.rows.map(rowToWorktree);
  }

  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${table} ORDER BY created_at DESC`,
  );

  return result.rows.map(rowToWorktree);
}

/**
 * Delete a worktree. Manifest entries are cascade-deleted.
 * Shared chunks remain untouched.
 */
export async function deleteWorktree(
  db: IndexDatabase,
  idOrName: string,
): Promise<boolean> {
  if (!isPostgres(db)) return false;

  const wt = await getWorktree(db, idOrName);
  if (!wt) return false;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREES_TABLE);

  const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [wt.id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Update worktree status.
 */
export async function updateWorktreeStatus(
  db: IndexDatabase,
  id: string,
  status: Worktree['status'],
): Promise<void> {
  if (!isPostgres(db)) return;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREES_TABLE);

  await pool.query(
    `UPDATE ${table} SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id],
  );
}

/**
 * Refresh the cached file_count and chunk_count on a worktree row.
 */
export async function refreshWorktreeCounts(
  db: IndexDatabase,
  id: string,
): Promise<void> {
  if (!isPostgres(db)) return;

  const pool = requirePostgresPool(db);
  const wt = quoteIdentifier(WORKTREES_TABLE);
  const wm = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  await pool.query(
    `UPDATE ${wt}
        SET file_count  = (SELECT COUNT(*)                   FROM ${wm} WHERE worktree_id = $1),
            chunk_count = (SELECT COALESCE(SUM(chunk_count), 0) FROM ${wm} WHERE worktree_id = $1),
            updated_at  = NOW()
      WHERE id = $1`,
    [id],
  );
}

// ---------------------------------------------------------------------------
// Manifest operations
// ---------------------------------------------------------------------------

/**
 * Get the full manifest for a worktree as a Map<relativePath, ManifestEntry>.
 */
export async function getManifest(
  db: IndexDatabase,
  worktreeId: string,
): Promise<Map<string, ManifestEntry>> {
  if (!isPostgres(db)) return new Map();

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  const result = await pool.query<Record<string, unknown>>(
    `SELECT relative_path, content_hash, chunk_count, updated_at::text
       FROM ${table}
      WHERE worktree_id = $1`,
    [worktreeId],
  );

  const map = new Map<string, ManifestEntry>();
  for (const row of result.rows) {
    map.set(row['relative_path'] as string, {
      relativePath: row['relative_path'] as string,
      contentHash: row['content_hash'] as string,
      chunkCount: row['chunk_count'] as number,
      updatedAt: normalizeTs(row['updated_at']),
    });
  }
  return map;
}

/**
 * Batch upsert manifest entries.
 */
export async function upsertManifestEntries(
  db: IndexDatabase,
  worktreeId: string,
  entries: Array<{ relativePath: string; contentHash: string; chunkCount: number }>,
): Promise<void> {
  if (entries.length === 0) return;
  if (!isPostgres(db)) return;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  // Batch in groups of 500 to stay within Postgres parameter limits
  const BATCH = 500;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const values: string[] = [];
    const params: unknown[] = [];

    for (const entry of batch) {
      const base = params.length;
      params.push(worktreeId, entry.relativePath, entry.contentHash, entry.chunkCount);
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, NOW())`,
      );
    }

    await pool.query(
      `INSERT INTO ${table} (worktree_id, relative_path, content_hash, chunk_count, updated_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (worktree_id, relative_path)
       DO UPDATE SET content_hash = EXCLUDED.content_hash,
                     chunk_count  = EXCLUDED.chunk_count,
                     updated_at   = NOW()`,
      params,
    );
  }
}

/**
 * Batch delete manifest entries by relative path.
 */
export async function deleteManifestEntries(
  db: IndexDatabase,
  worktreeId: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  if (!isPostgres(db)) return;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  const params: unknown[] = [worktreeId];
  const placeholders = paths.map((p) => {
    params.push(p);
    return `$${params.length}`;
  });

  await pool.query(
    `DELETE FROM ${table}
      WHERE worktree_id = $1
        AND relative_path IN (${placeholders.join(', ')})`,
    params,
  );
}

/**
 * Diff two worktrees. Returns entries that differ.
 */
export async function diffWorktrees(
  db: IndexDatabase,
  worktreeIdA: string,
  worktreeIdB: string,
): Promise<WorktreeDiffEntry[]> {
  if (!isPostgres(db)) return [];

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  const result = await pool.query<Record<string, unknown>>(
    `SELECT
       COALESCE(a.relative_path, b.relative_path) AS path,
       CASE
         WHEN a.content_hash IS NULL THEN 'added'
         WHEN b.content_hash IS NULL THEN 'deleted'
         ELSE 'modified'
       END AS change_type
     FROM
       (SELECT relative_path, content_hash FROM ${table} WHERE worktree_id = $1) a
     FULL OUTER JOIN
       (SELECT relative_path, content_hash FROM ${table} WHERE worktree_id = $2) b
     ON a.relative_path = b.relative_path
     WHERE a.content_hash IS DISTINCT FROM b.content_hash
     ORDER BY path`,
    [worktreeIdA, worktreeIdB],
  );

  return result.rows.map((row) => ({
    path: row['path'] as string,
    changeType: row['change_type'] as WorktreeDiffEntry['changeType'],
  }));
}

/**
 * Get the set of unique content hashes for a worktree.
 * Used to scope shared-chunk searches.
 */
export async function getContentHashesForWorktree(
  db: IndexDatabase,
  worktreeId: string,
): Promise<Set<string>> {
  if (!isPostgres(db)) return new Set();

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  const result = await pool.query<{ content_hash: string }>(
    `SELECT DISTINCT content_hash FROM ${table} WHERE worktree_id = $1`,
    [worktreeId],
  );

  return new Set(result.rows.map((r) => r.content_hash));
}

/**
 * Garbage-collect orphaned shared chunks not referenced by any manifest.
 * Returns the number of deleted chunk rows.
 */
export async function gcSharedChunks(db: IndexDatabase): Promise<number> {
  if (!isPostgres(db)) return 0;

  const pool = requirePostgresPool(db);
  const sc = quoteIdentifier('lgrep_shared_chunks');
  const wm = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  const result = await pool.query(
    `DELETE FROM ${sc} sc
      WHERE NOT EXISTS (
        SELECT 1 FROM ${wm} wm WHERE wm.content_hash = sc.content_hash
      )`,
  );

  return result.rowCount ?? 0;
}
