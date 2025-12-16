import type { ContextPackage, ContextOptions, RelevantFile, KeySymbol } from '../types/context.js';
import type { IndexDatabase, SearchResult } from '../storage/lance.js';
import type { EmbeddingClient } from './embeddings.js';
import type { CodeSymbol, CallEdge } from '../types/code-intel.js';
import { searchChunks } from '../storage/lance.js';
import { getSymbols, getCalls } from '../storage/code-intel.js';
import { createSummarizerClient } from './summarizer.js';
import { loadConfig } from '../storage/config.js';

export interface ContextBuilderDeps {
  db: IndexDatabase;
  indexName: string;
  embeddingClient: EmbeddingClient;
}

/**
 * Build a context package for a given task.
 */
export async function buildContext(
  deps: ContextBuilderDeps,
  task: string,
  options?: ContextOptions
): Promise<ContextPackage> {
  const { db, indexName, embeddingClient } = deps;
  const { limit = 15, maxTokens = 32000, depth = 2, generateApproach = false } = options ?? {};

  try {
    // 1. Embed task description
    const embeddingResult = await embeddingClient.embedQuery(task);
    const taskVector = new Float32Array(embeddingResult.embeddings[0] ?? []);

    // 2. Search chunks for relevant content
    const handle = { name: indexName, metadata: {} as never, table: null };
    const chunkResults = await searchChunks(db, handle, taskVector, { limit: limit * 3 });

    // 3. Get symbols from relevant files
    const relevantFilePaths = Array.from(new Set(chunkResults.map(c => c.filePath)));
    const allSymbols = await getSymbolsForFiles(db, indexName, relevantFilePaths);

    // 4. Expand via call graph (BFS)
    const expandedSymbols = await expandViaGraph(db, indexName, allSymbols, depth);

    // 5. Score and rank
    const scoredFiles = scoreFiles(chunkResults, expandedSymbols, taskVector);
    const scoredSymbols = scoreSymbols(expandedSymbols, taskVector);

    // 6. Build package within token budget
    const contextPackage = buildPackageWithinBudget({
      task,
      indexName,
      files: scoredFiles.slice(0, limit),
      symbols: scoredSymbols,
      tokenBudget: maxTokens,
    });

    // 7. Generate approach suggestions if requested
    if (generateApproach) {
      const approachSteps = await generateApproachSuggestions(
        task,
        contextPackage.keySymbols,
        contextPackage.relevantFiles
      );
      contextPackage.suggestedApproach = approachSteps;
    }

    return contextPackage;
  } catch (error) {
    // Handle empty index or errors gracefully
    return {
      task,
      indexName,
      relevantFiles: [],
      keySymbols: [],
      suggestedApproach: [],
      tokenCount: estimateTokens(task),
      timestamp: new Date().toISOString(),
      files: [],
      symbols: [],
    };
  }
}

/**
 * Get symbols for a list of files.
 */
async function getSymbolsForFiles(
  db: IndexDatabase,
  indexName: string,
  filePaths: string[]
): Promise<CodeSymbol[]> {
  const symbols: CodeSymbol[] = [];

  for (const filePath of filePaths) {
    const fileSymbols = await getSymbols(db, indexName, { file: filePath });
    symbols.push(...fileSymbols);
  }

  return symbols;
}

/**
 * Expand symbols via call graph using BFS.
 */
async function expandViaGraph(
  db: IndexDatabase,
  indexName: string,
  initialSymbols: CodeSymbol[],
  maxDepth: number
): Promise<Map<string, { symbol: CodeSymbol; distance: number }>> {
  const visited = new Map<string, { symbol: CodeSymbol; distance: number }>();
  const queue: Array<{ symbolId: string; distance: number }> = [];

  // Initialize with direct matches
  for (const sym of initialSymbols) {
    visited.set(sym.id, { symbol: sym, distance: 0 });
    queue.push({ symbolId: sym.id, distance: 0 });
  }

  // BFS through call graph
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.distance >= maxDepth) continue;

    try {
      // Get calls FROM this symbol
      const outgoingCalls = await getCalls(db, indexName, { caller: current.symbolId });
      for (const call of outgoingCalls) {
        if (call.calleeId && !visited.has(call.calleeId)) {
          // We need to fetch the callee symbol
          const calleeSymbols = await getSymbols(db, indexName);
          const calleeSymbol = calleeSymbols.find(s => s.id === call.calleeId);
          
          if (calleeSymbol) {
            visited.set(call.calleeId, {
              symbol: calleeSymbol,
              distance: current.distance + 1,
            });
            queue.push({ symbolId: call.calleeId, distance: current.distance + 1 });
          }
        }
      }

      // Get calls TO this symbol
      const incomingCalls = await getCalls(db, indexName, { callee: current.symbolId });
      for (const call of incomingCalls) {
        if (call.callerId && !visited.has(call.callerId)) {
          const callerSymbols = await getSymbols(db, indexName);
          const callerSymbol = callerSymbols.find(s => s.id === call.callerId);
          
          if (callerSymbol) {
            visited.set(call.callerId, {
              symbol: callerSymbol,
              distance: current.distance + 1,
            });
            queue.push({ symbolId: call.callerId, distance: current.distance + 1 });
          }
        }
      }
    } catch {
      // Continue if call graph queries fail
      continue;
    }
  }

  return visited;
}

