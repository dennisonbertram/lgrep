import type { SearchCommandResult, SymbolUsage, SymbolDefinition, SymbolInfo } from './search.js';
import type { IndexResult } from './index.js';
import type { AnalyzeResult } from './analyze.js';
import type { ContextPackage } from '../../types/context.js';

/**
 * JSON error format
 */
export interface JsonError {
  error: string;
  code: string;
}

/**
 * JSON output for search command (semantic search mode)
 */
export interface JsonSemanticSearchOutput {
  results: Array<{
    file: string;
    chunk: string;
    score: number;
    line: number;
  }>;
  query: string;
  count: number;
}

/**
 * JSON output for usages mode
 */
export interface JsonUsagesOutput {
  command: string;
  mode: string;
  symbol: string;
  usages: SymbolUsage[];
  count: number;
}

/**
 * JSON output for definition mode
 */
export interface JsonDefinitionOutput {
  command: string;
  mode: string;
  symbol: string;
  definitions: SymbolDefinition[];
  count: number;
}

/**
 * JSON output for type filter mode
 */
export interface JsonTypeOutput {
  command: string;
  mode: string;
  symbolType: string;
  symbols: SymbolInfo[];
  count: number;
}

/**
 * JSON output for search command (all modes)
 */
export type JsonSearchOutput = JsonSemanticSearchOutput | JsonUsagesOutput | JsonDefinitionOutput | JsonTypeOutput;

/**
 * JSON output for index command
 */
export interface JsonIndexOutput {
  indexed: number;
  skipped: number;
  updated?: number;
  added?: number;
  deleted?: number;
  symbolsSummarized?: number;
  summarizationSkipped?: boolean;
  errors: string[];
  duration_ms: number;
}

/**
 * JSON output for list command
 */
export interface JsonListOutput {
  indexes: Array<{
    name: string;
    files: number;
    chunks: number;
    created: string;
  }>;
}

/**
 * JSON output for delete command
 */
export interface JsonDeleteOutput {
  deleted: string;
  success: boolean;
}

/**
 * JSON output for config command
 */
export interface JsonConfigOutput {
  config: Record<string, unknown>;
}

/**
 * JSON output for analyze command
 */
export interface JsonAnalyzeOutput {
  command: string;
  path: string;
  filesAnalyzed: number;
  symbols?: Array<{
    name: string;
    kind: string;
    file: string;
    line: number;
    isExported: boolean;
  }>;
  dependencies?: Array<{
    source: string;
    target: string;
    kind: string;
    isExternal: boolean;
  }>;
  calls?: Array<{
    caller: string;
    callee: string;
    line: number;
    isMethod: boolean;
  }>;
  stats: {
    totalSymbols: number;
    totalDependencies: number;
    totalCalls: number;
    byKind: Record<string, number>;
  };
}

/**
 * Format command output as JSON
 */
export function formatAsJson(
  commandType: string,
  data: unknown,
  meta?: Record<string, unknown>
): string {
  let output: unknown;

  switch (commandType) {
    case 'search':
      output = formatSearchJson(data as SearchCommandResult);
      break;
    case 'index':
      output = formatIndexJson(data as IndexResult);
      break;
    case 'list':
      output = formatListJson(data as string);
      break;
    case 'delete':
      output = formatDeleteJson(data as string, meta);
      break;
    case 'config':
      output = formatConfigJson(data as string);
      break;
    case 'analyze':
      output = formatAnalyzeJson(data as AnalyzeResult, meta);
      break;
    case 'error':
      output = formatErrorJson(data as Error);
      break;
    default:
      output = { data };
  }

  return JSON.stringify(output);
}

/**
 * Format search results as JSON
 */
function formatSearchJson(result: SearchCommandResult): JsonSearchOutput {
  // Handle code intelligence modes
  if (result.mode === 'usages') {
    return {
      command: 'search',
      mode: 'usages',
      symbol: result.symbol ?? '',
      usages: result.usages ?? [],
      count: result.count ?? 0,
    };
  }

  if (result.mode === 'definition') {
    return {
      command: 'search',
      mode: 'definition',
      symbol: result.symbol ?? '',
      definitions: result.definitions ?? [],
      count: result.count ?? 0,
    };
  }

  if (result.mode === 'type') {
    return {
      command: 'search',
      mode: 'type',
      symbolType: result.symbolType ?? '',
      symbols: result.symbols ?? [],
      count: result.count ?? 0,
    };
  }

  // Standard semantic search mode
  return {
    results: (result.results ?? []).map((item) => ({
      file: item.relativePath,
      chunk: item.content,
      score: item.score,
      line: item.lineStart ?? 0,
    })),
    query: result.query ?? '',
    count: result.results?.length ?? 0,
  };
}

/**
 * Format index results as JSON
 */
function formatIndexJson(result: IndexResult): JsonIndexOutput {
  const output: JsonIndexOutput = {
    indexed: result.filesProcessed,
    skipped: result.filesSkipped ?? 0,
    errors: result.error ? [result.error] : [],
    duration_ms: 0, // Not tracked currently
  };

  // Include incremental stats if present
  if (result.filesUpdated !== undefined) {
    output.updated = result.filesUpdated;
  }
  if (result.filesAdded !== undefined) {
    output.added = result.filesAdded;
  }
  if (result.filesDeleted !== undefined) {
    output.deleted = result.filesDeleted;
  }

  // Include summarization stats if present
  if (result.symbolsSummarized !== undefined) {
    output.symbolsSummarized = result.symbolsSummarized;
  }
  if (result.summarizationSkipped !== undefined) {
    output.summarizationSkipped = result.summarizationSkipped;
  }

  return output;
}

