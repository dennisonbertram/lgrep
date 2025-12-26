/**
 * MCP request handlers that call lgrep commands.
 */

import { runSearchCommand } from '../cli/commands/search.js';
import { runCallersCommand } from '../cli/commands/callers.js';
import { runImpactCommand } from '../cli/commands/impact.js';
import { runDepsCommand } from '../cli/commands/deps.js';
import { runDeadCommand } from '../cli/commands/dead.js';
import { runSimilarCommand } from '../cli/commands/similar.js';
import { runCyclesCommand } from '../cli/commands/cycles.js';
import { runUnusedExportsCommand } from '../cli/commands/unused-exports.js';
import { runBreakingCommand } from '../cli/commands/breaking.js';
import { runRenameCommand } from '../cli/commands/rename.js';
import { runContextCommand } from '../cli/commands/context.js';
import { runSymbolsCommand } from '../cli/commands/symbols.js';
import { runExplainCommand } from '../cli/commands/explain.js';
import { runStatsCommand } from '../cli/commands/stats.js';

interface ToolContent {
  type: string;
  text: string;
}

/**
 * Format result as MCP tool response content.
 */
function formatToolResponse(result: unknown): ToolContent[] {
  return [
    {
      type: 'text',
      text: JSON.stringify(result, null, 2),
    },
  ];
}

/**
 * Handle lgrep_search tool call.
 */
export async function handleSearch(args: {
  query?: string;
  index?: string;
  limit?: number;
  diversity?: number;
  usages?: string;
  definition?: string;
  type?: string;
}): Promise<ToolContent[]> {
  const result = await runSearchCommand(args.query || '', {
    index: args.index,
    limit: args.limit,
    diversity: args.diversity,
    usages: args.usages,
    definition: args.definition,
    type: args.type,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_callers tool call.
 */
export async function handleCallers(args: {
  symbol: string;
  index?: string;
}): Promise<ToolContent[]> {
  const result = await runCallersCommand(args.symbol, {
    index: args.index,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_impact tool call.
 */
export async function handleImpact(args: {
  symbol: string;
  index?: string;
}): Promise<ToolContent[]> {
  const result = await runImpactCommand(args.symbol, {
    index: args.index,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_deps tool call.
 */
export async function handleDeps(args: {
  module: string;
  index?: string;
}): Promise<ToolContent[]> {
  const result = await runDepsCommand(args.module, {
    index: args.index,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_dead tool call.
 */
export async function handleDead(args: {
  index?: string;
  limit?: number;
}): Promise<ToolContent[]> {
  const result = await runDeadCommand({
    index: args.index,
    limit: args.limit,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_similar tool call.
 */
export async function handleSimilar(args: {
  index?: string;
  limit?: number;
}): Promise<ToolContent[]> {
  const result = await runSimilarCommand({
    index: args.index,
    limit: args.limit,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_cycles tool call.
 */
export async function handleCycles(args: {
  index?: string;
}): Promise<ToolContent[]> {
  const result = await runCyclesCommand({
    index: args.index,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_unused_exports tool call.
 */
export async function handleUnusedExports(args: {
  index?: string;
  limit?: number;
}): Promise<ToolContent[]> {
  const result = await runUnusedExportsCommand({
    index: args.index,
    limit: args.limit,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_breaking tool call.
 */
export async function handleBreaking(args: {
  index?: string;
}): Promise<ToolContent[]> {
  const result = await runBreakingCommand({
    index: args.index,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_rename tool call.
 */
export async function handleRename(args: {
  oldName: string;
  newName: string;
  index?: string;
}): Promise<ToolContent[]> {
  const result = await runRenameCommand(args.oldName, args.newName, {
    index: args.index,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_context tool call.
 */
export async function handleContext(args: {
  task: string;
  index?: string;
  limit?: number;
  maxTokens?: number;
}): Promise<ToolContent[]> {
  const result = await runContextCommand(args.task, {
    index: args.index,
    limit: args.limit,
    maxTokens: args.maxTokens,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_symbols tool call.
 */
export async function handleSymbols(args: {
  query?: string;
  index?: string;
  kind?: string;
  limit?: number;
}): Promise<ToolContent[]> {
  const result = await runSymbolsCommand(args.query, {
    index: args.index,
    kind: args.kind,
    limit: args.limit,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_explain tool call.
 */
export async function handleExplain(args: {
  target: string;
  index?: string;
}): Promise<ToolContent[]> {
  const result = await runExplainCommand(args.target, {
    index: args.index,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Handle lgrep_stats tool call.
 */
export async function handleStats(args: {
  index?: string;
}): Promise<ToolContent[]> {
  const result = await runStatsCommand({
    index: args.index,
    json: true,
    showProgress: false,
  });

  return formatToolResponse(result);
}

/**
 * Route tool call to appropriate handler.
 */
export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolContent[]> {
  switch (toolName) {
    case 'lgrep_search':
      return handleSearch(args as Parameters<typeof handleSearch>[0]);
    case 'lgrep_callers':
      return handleCallers(args as Parameters<typeof handleCallers>[0]);
    case 'lgrep_impact':
      return handleImpact(args as Parameters<typeof handleImpact>[0]);
    case 'lgrep_deps':
      return handleDeps(args as Parameters<typeof handleDeps>[0]);
    case 'lgrep_dead':
      return handleDead(args as Parameters<typeof handleDead>[0]);
    case 'lgrep_similar':
      return handleSimilar(args as Parameters<typeof handleSimilar>[0]);
    case 'lgrep_cycles':
      return handleCycles(args as Parameters<typeof handleCycles>[0]);
    case 'lgrep_unused_exports':
      return handleUnusedExports(args as Parameters<typeof handleUnusedExports>[0]);
    case 'lgrep_breaking':
      return handleBreaking(args as Parameters<typeof handleBreaking>[0]);
    case 'lgrep_rename':
      return handleRename(args as Parameters<typeof handleRename>[0]);
    case 'lgrep_context':
      return handleContext(args as Parameters<typeof handleContext>[0]);
    case 'lgrep_symbols':
      return handleSymbols(args as Parameters<typeof handleSymbols>[0]);
    case 'lgrep_explain':
      return handleExplain(args as Parameters<typeof handleExplain>[0]);
    case 'lgrep_stats':
      return handleStats(args as Parameters<typeof handleStats>[0]);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
