import type { Pool, PoolClient } from 'pg';
import { quoteIdentifier } from './postgres.js';

const MIGRATIONS_TABLE = 'lgrep_schema_migrations';
const MIGRATION_LOCK_NAMESPACE = 27647;
const MIGRATION_LOCK_KEY = 1;

interface Migration {
  version: number;
  description: string;
  sql: string;
}

/**
 * All schema migrations, ordered by version.
 * Each migration is idempotent (uses IF NOT EXISTS, DO $$ ... EXCEPTION).
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Phase 1: shared content-addressable chunk store',
    sql: `
      CREATE TABLE IF NOT EXISTS "lgrep_shared_chunks" (
        content_hash TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        model TEXT NOT NULL,
        model_dims INTEGER NOT NULL,
        content TEXT NOT NULL,
        vector vector NOT NULL,
        language TEXT,
        line_start INTEGER,
        line_end INTEGER,
        file_type TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (content_hash, chunk_index, model, model_dims)
      );
      CREATE INDEX IF NOT EXISTS "lgrep_shared_chunks_hash_idx"
        ON "lgrep_shared_chunks" (content_hash);

      CREATE TABLE IF NOT EXISTS "lgrep_shared_symbols" (
        id SERIAL,
        content_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        column_start INTEGER NOT NULL,
        column_end INTEGER NOT NULL,
        is_exported INTEGER NOT NULL,
        is_default_export INTEGER NOT NULL,
        documentation TEXT NOT NULL,
        signature TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        modifiers JSONB NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        summary_model TEXT NOT NULL DEFAULT '',
        body_hash TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (content_hash, name, kind, line_start)
      );
      CREATE INDEX IF NOT EXISTS "lgrep_shared_symbols_hash_idx"
        ON "lgrep_shared_symbols" (content_hash);
      CREATE INDEX IF NOT EXISTS "lgrep_shared_symbols_name_idx"
        ON "lgrep_shared_symbols" (LOWER(name));

      CREATE TABLE IF NOT EXISTS "lgrep_shared_dependencies" (
        id SERIAL,
        content_hash TEXT NOT NULL,
        target_module TEXT NOT NULL,
        resolved_path TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        names JSONB NOT NULL DEFAULT '[]',
        line INTEGER NOT NULL,
        is_external INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (content_hash, target_module, line)
      );
      CREATE INDEX IF NOT EXISTS "lgrep_shared_dependencies_hash_idx"
        ON "lgrep_shared_dependencies" (content_hash);

      CREATE TABLE IF NOT EXISTS "lgrep_shared_calls" (
        id SERIAL,
        content_hash TEXT NOT NULL,
        caller_name TEXT NOT NULL DEFAULT '',
        callee_name TEXT NOT NULL,
        callee_file TEXT NOT NULL DEFAULT '',
        line INTEGER NOT NULL,
        "column" INTEGER NOT NULL,
        is_method_call INTEGER NOT NULL,
        receiver TEXT NOT NULL DEFAULT '',
        argument_count INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (content_hash, callee_name, line, "column")
      );
      CREATE INDEX IF NOT EXISTS "lgrep_shared_calls_hash_idx"
        ON "lgrep_shared_calls" (content_hash);
      CREATE INDEX IF NOT EXISTS "lgrep_shared_calls_callee_idx"
        ON "lgrep_shared_calls" (callee_name);
    `,
  },
  {
    version: 2,
    description: 'Phase 2: worktree manifests',
    sql: `
      CREATE TABLE IF NOT EXISTS "lgrep_worktrees" (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        root_path    TEXT,
        repo_url     TEXT,
        branch       TEXT,
        base_commit  TEXT,
        parent_id    TEXT REFERENCES "lgrep_worktrees"(id) ON DELETE SET NULL,
        model        TEXT NOT NULL,
        model_dims   INT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'building',
        file_count   INT NOT NULL DEFAULT 0,
        chunk_count  INT NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "lgrep_worktree_manifests" (
        worktree_id    TEXT NOT NULL REFERENCES "lgrep_worktrees"(id) ON DELETE CASCADE,
        relative_path  TEXT NOT NULL,
        content_hash   TEXT NOT NULL,
        chunk_count    INT NOT NULL DEFAULT 0,
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (worktree_id, relative_path)
      );
      CREATE INDEX IF NOT EXISTS "lgrep_worktree_manifests_hash_idx"
        ON "lgrep_worktree_manifests" (content_hash);
      CREATE INDEX IF NOT EXISTS "lgrep_worktree_manifests_wt_idx"
        ON "lgrep_worktree_manifests" (worktree_id);
    `,
  },
  {
    version: 3,
    description: 'Phase 3: projects and project_id on worktrees',
    sql: `
      CREATE TABLE IF NOT EXISTS "lgrep_projects" (
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
      );

      DO $$ BEGIN
        ALTER TABLE "lgrep_worktrees"
          ADD COLUMN project_id TEXT REFERENCES "lgrep_projects"(id) ON DELETE CASCADE;
      EXCEPTION
        WHEN duplicate_column THEN NULL;
      END $$;

      CREATE INDEX IF NOT EXISTS "idx_worktrees_project"
        ON "lgrep_worktrees" (project_id);
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_worktree_name_per_project"
        ON "lgrep_worktrees" (project_id, name)
        WHERE project_id IS NOT NULL;
    `,
  },
  {
    version: 4,
    description: 'Phase 4: shared chunk vector index bootstrap',
    sql: `
      SELECT 1;
    `,
  },
  {
    version: 5,
    description: 'Phase 5: chunk-aware shared chunks and worktree config bootstrap',
    sql: `
      ALTER TABLE "lgrep_shared_chunks"
        ADD COLUMN IF NOT EXISTS chunk_max_tokens INTEGER NOT NULL DEFAULT 500;
      ALTER TABLE "lgrep_shared_chunks"
        ADD COLUMN IF NOT EXISTS chunk_overlap INTEGER NOT NULL DEFAULT 50;

      DO $$ BEGIN
        IF EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'lgrep_shared_chunks'::regclass
             AND conname = 'lgrep_shared_chunks_pkey'
             AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (content_hash, chunk_index, model, model_dims, chunk_max_tokens, chunk_overlap)'
        ) THEN
          ALTER TABLE "lgrep_shared_chunks" DROP CONSTRAINT "lgrep_shared_chunks_pkey";
        END IF;
      END $$;

      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'lgrep_shared_chunks'::regclass
             AND conname = 'lgrep_shared_chunks_pkey'
        ) THEN
          ALTER TABLE "lgrep_shared_chunks"
            ADD PRIMARY KEY (content_hash, chunk_index, model, model_dims, chunk_max_tokens, chunk_overlap);
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;

      CREATE INDEX IF NOT EXISTS "lgrep_shared_chunks_lookup_idx"
        ON "lgrep_shared_chunks" (content_hash, model, model_dims, chunk_max_tokens, chunk_overlap);

      ALTER TABLE "lgrep_worktrees"
        ADD COLUMN IF NOT EXISTS project_id TEXT;
      ALTER TABLE "lgrep_worktrees"
        ADD COLUMN IF NOT EXISTS chunk_max_tokens INT NOT NULL DEFAULT 500;
      ALTER TABLE "lgrep_worktrees"
        ADD COLUMN IF NOT EXISTS chunk_overlap INT NOT NULL DEFAULT 50;
      ALTER TABLE "lgrep_worktrees"
        DROP CONSTRAINT IF EXISTS "lgrep_worktrees_name_key";

      CREATE UNIQUE INDEX IF NOT EXISTS "uq_worktree_name_legacy"
        ON "lgrep_worktrees" (name)
        WHERE project_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_worktree_name_per_project"
        ON "lgrep_worktrees" (project_id, name)
        WHERE project_id IS NOT NULL;
    `,
  },
  {
    version: 6,
    description: 'Phase 6: dimension-aware shared chunk storage',
    sql: `
      ALTER TABLE "lgrep_shared_chunks"
        ADD COLUMN IF NOT EXISTS model_dims INTEGER;

      UPDATE "lgrep_shared_chunks"
         SET model_dims = vector_dims(vector)
       WHERE model_dims IS NULL OR model_dims = 0;

      ALTER TABLE "lgrep_shared_chunks"
        ALTER COLUMN model_dims SET NOT NULL;

      DO $$ BEGIN
        IF EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'lgrep_shared_chunks'::regclass
             AND conname = 'lgrep_shared_chunks_pkey'
             AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (content_hash, chunk_index, model, model_dims, chunk_max_tokens, chunk_overlap)'
        ) THEN
          ALTER TABLE "lgrep_shared_chunks" DROP CONSTRAINT "lgrep_shared_chunks_pkey";
        END IF;
      END $$;

      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'lgrep_shared_chunks'::regclass
             AND conname = 'lgrep_shared_chunks_pkey'
        ) THEN
          ALTER TABLE "lgrep_shared_chunks"
            ADD PRIMARY KEY (content_hash, chunk_index, model, model_dims, chunk_max_tokens, chunk_overlap);
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;

      DROP INDEX IF EXISTS "lgrep_shared_chunks_vector_idx";

      CREATE INDEX IF NOT EXISTS "lgrep_shared_chunks_lookup_idx"
        ON "lgrep_shared_chunks" (content_hash, model, model_dims, chunk_max_tokens, chunk_overlap);

      DO $$
      DECLARE
        dims_record RECORD;
      BEGIN
        FOR dims_record IN
          SELECT DISTINCT model_dims
            FROM "lgrep_shared_chunks"
           WHERE model_dims IS NOT NULL
        LOOP
          EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON "lgrep_shared_chunks" USING hnsw ((vector::vector(%s)) vector_cosine_ops) WHERE model_dims = %s',
            'lgrep_shared_chunks_vector_' || dims_record.model_dims || '_idx',
            dims_record.model_dims,
            dims_record.model_dims
          );
        END LOOP;
      END $$;
    `,
  },
];

/**
 * Run all pending schema migrations.
 * Idempotent — safe to call on every startup.
 */
