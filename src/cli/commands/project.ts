import { createEmbeddingClient } from '../../core/embeddings.js';
import { loadConfig } from '../../storage/config.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import {
  ensureProjectTables,
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  getProjectStats,
  type Project,
  type ProjectStats,
} from '../../storage/project.js';
import { ensureWorktreeTables, listWorktrees } from '../../storage/worktree.js';
import { createSpinner } from '../utils/progress.js';

// ---------------------------------------------------------------------------
// project create
// ---------------------------------------------------------------------------

export interface ProjectCreateOptions {
  name: string;
  model?: string;
  repo?: string;
  displayName?: string;
  json?: boolean;
}

export async function runProjectCreateCommand(
  opts: ProjectCreateOptions,
): Promise<Project> {
  const spinner = opts.json ? null : createSpinner('Creating project...');

  try {
    spinner?.start();

    const config = await loadConfig();
    const model = opts.model ?? config.model;

    spinner?.update('Resolving embedding model dimensions...');
    const embedClient = createEmbeddingClient({ model });
    const dims = await embedClient.getModelDimensions();

    const db = await openConfiguredDatabase();
    try {
      await ensureProjectTables(db);
      await ensureWorktreeTables(db);

      const project = await createProject(db, {
        name: opts.name,
        displayName: opts.displayName,
        repoUrl: opts.repo,
        model: embedClient.model,
        modelDims: dims,
        chunkMaxTokens: config.chunkSize,
        chunkOverlap: config.chunkOverlap,
      });

      spinner?.succeed(`Created project "${project.name}" (model: ${project.model})`);
      return project;
    } finally {
      await db.close();
    }
  } catch (err) {
    spinner?.fail('Project creation failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// project list
// ---------------------------------------------------------------------------

export async function runProjectListCommand(
  opts: { json?: boolean } = {},
): Promise<Project[]> {
  const db = await openConfiguredDatabase();
  try {
    await ensureProjectTables(db);
    return await listProjects(db);
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// project info
// ---------------------------------------------------------------------------

export interface ProjectInfoResult {
  project: Project;
  stats: ProjectStats;
  worktrees: Array<{ name: string; status: string; branch: string | null; fileCount: number; chunkCount: number }>;
}

export async function runProjectInfoCommand(
  nameOrId: string,
  opts: { json?: boolean } = {},
): Promise<ProjectInfoResult> {
  const db = await openConfiguredDatabase();
  try {
    await ensureProjectTables(db);
    await ensureWorktreeTables(db);

    const project = await getProject(db, nameOrId);
    if (!project) throw new Error(`Project "${nameOrId}" not found`);

    const stats = await getProjectStats(db, project.id);
    const wts = await listWorktrees(db, { projectId: project.id });

    return {
      project,
      stats,
      worktrees: wts.map((w) => ({
        name: w.name,
        status: w.status,
        branch: w.branch,
        fileCount: w.fileCount,
        chunkCount: w.chunkCount,
      })),
    };
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// project config set
// ---------------------------------------------------------------------------

export async function runProjectConfigSetCommand(
  nameOrId: string,
  key: string,
  value: string,
  opts: { json?: boolean } = {},
): Promise<Project | null> {
  const db = await openConfiguredDatabase();
  try {
    await ensureProjectTables(db);

    const updates: Record<string, unknown> = {};

    switch (key) {
      case 'model':
        updates.model = value;
        // Re-resolve dimensions
        const embedClient = createEmbeddingClient({ model: value });
        updates.modelDims = await embedClient.getModelDimensions();
        break;
      case 'chunkMaxTokens':
      case 'chunk_max_tokens':
        updates.chunkMaxTokens = parseInt(value, 10);
        break;
      case 'chunkOverlap':
      case 'chunk_overlap':
        updates.chunkOverlap = parseInt(value, 10);
        break;
      case 'repo':
      case 'repo_url':
        updates.repoUrl = value;
        break;
      case 'displayName':
      case 'display_name':
        updates.displayName = value;
        break;
      case 'excludePatterns':
      case 'exclude_patterns':
        updates.excludePatterns = JSON.parse(value);
        break;
      default:
        throw new Error(`Unknown config key: "${key}". Valid keys: model, chunkMaxTokens, chunkOverlap, repo, displayName, excludePatterns`);
    }

    return await updateProject(db, nameOrId, updates);
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// project delete
// ---------------------------------------------------------------------------

export async function runProjectDeleteCommand(
  nameOrId: string,
  opts: { json?: boolean } = {},
): Promise<boolean> {
  const db = await openConfiguredDatabase();
  try {
    await ensureProjectTables(db);
    return await deleteProject(db, nameOrId);
  } finally {
    await db.close();
  }
}
