import { createEmbeddingClient } from '../core/embeddings.js';
import { rerankerWithMMR, searchSharedChunksForProject, searchSharedChunksForWorktree, type IndexDatabase, type SearchResult } from '../storage/lance.js';
import { quoteIdentifier, requirePostgresPool, SHARED_CALLS_TABLE, SHARED_SYMBOLS_TABLE } from '../storage/postgres.js';
import type { Project } from '../storage/project.js';
import type { Worktree } from '../storage/worktree.js';
import type { CodeSymbol, SymbolKind } from '../types/code-intel.js';
import type { ContextPackage, RelevantFile, KeySymbol, ApproachStep } from '../types/context.js';

export interface HostedCallerRecord {
  file: string;
  line: number;
  callerName?: string;
  callerKind?: string;
  worktreeName?: string;
}

export interface HostedCallersResult {
  symbol: string;
  callers: HostedCallerRecord[];
  count: number;
}

export interface HostedImpactResult {
  symbol: string;
  directCallers: HostedCallerRecord[];
  transitiveFiles: string[];
  totalFiles: number;
}

interface ScopedCallRow {
  worktreeName: string;
  relativePath: string;
  callerName: string;
  callerKind?: string;
  calleeName: string;
  line: number;
}

interface ScopedSymbolRow {
  worktreeName: string;
  relativePath: string;
  contentHash: string;
  name: string;
  kind: SymbolKind;
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
  isExported: boolean;
  isDefaultExport: boolean;
  documentation?: string;
  signature?: string;
  parentId?: string;
  modifiers: string[];
  summary?: string;
  bodyHash?: string;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function distanceToRelevance(distance: number): number {
  return 1 / (1 + Math.max(distance, 0));
}

function formatScopedPath(relativePath: string, worktreeName: string | undefined, includeWorktree: boolean): string {
  return includeWorktree && worktreeName ? `${worktreeName}:${relativePath}` : relativePath;
}

function parseModifiers(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function buildScopeWhereClause(options: { projectId?: string; worktreeId?: string }, startIndex = 1): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (options.projectId) {
    params.push(options.projectId);
    clauses.push(`w.project_id = $${startIndex + params.length - 1}`);
  }

  if (options.worktreeId) {
    params.push(options.worktreeId);
    clauses.push(`w.id = $${startIndex + params.length - 1}`);
  }

  return {
    clause: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '',
    params,
  };
}

async function queryScopedCalls(
  db: IndexDatabase,
  options: { projectId?: string; worktreeId?: string; calleeName?: string },
): Promise<ScopedCallRow[]> {
  const pool = requirePostgresPool(db);
  const sc = quoteIdentifier(SHARED_CALLS_TABLE);
  const ss = quoteIdentifier(SHARED_SYMBOLS_TABLE);
  const wm = quoteIdentifier('lgrep_worktree_manifests');
  const wt = quoteIdentifier('lgrep_worktrees');

  const params: unknown[] = [];
  const clauses: string[] = [];

  if (options.calleeName) {
    params.push(normalizeName(options.calleeName));
    clauses.push(`LOWER(sc.callee_name) = $${params.length}`);
  }

  const scoped = buildScopeWhereClause(
    { projectId: options.projectId, worktreeId: options.worktreeId },
    params.length + 1,
  );
  params.push(...scoped.params);

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : 'WHERE TRUE';

  const result = await pool.query<Record<string, unknown>>(
    `SELECT DISTINCT ON (w.id, wm.relative_path, sc.line, sc.caller_name, sc.callee_name)
        w.name AS worktree_name,
        wm.relative_path,
        sc.caller_name,
        sc.callee_name,
        sc.line,
        caller_symbol.kind AS caller_kind
      FROM ${sc} sc
      JOIN ${wm} wm
        ON wm.content_hash = sc.content_hash
      JOIN ${wt} w
        ON w.id = wm.worktree_id
      LEFT JOIN LATERAL (
        SELECT ss.kind
          FROM ${ss} ss
         WHERE ss.content_hash = sc.content_hash
           AND LOWER(ss.name) = LOWER(sc.caller_name)
         ORDER BY ss.line_start
         LIMIT 1
      ) AS caller_symbol ON TRUE
      ${whereClause}${scoped.clause}
      ORDER BY w.id, wm.relative_path, sc.line, sc.caller_name, sc.callee_name`,
    params,
  );

  return result.rows.map((row) => ({
    worktreeName: String(row['worktree_name'] ?? ''),
    relativePath: String(row['relative_path'] ?? ''),
    callerName: String(row['caller_name'] ?? ''),
    calleeName: String(row['callee_name'] ?? ''),
    line: Number(row['line'] ?? 0),
    callerKind: row['caller_kind'] ? String(row['caller_kind']) : undefined,
  }));
}

async function queryScopedSymbolsForContentHashes(
  db: IndexDatabase,
  contentHashes: string[],
  options: { projectId?: string; worktreeId?: string },
): Promise<ScopedSymbolRow[]> {
  if (contentHashes.length === 0) {
    return [];
  }

  const pool = requirePostgresPool(db);
  const ss = quoteIdentifier(SHARED_SYMBOLS_TABLE);
  const wm = quoteIdentifier('lgrep_worktree_manifests');
  const wt = quoteIdentifier('lgrep_worktrees');

  const params: unknown[] = [];
  const hashPlaceholders = contentHashes.map((hash) => {
    params.push(hash);
    return `$${params.length}`;
  });

  const scoped = buildScopeWhereClause(
    { projectId: options.projectId, worktreeId: options.worktreeId },
    params.length + 1,
  );
  params.push(...scoped.params);

  const result = await pool.query<Record<string, unknown>>(
    `SELECT DISTINCT ON (w.id, wm.relative_path, ss.name, ss.line_start, ss.kind)
        w.name AS worktree_name,
        wm.relative_path,
        ss.content_hash,
        ss.name,
        ss.kind,
        ss.line_start,
        ss.line_end,
        ss.column_start,
        ss.column_end,
        ss.is_exported,
        ss.is_default_export,
        ss.documentation,
        ss.signature,
        ss.parent_id,
        ss.modifiers,
        ss.summary,
        ss.body_hash
      FROM ${ss} ss
      JOIN ${wm} wm
        ON wm.content_hash = ss.content_hash
      JOIN ${wt} w
        ON w.id = wm.worktree_id
      WHERE ss.content_hash IN (${hashPlaceholders.join(', ')})${scoped.clause}
      ORDER BY w.id, wm.relative_path, ss.name, ss.line_start, ss.kind`,
    params,
  );

  return result.rows.map((row) => ({
    worktreeName: String(row['worktree_name'] ?? ''),
    relativePath: String(row['relative_path'] ?? ''),
    contentHash: String(row['content_hash'] ?? ''),
    name: String(row['name'] ?? ''),
    kind: String(row['kind'] ?? 'function') as SymbolKind,
    lineStart: Number(row['line_start'] ?? 0),
    lineEnd: Number(row['line_end'] ?? 0),
    columnStart: Number(row['column_start'] ?? 0),
    columnEnd: Number(row['column_end'] ?? 0),
    isExported: asBoolean(row['is_exported']),
    isDefaultExport: asBoolean(row['is_default_export']),
    documentation: row['documentation'] ? String(row['documentation']) : undefined,
    signature: row['signature'] ? String(row['signature']) : undefined,
    parentId: row['parent_id'] ? String(row['parent_id']) : undefined,
    modifiers: parseModifiers(row['modifiers']),
    summary: row['summary'] ? String(row['summary']) : undefined,
    bodyHash: row['body_hash'] ? String(row['body_hash']) : undefined,
  }));
}

function toHostedCaller(row: ScopedCallRow, includeWorktree: boolean): HostedCallerRecord {
  return {
    file: formatScopedPath(row.relativePath, row.worktreeName, includeWorktree),
    line: row.line,
    callerName: row.callerName || undefined,
    callerKind: row.callerKind,
    worktreeName: includeWorktree ? row.worktreeName : undefined,
  };
}

export async function queryHostedCallers(
  db: IndexDatabase,
  options: {
    symbol: string;
    project?: Project;
    worktree?: Worktree;
  },
): Promise<HostedCallersResult> {
  const includeWorktree = Boolean(options.project && !options.worktree);
  const rows = await queryScopedCalls(db, {
    projectId: options.project?.id,
    worktreeId: options.worktree?.id,
    calleeName: options.symbol,
  });

  const callers = rows.map((row) => toHostedCaller(row, includeWorktree));
  return {
    symbol: options.symbol,
    callers,
    count: callers.length,
  };
}

export async function queryHostedImpact(
  db: IndexDatabase,
  options: {
    symbol: string;
    project?: Project;
    worktree?: Worktree;
  },
): Promise<HostedImpactResult> {
  const includeWorktree = Boolean(options.project && !options.worktree);
  const allCalls = await queryScopedCalls(db, {
    projectId: options.project?.id,
    worktreeId: options.worktree?.id,
  });
  const target = normalizeName(options.symbol);

  const directRows = allCalls.filter((row) => normalizeName(row.calleeName) === target);
  const directCallers = directRows.map((row) => toHostedCaller(row, includeWorktree));
  const directFiles = new Set(directCallers.map((caller) => caller.file));

  const queue = Array.from(
    new Set(
      directRows
        .map((row) => normalizeName(row.callerName))
        .filter(Boolean),
    ),
  );
  const visitedNames = new Set<string>([target]);
  const transitiveFiles = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visitedNames.has(current)) {
      continue;
    }

