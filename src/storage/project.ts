import { randomUUID } from 'node:crypto';
import type { IndexDatabase } from './lance.js';
import { quoteIdentifier, requirePostgresPool } from './postgres.js';
import { WORKTREES_TABLE, WORKTREE_MANIFESTS_TABLE } from './worktree.js';

// ---------------------------------------------------------------------------
// Table name
// ---------------------------------------------------------------------------

export const PROJECTS_TABLE = 'lgrep_projects';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  displayName: string | null;
  repoUrl: string | null;
  model: string;
  modelDims: number;
  chunkMaxTokens: number;
  chunkOverlap: number;
  excludePatterns: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectOptions {
  name: string;
  displayName?: string;
  repoUrl?: string;
  model: string;
  modelDims: number;
  chunkMaxTokens?: number;
  chunkOverlap?: number;
  excludePatterns?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectOptions {
  displayName?: string;
  repoUrl?: string;
  model?: string;
  modelDims?: number;
  chunkMaxTokens?: number;
  chunkOverlap?: number;
  excludePatterns?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProjectStats {
  worktreeCount: number;
  totalFiles: number;
  uniqueFiles: number;
  totalChunks: number;
  uniqueChunks: number;
  storageSavingsPercent: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function isPostgres(db: IndexDatabase): boolean {
  return db.mode === 'postgres';
}

function normalizeTs(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Ensure the projects table exists. Must be called once before any
 * project read/write operations. Postgres only – no-op for local.
 */
export async function ensureProjectTables(db: IndexDatabase): Promise<void> {
  if (!isPostgres(db)) return;

  const pool = requirePostgresPool(db);
  const pt = quoteIdentifier(PROJECTS_TABLE);
  const wt = quoteIdentifier(WORKTREES_TABLE);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${pt} (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL UNIQUE,
      display_name      TEXT,
      repo_url          TEXT,
      model             TEXT NOT NULL,
      model_dims        INT NOT NULL,
      chunk_max_tokens  INT NOT NULL DEFAULT 500,
      chunk_overlap     INT NOT NULL DEFAULT 50,
      exclude_patterns  JSONB NOT NULL DEFAULT '[]',
      metadata          JSONB NOT NULL DEFAULT '{}',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Add project_id column to worktrees if it doesn't exist
  await pool.query(`ALTER TABLE ${wt} ADD COLUMN IF NOT EXISTS project_id TEXT`);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'lgrep_worktrees_project_id_fkey'
           AND conrelid = '${WORKTREES_TABLE}'::regclass
      ) THEN
        ALTER TABLE ${wt}
          ADD CONSTRAINT ${quoteIdentifier('lgrep_worktrees_project_id_fkey')}
          FOREIGN KEY (project_id) REFERENCES ${pt}(id) ON DELETE CASCADE;
      END IF;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdentifier('idx_worktrees_project')}
      ON ${wt} (project_id)`,
  );

  // Per-project unique worktree names — requires dropping the old global unique constraint
  // We use a partial unique index: unique (project_id, name) where project_id IS NOT NULL
  // plus keep the existing name unique for legacy worktrees without projects
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier('uq_worktree_name_per_project')}
      ON ${wt} (project_id, name)
      WHERE project_id IS NOT NULL
  `);
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    displayName: (row['display_name'] as string) ?? null,
    repoUrl: (row['repo_url'] as string) ?? null,
    model: row['model'] as string,
    modelDims: row['model_dims'] as number,
    chunkMaxTokens: row['chunk_max_tokens'] as number,
    chunkOverlap: row['chunk_overlap'] as number,
    excludePatterns: parseJsonArray(row['exclude_patterns']),
    metadata: parseJsonObject(row['metadata']),
    createdAt: normalizeTs(row['created_at']),
    updatedAt: normalizeTs(row['updated_at']),
  };
}

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') {
    try { return JSON.parse(v) as string[]; } catch { return []; }
  }
  return [];
}

function parseJsonObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new project.
 */
export async function createProject(
  db: IndexDatabase,
  opts: CreateProjectOptions,
): Promise<Project> {
  if (!isPostgres(db)) throw new Error('Projects require a Postgres database');

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(PROJECTS_TABLE);
  const id = randomUUID();
  const now = new Date().toISOString();

  await pool.query(
    `INSERT INTO ${table}
       (id, name, display_name, repo_url, model, model_dims,
        chunk_max_tokens, chunk_overlap, exclude_patterns, metadata,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $11)`,
    [
      id,
      opts.name,
      opts.displayName ?? null,
      opts.repoUrl ?? null,
      opts.model,
      opts.modelDims,
      opts.chunkMaxTokens ?? 500,
      opts.chunkOverlap ?? 50,
      JSON.stringify(opts.excludePatterns ?? []),
      JSON.stringify(opts.metadata ?? {}),
      now,
    ],
  );

  return {
    id,
    name: opts.name,
    displayName: opts.displayName ?? null,
    repoUrl: opts.repoUrl ?? null,
    model: opts.model,
    modelDims: opts.modelDims,
    chunkMaxTokens: opts.chunkMaxTokens ?? 500,
    chunkOverlap: opts.chunkOverlap ?? 50,
    excludePatterns: opts.excludePatterns ?? [],
    metadata: opts.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get a project by ID or name.
 */
export async function getProject(
  db: IndexDatabase,
  idOrName: string,
): Promise<Project | null> {
  if (!isPostgres(db)) return null;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(PROJECTS_TABLE);

  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = $1 OR name = $1 LIMIT 1`,
    [idOrName],
  );

  if (result.rows.length === 0) return null;
  return rowToProject(result.rows[0]!);
}

/**
 * List all projects.
 */
export async function listProjects(db: IndexDatabase): Promise<Project[]> {
  if (!isPostgres(db)) return [];

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(PROJECTS_TABLE);

  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${table} ORDER BY created_at DESC`,
  );

  return result.rows.map(rowToProject);
}

/**
 * Update a project's configuration.
 */
export async function updateProject(
  db: IndexDatabase,
  idOrName: string,
  opts: UpdateProjectOptions,
): Promise<Project | null> {
  if (!isPostgres(db)) return null;

  const project = await getProject(db, idOrName);
  if (!project) return null;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(PROJECTS_TABLE);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (opts.displayName !== undefined) {
    params.push(opts.displayName);
    sets.push(`display_name = $${params.length}`);
  }
  if (opts.repoUrl !== undefined) {
    params.push(opts.repoUrl);
    sets.push(`repo_url = $${params.length}`);
  }
  if (opts.model !== undefined) {
    params.push(opts.model);
    sets.push(`model = $${params.length}`);
  }
  if (opts.modelDims !== undefined) {
    params.push(opts.modelDims);
    sets.push(`model_dims = $${params.length}`);
  }
  if (opts.chunkMaxTokens !== undefined) {
    params.push(opts.chunkMaxTokens);
    sets.push(`chunk_max_tokens = $${params.length}`);
  }
  if (opts.chunkOverlap !== undefined) {
    params.push(opts.chunkOverlap);
    sets.push(`chunk_overlap = $${params.length}`);
  }
  if (opts.excludePatterns !== undefined) {
    params.push(JSON.stringify(opts.excludePatterns));
    sets.push(`exclude_patterns = $${params.length}::jsonb`);
  }
  if (opts.metadata !== undefined) {
    params.push(JSON.stringify(opts.metadata));
    sets.push(`metadata = $${params.length}::jsonb`);
  }

  if (sets.length === 0) return project;

  sets.push('updated_at = NOW()');
  params.push(project.id);

  await pool.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params,
  );

  return (await getProject(db, project.id))!;
}

