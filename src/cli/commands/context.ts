import { createEmbeddingClient } from '../../core/embeddings.js';
import { buildContext } from '../../core/context-builder.js';
import { loadConfig } from '../../storage/config.js';
import { getIndex } from '../../storage/lance.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { detectHostedScopeForDirectory } from '../utils/hosted-auto-detect.js';
import type { ContextPackage } from '../../types/context.js';
import { getServerUrl, queryServer } from '../../server/client.js';
import type { QueryContextResponse } from '../../server/query-server.js';

/**
 * Options for the context command.
 */
export interface ContextCommandOptions {
  index?: string;
  project?: string;
  worktree?: string;
  limit?: number;
  maxTokens?: number;
  depth?: number;
  summaryOnly?: boolean;
  noApproach?: boolean;
  format?: 'json' | 'markdown';
  json?: boolean;
  showProgress?: boolean;
}

const HOSTED_SCOPE_ERROR =
  'No hosted project/worktree match found for the current directory. Either:\n' +
  '  1. Use --project <name> and optionally --worktree <name>\n' +
  '  2. Run `lgrep worktree resolve` to confirm the active hosted binding\n' +
  '  3. Run `lgrep worktree bind --project <name> --worktree <name>` to create an explicit local binding\n' +
  '  4. Run the command from a git worktree whose branch matches a hosted worktree\n' +
  '  5. Use --index <name> to query a local index instead';

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

  const hostedScope = getServerUrl() && !options.index && !options.project && !options.worktree
    ? await detectHostedScopeForDirectory()
    : null;

  if (getServerUrl() && !options.index && !options.project && !options.worktree && !hostedScope) {
    throw new Error(HOSTED_SCOPE_ERROR);
  }

  if (getServerUrl() && !options.index && (options.project || options.worktree || hostedScope)) {
    const project = options.project ?? hostedScope?.project;
    const worktree = options.worktree ?? hostedScope?.worktree;

    const response = await queryServer({
      method: 'context',
      project,
      worktree,
      params: {
        task,
        limit: options.limit,
        maxTokens: options.maxTokens,
        depth: options.depth,
        summaryOnly: options.summaryOnly,
        noApproach: options.noApproach,
      },
    }) as QueryContextResponse;

    return response;
  }

  // Auto-detect index if not provided
  let indexName: string;
  if (options.index) {
    indexName = options.index;
  } else {
    const detected = await detectIndexForDirectory();
    if (!detected) {
      throw new Error(
        'No index found for current directory. Either:\n' +
        '  1. Use --index <name> to specify an index\n' +
        '  2. Run `lgrep index .` to index the current directory\n' +
        '  3. Navigate to an indexed directory'
      );
    }
    indexName = detected;
  }

  // Load configuration
  const config = await loadConfig();

  // Open database
  const db = await openConfiguredDatabase();

  try {
    // Get the index
    const handle = await getIndex(db, indexName);
    if (!handle) {
      throw new Error(`Index "${indexName}" not found. Create one with: lgrep index <path> -n ${indexName}`);
    }

    // Create embedding client using the model from index metadata
    const embeddingClient = createEmbeddingClient({
      model: handle.metadata.model ?? config.model,
    });

    // Build context
    const contextPackage = await buildContext(
      { db, indexName, embeddingClient },
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