    visitedNames.add(current);
    const nextRows = allCalls.filter((row) => normalizeName(row.calleeName) === current);
    for (const row of nextRows) {
      const formatted = formatScopedPath(row.relativePath, row.worktreeName, includeWorktree);
      if (!directFiles.has(formatted)) {
        transitiveFiles.add(formatted);
      }

      const nextName = normalizeName(row.callerName);
      if (nextName && !visitedNames.has(nextName)) {
        queue.push(nextName);
      }
    }
  }

  return {
    symbol: options.symbol,
    directCallers,
    transitiveFiles: Array.from(transitiveFiles).sort(),
    totalFiles: new Set([...directFiles, ...transitiveFiles]).size,
  };
}

function buildHostedApproach(task: string, files: RelevantFile[], symbols: KeySymbol[]): ApproachStep[] {
  if (files.length === 0) {
    return [];
  }

  const reviewFiles = files.slice(0, 3).map((file) => file.filePath);
  const traceSymbols = symbols.slice(0, 3).map((symbol) => symbol.file);
  const steps: ApproachStep[] = [
    {
      step: 1,
      description: `Review the top relevant files for "${task}" and confirm the main control flow.`,
      targetFiles: reviewFiles,
    },
  ];

  if (traceSymbols.length > 0) {
    steps.push({
      step: 2,
      description: 'Trace the highest-signal symbols and call sites before making changes.',
      targetFiles: Array.from(new Set(traceSymbols)),
    });
  }

  if (files.length > 1) {
    steps.push({
      step: 3,
      description: 'Validate neighboring files and tests affected by the same workflow.',
      targetFiles: files.slice(0, 5).map((file) => file.filePath),
    });
  }

  return steps;
}