/**
 * Format list output as JSON
 */
function formatListJson(output: string): JsonListOutput {
  const indexes: Array<{
    name: string;
    files: number;
    chunks: number;
    created: string;
  }> = [];

  // Parse the text output
  const lines = output.split('\n');
  let currentIndex: {
    name: string;
    files: number;
    chunks: number;
    created: string;
  } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Index name (starts without whitespace after "Indexes:")
    if (trimmed && !trimmed.startsWith('Path:') && !trimmed.startsWith('Model:') && !trimmed.startsWith('Status:') && !trimmed.startsWith('Chunks:') && trimmed !== 'Indexes:') {
      if (currentIndex) {
        indexes.push(currentIndex);
      }
      currentIndex = {
        name: trimmed,
        files: 0,
        chunks: 0,
        created: new Date().toISOString(),
      };
    }

    // Chunks count
    if (trimmed.startsWith('Chunks:') && currentIndex) {
      const match = trimmed.match(/Chunks:\s*(\d+)/);
      if (match && match[1]) {
        currentIndex.chunks = parseInt(match[1], 10);
      }
    }
  }

  // Push last index
  if (currentIndex) {
    indexes.push(currentIndex);
  }

  return { indexes };
}

/**
 * Format delete output as JSON
 */
function formatDeleteJson(output: string, meta?: Record<string, unknown>): JsonDeleteOutput {
  const indexName = meta?.indexName as string ?? 'unknown';
  return {
    deleted: indexName,
    success: true,
  };
}

/**
 * Format config output as JSON
 */
function formatConfigJson(output: string): JsonConfigOutput {
  const config: Record<string, unknown> = {};

  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const valueStr = trimmed.slice(colonIndex + 1).trim();

    // Try to parse as number
    const numValue = parseFloat(valueStr);
    if (!isNaN(numValue) && valueStr === String(numValue)) {
      config[key] = numValue;
    } else if (valueStr === 'true') {
      config[key] = true;
    } else if (valueStr === 'false') {
      config[key] = false;
    } else {
      config[key] = valueStr;
    }
  }

  return { config };
}

/**
 * Format analyze results as JSON
 */
function formatAnalyzeJson(result: AnalyzeResult, meta?: Record<string, unknown>): JsonAnalyzeOutput {
  const output: JsonAnalyzeOutput = {
    command: 'analyze',
    path: (meta?.path as string) || '.',
    filesAnalyzed: result.filesAnalyzed,
    stats: result.stats,
  };

  if (result.symbols) {
    output.symbols = result.symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      file: s.relativePath,
      line: s.lineStart,
      isExported: s.isExported,
    }));
  }

  if (result.dependencies) {
    output.dependencies = result.dependencies.map((d) => ({
      source: d.sourceFile,
      target: d.targetModule,
      kind: d.kind,
      isExternal: d.isExternal,
    }));
  }

  if (result.calls) {
    output.calls = result.calls.map((c) => ({
      caller: c.callerId,
      callee: c.calleeName,
      line: c.line,
      isMethod: c.isMethodCall,
    }));
  }

  return output;
}

/**
 * Format error as JSON
 */
function formatErrorJson(error: Error): JsonError {
  let code = 'COMMAND_ERROR';

  const message = error.message.toLowerCase();
  if (message.includes('not found')) {
    code = 'NOT_FOUND';
  } else if (message.includes('does not exist')) {
    code = 'PATH_ERROR';
  } else if (message.includes('unknown')) {
    code = 'VALIDATION_ERROR';
  }

  return {
    error: error.message,
    code,
  };
}

/**
 * Format a ContextPackage as markdown for human readability.
 */
export function formatContextMarkdown(ctx: ContextPackage): string {
  let output = `# Context for: ${ctx.task}\n\n`;
  output += `**Index:** ${ctx.indexName}\n`;
  output += `**Tokens:** ${ctx.tokenCount}\n`;
  output += `**Timestamp:** ${ctx.timestamp}\n\n`;

  if (ctx.relevantFiles.length > 0) {
    output += `## Relevant Files\n\n`;
    for (const file of ctx.relevantFiles) {
      output += `### ${file.relativePath} (${(file.relevance * 100).toFixed(0)}%)\n`;
      output += `> ${file.reason}\n\n`;
      if (file.content && file.content.length > 0) {
        output += `\`\`\`\n${file.content}\n\`\`\`\n\n`;
      }
    }
  }

  if (ctx.keySymbols.length > 0) {
    output += `## Key Symbols\n\n`;
    for (const sym of ctx.keySymbols) {
      output += `### ${sym.name} (${sym.kind})\n`;
      output += `**File:** ${sym.file}\n`;
      output += `> ${sym.summary}\n\n`;
    }
  }

  if (ctx.suggestedApproach.length > 0) {
    output += `## Suggested Approach\n\n`;
    for (const step of ctx.suggestedApproach) {
      output += `${step.step}. ${step.description}\n`;
    }
    output += '\n';
  }

  return output;
}
