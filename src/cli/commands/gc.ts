import { openConfiguredDatabase } from '../../storage/database-config.js';
import { requirePostgresPool, quoteIdentifier } from '../../storage/postgres.js';
import { ensureWorktreeTables, listWorktrees, deleteWorktree } from '../../storage/worktree.js';
import { ensureProjectTables, getProject } from '../../storage/project.js';
import { createSpinner } from '../utils/progress.js';

export interface GcResult {
  success: boolean;
  chunksDeleted: number;
  symbolsDeleted: number;
  dependenciesDeleted: number;
  callsDeleted: number;
  staleWorktreesDeleted: number;
  dryRun: boolean;
}

export interface GcOptions {
  dryRun?: boolean;
  staleDays?: number;
  project?: string;
  json?: boolean;
}

/**
 * Garbage-collect orphaned shared data and optionally stale worktrees.
 */
export async function runGcCommand(opts: GcOptions = {}): Promise<GcResult> {
  const spinner = opts.json ? null : createSpinner('Running garbage collection...');

  try {
    spinner?.start();

    const db = await openConfiguredDatabase();

    if (db.mode !== 'postgres') {
      spinner?.fail('GC requires Postgres storage mode');
      return {
        success: false, chunksDeleted: 0, symbolsDeleted: 0,
        dependenciesDeleted: 0, callsDeleted: 0, staleWorktreesDeleted: 0,
        dryRun: opts.dryRun ?? false,
      };
    }

    try {
      const pool = requirePostgresPool(db);
      await ensureWorktreeTables(db);

      const sc = quoteIdentifier('lgrep_shared_chunks');
      const ss = quoteIdentifier('lgrep_shared_symbols');
      const sd = quoteIdentifier('lgrep_shared_dependencies');
      const scalls = quoteIdentifier('lgrep_shared_calls');
      const wm = quoteIdentifier('lgrep_worktree_manifests');

      let chunksDeleted = 0;
      let symbolsDeleted = 0;
      let dependenciesDeleted = 0;
      let callsDeleted = 0;
      let staleWorktreesDeleted = 0;

      // 1. Orphaned shared chunks
      spinner?.update('Scanning orphaned chunks...');
      if (opts.dryRun) {
        const result = await pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${sc} sc
           WHERE NOT EXISTS (SELECT 1 FROM ${wm} wm WHERE wm.content_hash = sc.content_hash)`,
        );
        chunksDeleted = parseInt(result.rows[0]?.count ?? '0', 10);
      } else {
        // Batch delete to avoid long locks
        let batch = 1;
        while (batch > 0) {
          const result = await pool.query(
            `WITH orphaned AS (
               SELECT content_hash, chunk_index, model FROM ${sc} sc
               WHERE NOT EXISTS (SELECT 1 FROM ${wm} wm WHERE wm.content_hash = sc.content_hash)
               LIMIT 10000
             )
             DELETE FROM ${sc}
             WHERE (content_hash, chunk_index, model) IN (SELECT * FROM orphaned)`,
          );
          batch = result.rowCount ?? 0;
          chunksDeleted += batch;
        }
      }

      // 2. Orphaned symbols
      spinner?.update('Scanning orphaned symbols...');
      if (opts.dryRun) {
        const result = await pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${ss} s
           WHERE NOT EXISTS (SELECT 1 FROM ${wm} wm WHERE wm.content_hash = s.content_hash)`,
        );
        symbolsDeleted = parseInt(result.rows[0]?.count ?? '0', 10);
      } else {
        const result = await pool.query(
          `DELETE FROM ${ss} s
           WHERE NOT EXISTS (SELECT 1 FROM ${wm} wm WHERE wm.content_hash = s.content_hash)`,
        );
        symbolsDeleted = result.rowCount ?? 0;
      }

      // 3. Orphaned dependencies
      spinner?.update('Scanning orphaned dependencies...');
      if (opts.dryRun) {
        const result = await pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${sd} d
           WHERE NOT EXISTS (SELECT 1 FROM ${wm} wm WHERE wm.content_hash = d.content_hash)`,
        );
        dependenciesDeleted = parseInt(result.rows[0]?.count ?? '0', 10);
      } else {
        const result = await pool.query(
          `DELETE FROM ${sd} d
           WHERE NOT EXISTS (SELECT 1 FROM ${wm} wm WHERE wm.content_hash = d.content_hash)`,
        );
        dependenciesDeleted = result.rowCount ?? 0;
      }

      // 4. Orphaned calls
      spinner?.update('Scanning orphaned calls...');
      if (opts.dryRun) {
        const result = await pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${scalls} c
           WHERE NOT EXISTS (SELECT 1 FROM ${wm} wm WHERE wm.content_hash = c.content_hash)`,
        );
        callsDeleted = parseInt(result.rows[0]?.count ?? '0', 10);
      } else {
        const result = await pool.query(
          `DELETE FROM ${scalls} c
           WHERE NOT EXISTS (SELECT 1 FROM ${wm} wm WHERE wm.content_hash = c.content_hash)`,
        );
        callsDeleted = result.rowCount ?? 0;
      }

      // 5. Stale worktrees
      if (opts.staleDays != null && opts.staleDays > 0) {
        spinner?.update(`Scanning worktrees stale for ${opts.staleDays}+ days...`);

        let projectId: string | undefined;
        if (opts.project) {
          await ensureProjectTables(db);
          const proj = await getProject(db, opts.project);
          if (proj) projectId = proj.id;
        }

        const wt = quoteIdentifier('lgrep_worktrees');
        const params: unknown[] = [opts.staleDays];
        let projectClause = '';
        if (projectId) {
          params.push(projectId);
          projectClause = ` AND project_id = $${params.length}`;
        }

        const staleResult = await pool.query<{ id: string; name: string }>(
          `SELECT id, name FROM ${wt}
           WHERE updated_at < NOW() - ($1 || ' days')::interval
             AND status != 'building'${projectClause}`,
          params,
        );

        if (!opts.dryRun) {
          for (const row of staleResult.rows) {
            await deleteWorktree(db, row.id);
            staleWorktreesDeleted++;
          }
        } else {
          staleWorktreesDeleted = staleResult.rows.length;
        }
      }

      const total = chunksDeleted + symbolsDeleted + dependenciesDeleted + callsDeleted;
      const prefix = opts.dryRun ? 'Would delete' : 'Deleted';

      if (total === 0 && staleWorktreesDeleted === 0) {
        spinner?.succeed('No orphaned data found.');
      } else {
        const parts: string[] = [];
        if (chunksDeleted > 0) parts.push(`${chunksDeleted} chunks`);
        if (symbolsDeleted > 0) parts.push(`${symbolsDeleted} symbols`);
        if (dependenciesDeleted > 0) parts.push(`${dependenciesDeleted} dependencies`);
        if (callsDeleted > 0) parts.push(`${callsDeleted} calls`);
        if (staleWorktreesDeleted > 0) parts.push(`${staleWorktreesDeleted} stale worktrees`);
        spinner?.succeed(`${prefix}: ${parts.join(', ')}`);
      }

      return {
        success: true,
        chunksDeleted,
        symbolsDeleted,
        dependenciesDeleted,
        callsDeleted,
        staleWorktreesDeleted,
        dryRun: opts.dryRun ?? false,
      };
    } finally {
      await db.close();
    }
  } catch (err) {
    spinner?.fail('GC failed');
    throw err;
  }
}
