/**
 * A chunk of text with metadata.
 */
export interface Chunk {
  /** The chunk content */
  content: string;
  /** Index of this chunk in the sequence */
  index: number;
  /** Character offset where chunk starts */
  startChar: number;
  /** Character offset where chunk ends */
  endChar: number;
  /** Estimated token count */
  estimatedTokens: number;
  /** Line number where chunk starts (1-based) */
  startLine?: number;
  /** Line number where chunk ends (1-based) */
  endLine?: number;
}

/**
 * Options for chunking text.
 */
export interface ChunkOptions {
  /** Maximum tokens per chunk */
  maxTokens: number;
  /** Number of tokens to overlap between chunks */
  overlapTokens: number;
}

/**
 * Average characters per token for estimation.
 * This is a rough approximation based on English text and code.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the number of tokens in a text string.
 * This is a simple heuristic - actual token counts vary by model.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  // Simple estimation: divide by average chars per token
  // Adjust for whitespace and punctuation
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  return Math.ceil(trimmed.length / CHARS_PER_TOKEN);
}

/**
 * Convert token count to approximate character count.
 */
function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

/**
 * Find sentence boundaries in text.
 */
function findSentenceBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  const sentenceEnders = /[.!?]+[\s\n]+/g;

  let match;
  while ((match = sentenceEnders.exec(text)) !== null) {
    boundaries.push(match.index + match[0].length);
  }

  return boundaries;
}

/**
 * Count line number at a given character position.
 */
function getLineNumber(text: string, charPos: number): number {
  const substring = text.slice(0, charPos);
  const lines = substring.split('\n');
  return lines.length;
}

/**
 * Find the best split point near a target position.
 * Prefers sentence boundaries, then whitespace.
 */
function findBestSplitPoint(
  text: string,
  targetPos: number,
  minPos: number,
  maxPos: number
): number {
  // Clamp target to bounds
  const target = Math.max(minPos, Math.min(maxPos, targetPos));

  // Look for sentence boundaries in the search range
  const searchStart = Math.max(0, target - 100);
  const searchEnd = Math.min(text.length, target + 100);
  const searchText = text.slice(searchStart, searchEnd);

  const boundaries = findSentenceBoundaries(searchText);
  if (boundaries.length > 0) {
    // Find boundary closest to target
    const adjustedTarget = target - searchStart;
    let closest = boundaries[0]!;
    let closestDist = Math.abs(closest - adjustedTarget);

    for (const boundary of boundaries) {
      const dist = Math.abs(boundary - adjustedTarget);
      if (dist < closestDist) {
        closest = boundary;
        closestDist = dist;
      }
    }

    const globalPos = searchStart + closest;
    if (globalPos >= minPos && globalPos <= maxPos) {
      return globalPos;
    }
  }

  // Fall back to whitespace boundary
  let bestPos = target;

  // Search backwards for whitespace
  for (let i = target; i >= minPos; i--) {
    if (/\s/.test(text[i] ?? '')) {
      bestPos = i + 1;
      break;
    }
  }

  // If no whitespace found, search forwards
  if (bestPos === target) {
    for (let i = target; i <= maxPos && i < text.length; i++) {
      if (/\s/.test(text[i] ?? '')) {
        bestPos = i + 1;
        break;
      }
    }
  }

  return bestPos;
}

/**
 * Chunk text into overlapping segments.
 */
export function chunkText(text: string, options: ChunkOptions): Chunk[] {
  const { maxTokens, overlapTokens } = options;

  // Handle empty or whitespace-only input
  if (!text || text.trim().length === 0) {
    return [];
  }

  const maxChars = tokensToChars(maxTokens);
  const overlapChars = tokensToChars(overlapTokens);
  const chunks: Chunk[] = [];

  // If text fits in one chunk, return it directly
  if (estimateTokens(text) <= maxTokens) {
    return [
      {
        content: text,
        index: 0,
        startChar: 0,
        endChar: text.length,
        estimatedTokens: estimateTokens(text),
        startLine: 1,
        endLine: getLineNumber(text, text.length),
      },
    ];
  }

  let pos = 0;
  let chunkIndex = 0;

  while (pos < text.length) {
    // Calculate target end position
    const targetEnd = pos + maxChars;

    // Find actual end position (prefer natural boundaries)
    let endPos: number;
    if (targetEnd >= text.length) {
      endPos = text.length;
    } else {
      // Find a good split point near the target
      const minEnd = pos + Math.floor(maxChars * 0.5); // At least 50% of max
      const maxEnd = Math.min(text.length, pos + Math.floor(maxChars * 1.2)); // Up to 120%
      endPos = findBestSplitPoint(text, targetEnd, minEnd, maxEnd);
    }

    // Extract chunk content
    const content = text.slice(pos, endPos).trim();

    if (content.length > 0) {
      chunks.push({
        content,
        index: chunkIndex,
        startChar: pos,
        endChar: endPos,
        estimatedTokens: estimateTokens(content),
        startLine: getLineNumber(text, pos),
        endLine: getLineNumber(text, endPos),
      });
      chunkIndex++;
    }

    // Move position, accounting for overlap
    const step = endPos - pos - overlapChars;
    if (step <= 0) {
      // Avoid infinite loop - force progress
      pos = endPos;
    } else {
      pos = pos + step;
    }

    // Don't start a new chunk if we're very close to the end
    if (text.length - pos < overlapChars) {
      break;
    }
  }

  return chunks;
}
