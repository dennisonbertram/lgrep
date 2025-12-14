import { createEmbeddingClient } from '../../core/embeddings.js';
import { buildContext } from '../../core/context-builder.js';
import { loadConfig } from '../../storage/config.js';
import { openDatabase, getIndex } from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';
import type { ContextPackage } from '../../types/context.js';

/**
 * Options for the context command.
 */
export interface ContextCommandOptions {
  index: string;
  limit?: number;
  maxTokens?: number;
  depth?: number;
  summaryOnly?: boolean;
  noApproach?: boolean;
  format?: 'json' | 'markdown';
  json?: boolean;
}

/**
 * Run the context command to build LLM context for a task.
 */
export async function runContextCommand(
  task: string,
  options: ContextCommandOptions
): Promise<ContextPackage> {
  // Validate task
  if (!task || task.trim().length === 0) {
    throw new Error('Task description is required');
  }

  // Load configuration
  const config = await loadConfig();

  // Open database
  const dbPath = getDbPath();
  const db = await openDatabase(dbPath);

  try {
    // Get the index
    const handle = await getIndex(db, options.index);
    if (!handle) {
      throw new Error(`Index "${options.index}" not found. Create one with: mgrep index <path> -n ${options.index}`);
    }

    // Create embedding client using the model from index metadata
    const embeddingClient = createEmbeddingClient({
      model: handle.metadata.model ?? config.model,
    });

    // Build context
    const contextPackage = await buildContext(
      { db, indexName: options.index, embeddingClient },
      task,
      {
        limit: options.limit ?? config.contextFileLimit ?? 15,
        maxTokens: options.maxTokens ?? config.contextMaxTokens ?? 32000,
        depth: options.depth ?? config.contextGraphDepth ?? 2,
        includeCode: !options.summaryOnly,
        generateApproach: !options.noApproach,
      }
    );

    return contextPackage;
  } finally {
    await db.close();
  }
}