export async function ensureSchema(pool: Pool): Promise<{ applied: number }> {
  const client = await pool.connect();
  let lockAcquired = false;
  let applied = 0;
  let failure: Error | null = null;

  try {
    await client.query(
      'SELECT pg_advisory_lock($1, $2)',
      [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_KEY],
    );
    lockAcquired = true;

    await ensureMigrationsTable(client);

    const { rows } = await client.query<{ v: number }>(
      `SELECT COALESCE(MAX(version), 0) AS v FROM ${quoteIdentifier(MIGRATIONS_TABLE)}`,
    );
    const currentVersion = rows[0]?.v ?? 0;

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query(
            `INSERT INTO ${quoteIdentifier(MIGRATIONS_TABLE)} (version, description) VALUES ($1, $2)`,
            [migration.version, migration.description],
          );
          await client.query('COMMIT');
          applied++;
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(
            `Migration v${migration.version} (${migration.description}) failed: ${(err as Error).message}`,
          );
        }
      }
    }
  } catch (err) {
    failure = err as Error;
  } finally {
    try {
      if (lockAcquired) {
        await client.query(
          'SELECT pg_advisory_unlock($1, $2)',
          [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_KEY],
        );
      }
    } catch (err) {
      const unlockError = err as Error;
      if (failure) {
        failure = new Error(
          `${failure.message}; additionally failed to release migration lock: ${unlockError.message}`,
        );
      } else {
        failure = unlockError;
      }
    } finally {
      client.release();
    }
  }

  if (failure) {
    throw failure;
  }

  return { applied };
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(MIGRATIONS_TABLE)} (
      version INT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Get current schema version.
 */
export async function getSchemaVersion(pool: Pool): Promise<number> {
  try {
    const { rows } = await pool.query<{ v: number }>(
      `SELECT COALESCE(MAX(version), 0) AS v FROM ${quoteIdentifier(MIGRATIONS_TABLE)}`,
    );
    return rows[0]?.v ?? 0;
  } catch {
    return 0;
  }
}