/**
 * Score files by relevance.
 */
function scoreFiles(
  chunkResults: SearchResult[],
  expandedSymbols: Map<string, { symbol: CodeSymbol; distance: number }>,
  taskVector: Float32Array
): RelevantFile[] {
  const fileScores = new Map<string, { file: SearchResult; maxScore: number }>();

  // Group chunks by file and find best score
  for (const chunk of chunkResults) {
    const existing = fileScores.get(chunk.filePath);
    const score = 1 - chunk._score; // Convert distance to similarity

    if (!existing || score > existing.maxScore) {
      fileScores.set(chunk.filePath, { file: chunk, maxScore: score });
    }
  }

  // Convert to RelevantFile array
  const files: RelevantFile[] = [];
  for (const [filePath, { file, maxScore }] of Array.from(fileScores.entries())) {
    files.push({
      filePath: file.filePath,
      relativePath: file.relativePath,
      score: maxScore,
      relevance: maxScore,
      reason: `Relevant based on semantic similarity (score: ${maxScore.toFixed(2)})`,
      content: file.content,
    });
  }

  // Sort by score descending
  files.sort((a, b) => b.score - a.score);

  return files;
}

/**
 * Score symbols by relevance.
 */
function scoreSymbols(
  expandedSymbols: Map<string, { symbol: CodeSymbol; distance: number }>,
  taskVector: Float32Array
): KeySymbol[] {
  const scored: KeySymbol[] = [];

  for (const [_, { symbol, distance }] of Array.from(expandedSymbols.entries())) {
    // For now, use simple distance-based scoring
    // In a full implementation, we'd use vector similarity too
    const graphScore = 1 / (1 + distance);
    const importanceScore = symbol.isExported ? 0.2 : 0;
    const score = 0.7 * graphScore + 0.3 * importanceScore;

    scored.push({
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.relativePath,
      summary: symbol.signature ?? `${symbol.kind} ${symbol.name}`,
      symbol,
      score,
      distance,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Build context package within token budget.
 */
function buildPackageWithinBudget(data: {
  task: string;
  indexName: string;
  files: RelevantFile[];
  symbols: KeySymbol[];
  tokenBudget: number;
}): ContextPackage {
  let tokens = estimateTokens(data.task);
  const includedFiles: RelevantFile[] = [];
  const includedSymbols: KeySymbol[] = [];

  // Add files until we hit token budget
  for (const file of data.files) {
    const fileTokens = estimateTokens(file.content ?? '');
    if (tokens + fileTokens <= data.tokenBudget) {
      includedFiles.push(file);
      tokens += fileTokens;
    }
  }

  // Add symbol signatures (very small token cost)
  for (const keySymbol of data.symbols) {
    const symbolTokens = estimateTokens(keySymbol.summary);
    if (tokens + symbolTokens <= data.tokenBudget) {
      includedSymbols.push(keySymbol);
      tokens += symbolTokens;
    }
  }

  return {
    task: data.task,
    indexName: data.indexName,
    relevantFiles: includedFiles,
    keySymbols: includedSymbols,
    suggestedApproach: [],
    tokenCount: tokens,
    timestamp: new Date().toISOString(),
    // Legacy fields
    files: includedFiles,
    symbols: includedSymbols,
  };
}

/**
 * Rough token estimation (4 chars ≈ 1 token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate cosine similarity between two vectors.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i];
    const bVal = b[i];
    if (aVal !== undefined && bVal !== undefined) {
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Generate approach suggestions using the summarizer.
 */
async function generateApproachSuggestions(
  task: string,
  symbols: KeySymbol[],
  files: RelevantFile[]
): Promise<Array<{ step: number; description: string; targetFiles: string[] }>> {
  try {
    // Load config to get summarization model
    const config = await loadConfig();

    // Create summarizer client
    const summarizer = createSummarizerClient({
      model: config.summarizationModel,
    });

    // Check if summarizer is healthy
    const health = await summarizer.healthCheck();
    if (!health.healthy) {
      // Silently return empty array if summarizer is not available
      return [];
    }

    // Build context for approach suggestion
    const approachContext = {
      relevantSymbols: symbols.slice(0, 10).map(s => ({
        name: s.name,
        kind: s.kind,
        summary: s.summary,
      })),
      relevantFiles: files.slice(0, 10).map(f => ({
        path: f.relativePath,
        symbols: symbols
          .filter(s => s.file === f.relativePath)
          .map(s => s.name),
      })),
    };

    // Get approach suggestions from summarizer
    const steps = await summarizer.suggestApproach(task, approachContext);
    return steps;
  } catch (error) {
    // Silently fail and return empty array
    // This ensures the context builder doesn't break if summarizer fails
    return [];
  }
}