function scoreRelevantFiles(
  results: Array<SearchResult & { worktreeName?: string }>,
  includeWorktree: boolean,
  summaryOnly: boolean,
): Array<RelevantFile & { contentHash: string; worktreeName?: string }> {
  const deduped = new Map<string, SearchResult & { worktreeName?: string }>();

  for (const result of results) {
    const key = `${result.worktreeName ?? ''}:${result.relativePath}`;
    const existing = deduped.get(key);
    if (!existing || result._score < existing._score) {
      deduped.set(key, result);
    }
  }

  return Array.from(deduped.values())
    .map((result) => {
      const relevance = distanceToRelevance(result._score);
      return {
        filePath: formatScopedPath(result.relativePath, result.worktreeName, includeWorktree),
        relativePath: result.relativePath,
        score: relevance,
        relevance,
        reason: `Semantic match for the task (distance ${result._score.toFixed(3)})`,
        content: summaryOnly ? undefined : result.content,
        contentHash: result.contentHash,
        worktreeName: result.worktreeName,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function buildHostedKeySymbols(
  symbolRows: ScopedSymbolRow[],
  fileScores: Map<string, number>,
  includeWorktree: boolean,
  maxSymbols: number,
): KeySymbol[] {
  const symbols = symbolRows
    .map((row) => {
      const fileLabel = formatScopedPath(row.relativePath, row.worktreeName, includeWorktree);
      const symbol: CodeSymbol = {
        id: `shared:${row.contentHash}:${row.name}:${row.lineStart}:${row.kind}`,
        name: row.name,
        kind: row.kind,
        filePath: fileLabel,
        relativePath: fileLabel,
        range: {
          start: {
            line: row.lineStart,
            column: row.columnStart,
          },
          end: {
            line: row.lineEnd,
            column: row.columnEnd,
          },
        },
        isExported: row.isExported,
        isDefaultExport: row.isDefaultExport,
        documentation: row.documentation,
        signature: row.signature,
        parentId: row.parentId,
        modifiers: row.modifiers,
        summary: row.summary,
        bodyHash: row.bodyHash,
      };

      return {
        name: row.name,
        kind: row.kind,
        file: fileLabel,
        summary: row.signature || row.summary || `${row.kind} ${row.name}`,
        symbol,
        score: fileScores.get(fileLabel) ?? 0,
        distance: 0,
      } satisfies KeySymbol;
    })
    .sort((a, b) => b.score - a.score);

  return symbols.slice(0, maxSymbols);
}

export async function buildHostedContext(
  db: IndexDatabase,
  options: {
    task: string;
    project?: Project;
    worktree?: Worktree;
    limit?: number;
    maxTokens?: number;
    depth?: number;
    summaryOnly?: boolean;
    noApproach?: boolean;
  },
): Promise<ContextPackage> {
  const limit = options.limit ?? 15;
  const maxTokens = options.maxTokens ?? 32000;
  const depth = options.depth ?? 2;
  const summaryOnly = options.summaryOnly ?? false;
  const includeWorktree = Boolean(options.project && !options.worktree);
  const model = options.worktree?.model ?? options.project?.model;

  if (!model) {
    throw new Error('Hosted context requires a project or worktree with a configured embedding model');
  }

  const embedClient = createEmbeddingClient({ model });
  const queryResult = await embedClient.embedQuery(options.task);
  const embedding = queryResult.embeddings[0];
  if (!embedding) {
    throw new Error('Failed to generate query embedding');
  }

  const queryVector = new Float32Array(embedding);
  const rawResults = options.project
    ? await searchSharedChunksForProject(db, queryVector, options.project.id, {
        limit: limit * 3,
        model,
        worktreeId: options.worktree?.id,
      })
    : options.worktree
      ? (await searchSharedChunksForWorktree(db, queryVector, options.worktree.id, {
          limit: limit * 3,
          model,
        })).map((result) => ({
          ...result,
          worktreeName: options.worktree?.name,
        }))
      : [];

  const reranked = rerankerWithMMR(rawResults, queryVector, 0.7);
  const scoredFiles = scoreRelevantFiles(reranked, includeWorktree, summaryOnly);

  let tokenCount = estimateTokens(options.task);
  const includedFiles: Array<RelevantFile & { contentHash: string; worktreeName?: string }> = [];
  for (const file of scoredFiles) {
    const fileCost = estimateTokens(file.content ?? file.reason);
    if (includedFiles.length >= limit || tokenCount + fileCost > maxTokens) {
      continue;
    }
    includedFiles.push(file);
    tokenCount += fileCost;
  }

  const selectedHashes = Array.from(new Set(includedFiles.map((file) => file.contentHash)));
  const scopedSymbols = await queryScopedSymbolsForContentHashes(db, selectedHashes, {
    projectId: options.project?.id,
    worktreeId: options.worktree?.id,
  });

  const fileScores = new Map(includedFiles.map((file) => [file.filePath, file.score]));
  const rawKeySymbols = buildHostedKeySymbols(scopedSymbols, fileScores, includeWorktree, Math.max(5, depth * 5));
  const keySymbols: KeySymbol[] = [];
  for (const symbol of rawKeySymbols) {
    const symbolCost = estimateTokens(symbol.summary);
    if (tokenCount + symbolCost > maxTokens) {
      break;
    }
    keySymbols.push(symbol);
    tokenCount += symbolCost;
  }

  const relevantFiles = includedFiles.map(({ contentHash: _contentHash, worktreeName: _worktreeName, ...file }) => file);
  const suggestedApproach = options.noApproach ? [] : buildHostedApproach(options.task, relevantFiles, keySymbols);
  const indexName = options.worktree
    ? `${options.project ? `${options.project.name}/` : ''}${options.worktree.name}`
    : options.project?.name ?? 'hosted';

  return {
    task: options.task,
    indexName,
    relevantFiles,
    keySymbols,
    suggestedApproach,
    tokenCount,
    timestamp: new Date().toISOString(),
    files: relevantFiles,
    symbols: keySymbols,
  };
}