/**
 * Delete a project. Cascade deletes all worktrees and their manifests.
 * Shared chunks remain untouched.
 */
export async function deleteProject(
  db: IndexDatabase,
  idOrName: string,
): Promise<boolean> {
  if (!isPostgres(db)) return false;

  const project = await getProject(db, idOrName);
  if (!project) return false;

  const pool = requirePostgresPool(db);
  const table = quoteIdentifier(PROJECTS_TABLE);

  const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [project.id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get project configuration values suitable for merging with global config.
 */
export function getProjectConfig(project: Project): {
  model: string;
  modelDims: number;
  chunkSize: number;
  chunkOverlap: number;
  excludes: string[];
} {
  return {
    model: project.model,
    modelDims: project.modelDims,
    chunkSize: project.chunkMaxTokens,
    chunkOverlap: project.chunkOverlap,
    excludes: project.excludePatterns,
  };
}

/**
 * Get project-level statistics.
 */
export async function getProjectStats(
  db: IndexDatabase,
  projectId: string,
): Promise<ProjectStats> {
  if (!isPostgres(db)) {
    return { worktreeCount: 0, totalFiles: 0, uniqueFiles: 0, totalChunks: 0, uniqueChunks: 0, storageSavingsPercent: 0 };
  }

  const pool = requirePostgresPool(db);
  const wt = quoteIdentifier(WORKTREES_TABLE);
  const wm = quoteIdentifier(WORKTREE_MANIFESTS_TABLE);

  // Worktree count
  const wtResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ${wt} WHERE project_id = $1`,
    [projectId],
  );
  const worktreeCount = parseInt(wtResult.rows[0]?.count ?? '0', 10);

  // Total files (sum across all worktrees in project)
  const totalFilesResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM ${wm} wm
       JOIN ${wt} w ON wm.worktree_id = w.id
      WHERE w.project_id = $1`,
    [projectId],
  );
  const totalFiles = parseInt(totalFilesResult.rows[0]?.count ?? '0', 10);

  // Unique files (distinct content hashes)
  const uniqueFilesResult = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT wm.content_hash) AS count
       FROM ${wm} wm
       JOIN ${wt} w ON wm.worktree_id = w.id
      WHERE w.project_id = $1`,
    [projectId],
  );
  const uniqueFiles = parseInt(uniqueFilesResult.rows[0]?.count ?? '0', 10);

  // Total chunks (sum of chunk_count across all manifest entries)
  const totalChunksResult = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(wm.chunk_count), 0) AS total
       FROM ${wm} wm
       JOIN ${wt} w ON wm.worktree_id = w.id
      WHERE w.project_id = $1`,
    [projectId],
  );
  const totalChunks = parseInt(totalChunksResult.rows[0]?.total ?? '0', 10);

  // Unique chunks in the shared store for this project's content hashes
  const sc = quoteIdentifier('lgrep_shared_chunks');
  const uniqueChunksResult = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT (sc.content_hash, sc.chunk_index, sc.model, sc.model_dims, sc.chunk_max_tokens, sc.chunk_overlap)) AS count
       FROM ${sc} sc
       JOIN ${wm} wm
         ON wm.content_hash = sc.content_hash
       JOIN ${wt} w
         ON wm.worktree_id = w.id
      WHERE w.project_id = $1
        AND sc.model = w.model
        AND sc.model_dims = w.model_dims
        AND sc.chunk_max_tokens = w.chunk_max_tokens
        AND sc.chunk_overlap = w.chunk_overlap`,
    [projectId],
  );
  const uniqueChunks = parseInt(uniqueChunksResult.rows[0]?.count ?? '0', 10);

  const storageSavingsPercent =
    totalChunks > 0 ? Math.round((1 - uniqueChunks / totalChunks) * 100) : 0;

  return {
    worktreeCount,
    totalFiles,
    uniqueFiles,
    totalChunks,
    uniqueChunks,
    storageSavingsPercent,
  };
}
