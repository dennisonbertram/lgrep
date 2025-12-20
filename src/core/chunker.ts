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
  /** Additional metadata for specialized chunks */
  metadata?: {
    /** Header hierarchy for context (e.g., ["Main Title", "Subsection"]) */
    headerHierarchy?: string[];
    /** Whether this chunk contains frontmatter */
    hasFrontmatter?: boolean;
    /** Type of code structure (function, class, etc.) */
    type?: 'function' | 'arrow_function' | 'class' | 'method' | 'import' | 'export' | 'interface' | 'type' | 'enum';
    /** Name of the function/class/etc. */
    name?: string;
    /** Class name for methods */
    className?: string;
    /** Whether this chunk used fallback (non-AST) chunking */
    fallback?: boolean;
  };
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
 * Check if a file is a markdown file based on its extension.
 */
function isMarkdownFile(fileName?: string): boolean {
  if (!fileName) return false;
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'md' || ext === 'mdx';
}

/**
 * Chunk text into overlapping segments.
 * For markdown files, splits at header boundaries while preserving code blocks.
 */
export function chunkText(
  text: string,
  options: ChunkOptions,
  fileName?: string
): Chunk[] {
  // Route to markdown chunking if applicable
  if (fileName && isMarkdownFile(fileName)) {
    return chunkMarkdown(text, options);
  }

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

/**
 * Detect code block boundaries in markdown.
 * Returns array of {start, end} positions for each code block.
 */
interface CodeBlock {
  start: number;
  end: number;
}

function findCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = text.split('\n');
  let inBlock = false;
  let blockStart = 0;
  let charPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.trim().startsWith('```')) {
      if (!inBlock) {
        inBlock = true;
        blockStart = charPos;
      } else {
        inBlock = false;
        blocks.push({
          start: blockStart,
          end: charPos + line.length,
        });
      }
    }

    charPos += line.length + 1; // +1 for newline
  }

  return blocks;
}

/**
 * Check if a position is inside a code block.
 */
function isInsideCodeBlock(pos: number, codeBlocks: CodeBlock[]): boolean {
  return codeBlocks.some((block) => pos >= block.start && pos <= block.end);
}

/**
 * Extract frontmatter from markdown.
 * Returns {content, endPos} or null if no frontmatter.
 */
interface Frontmatter {
  content: string;
  endPos: number;
}

function extractFrontmatter(text: string): Frontmatter | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('---')) return null;

  const lines = trimmed.split('\n');
  let endLine = -1;

  // Find closing ---
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) return null;

  // Calculate character position
  const frontmatterLines = lines.slice(0, endLine + 1);
  const content = frontmatterLines.join('\n');
  const endPos = content.length;

  return { content, endPos };
}

/**
 * Find markdown headers in text, excluding those in code blocks.
 */
interface Header {
  level: number;
  text: string;
  position: number;
  line: number;
}

function findHeaders(text: string, codeBlocks: CodeBlock[]): Header[] {
  const headers: Header[] = [];
  const lines = text.split('\n');
  let charPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Check for ATX headers (# ## ###)
    const match = /^(#{1,6})\s+(.+)/.exec(trimmed);
    if (match && !isInsideCodeBlock(charPos, codeBlocks)) {
      headers.push({
        level: match[1]?.length ?? 0,
        text: match[2]?.trim() ?? '',
        position: charPos,
        line: i + 1,
      });
    }

    charPos += line.length + 1; // +1 for newline
  }

  return headers;
}

/**
 * Build header hierarchy at a given position.
 */
function getHeaderHierarchy(headers: Header[], position: number): string[] {
  const hierarchy: string[] = [];
  const levelStack: Array<{ level: number; text: string }> = [];

  for (const header of headers) {
    if (header.position >= position) break;

    // Pop headers at same or higher level
    while (
      levelStack.length > 0 &&
      levelStack[levelStack.length - 1]!.level >= header.level
    ) {
      levelStack.pop();
    }

    // Push this header
    levelStack.push({ level: header.level, text: header.text });
  }

  return levelStack.map((h) => h.text);
}

/**
 * Split a large section while respecting code block boundaries.
 */
function splitLargeSection(
  text: string,
  options: ChunkOptions,
  codeBlocks: CodeBlock[]
): Chunk[] {
  const maxChars = tokensToChars(options.maxTokens);
  const chunks: Chunk[] = [];
  let pos = 0;

  while (pos < text.length) {
    let endPos = Math.min(pos + maxChars, text.length);

    // Make sure we don't split inside a code block
    for (const block of codeBlocks) {
      if (pos < block.start && endPos > block.start && endPos < block.end) {
        // Would split code block - either include all or none
        if (endPos - block.start < block.end - endPos) {
          // Closer to start, don't include block
          endPos = block.start;
        } else {
          // Closer to end, include whole block
          endPos = block.end;
        }
      }
    }

    // Find good split point
    if (endPos < text.length) {
      const minEnd = pos + Math.floor(maxChars * 0.5);
      const maxEnd = Math.min(text.length, pos + Math.floor(maxChars * 1.2));
      endPos = findBestSplitPoint(text, endPos, minEnd, maxEnd);
    }

    const content = text.slice(pos, endPos).trim();
    if (content.length > 0) {
      chunks.push({
        content,
        index: chunks.length,
        startChar: pos,
        endChar: endPos,
        estimatedTokens: estimateTokens(content),
        startLine: getLineNumber(text, pos),
        endLine: getLineNumber(text, endPos),
      });
    }

    pos = endPos;
  }

  return chunks;
}

/**
 * Chunk markdown text based on headers and code block boundaries.
 */
function chunkMarkdown(text: string, options: ChunkOptions): Chunk[] {
  const codeBlocks = findCodeBlocks(text);
  const frontmatter = extractFrontmatter(text);

  let contentStart = 0;
  const chunks: Chunk[] = [];

  // Handle frontmatter
  if (frontmatter) {
    contentStart = frontmatter.endPos + 1; // Skip newline after frontmatter
  }

  const contentText = text.slice(contentStart);
  const headers = findHeaders(
    contentText,
    codeBlocks.map((b) => ({
      start: b.start - contentStart,
      end: b.end - contentStart,
    }))
  );

  // If no headers, fall back to regular chunking
  if (headers.length === 0) {
    const regularChunks = chunkText(text, options);
    if (frontmatter && regularChunks.length > 0) {
      regularChunks[0]!.metadata = { hasFrontmatter: true };
    }
    return regularChunks;
  }

  // Split at header boundaries
  const splitPoints = [
    0,
    ...headers.map((h) => h.position),
    contentText.length,
  ];

  for (let i = 0; i < splitPoints.length - 1; i++) {
    const start = splitPoints[i] ?? 0;
    const end = splitPoints[i + 1] ?? contentText.length;
    const sectionText = contentText.slice(start, end).trim();

    if (!sectionText) continue;

    // If section is too large, split it further
    if (estimateTokens(sectionText) > options.maxTokens) {
      // Find code blocks in this section
      const sectionCodeBlocks = codeBlocks
        .filter((b) => {
          const adjustedStart = b.start - contentStart;
          const adjustedEnd = b.end - contentStart;
          return adjustedStart >= start && adjustedEnd <= end;
        })
        .map((b) => ({
          start: b.start - contentStart - start,
          end: b.end - contentStart - start,
        }));

      // Split while respecting code blocks
      const subChunks = splitLargeSection(
        sectionText,
        options,
        sectionCodeBlocks
      );

      // Add hierarchy to all subchunks
      const hierarchy = getHeaderHierarchy(headers, start);

      for (const subChunk of subChunks) {
        chunks.push({
          ...subChunk,
          index: chunks.length,
          startChar: contentStart + start + subChunk.startChar,
          endChar: contentStart + start + subChunk.endChar,
          metadata: {
            headerHierarchy: hierarchy.length > 0 ? hierarchy : undefined,
            hasFrontmatter: i === 0 && frontmatter !== null,
          },
        });
      }
    } else {
      const hierarchy = getHeaderHierarchy(headers, start);

      chunks.push({
        content: sectionText,
        index: chunks.length,
        startChar: contentStart + start,
        endChar: contentStart + end,
        estimatedTokens: estimateTokens(sectionText),
        startLine: getLineNumber(text, contentStart + start),
        endLine: getLineNumber(text, contentStart + end),
        metadata: {
          headerHierarchy: hierarchy.length > 0 ? hierarchy : undefined,
          hasFrontmatter: i === 0 && frontmatter !== null,
        },
      });
    }
  }

  // Prepend frontmatter to first chunk if exists
  if (frontmatter && chunks.length > 0) {
    const firstChunk = chunks[0]!;
    firstChunk.content = frontmatter.content + '\n\n' + firstChunk.content;
    firstChunk.startChar = 0;
    firstChunk.estimatedTokens = estimateTokens(firstChunk.content);
  }

  return chunks;
}

/**
 * Code boundary information from AST.
 */
interface CodeBoundary {
  start: number;
  end: number;
  type: 'function' | 'arrow_function' | 'class' | 'method' | 'import' | 'export' | 'interface' | 'type' | 'enum';
  name?: string;
  className?: string;
}

/**
 * Chunk code files using AST parsing for better boundaries.
 * Falls back to regular text chunking on parse errors.
 *
 * Supported extensions: .js, .jsx, .ts, .tsx
 */
export function chunkCode(
  code: string,
  extension: string,
  options: ChunkOptions
): Chunk[] {
  // Handle empty input
  if (!code || code.trim().length === 0) {
    return [];
  }

  // Check if extension is supported
  const supportedExtensions = ['.js', '.jsx', '.ts', '.tsx', '.sol', '.go', '.rs', '.py', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.java'];
  if (!supportedExtensions.includes(extension)) {
    // Fallback to text chunking
    const chunks = chunkText(code, options);
    return chunks.map(chunk => ({
      ...chunk,
      metadata: { ...chunk.metadata, fallback: true },
    }));
  }

  // Try AST parsing
  try {
    const boundaries = parseCodeBoundaries(code, extension);
    return createChunksFromBoundaries(code, boundaries, options);
  } catch (error) {
    // Parse error - fallback to text chunking
    const chunks = chunkText(code, options);
    return chunks.map(chunk => ({
      ...chunk,
      metadata: { ...chunk.metadata, fallback: true },
    }));
  }
}

/**
 * Parse code to find function/class/etc boundaries using AST.
 */
function parseCodeBoundaries(code: string, extension: string): CodeBoundary[] {
  // Dynamic imports to avoid bundling issues
  const parser = require('@babel/parser');
  const traverse = require('@babel/traverse').default;

  // Determine parser plugins based on extension
  const plugins: string[] = ['jsx'];
  if (extension === '.ts' || extension === '.tsx') {
    plugins.push('typescript');
    plugins.push('decorators-legacy');
  }

  // Parse the code
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins,
    errorRecovery: false,
  });

  const boundaries: CodeBoundary[] = [];
  const importExportBoundaries: CodeBoundary[] = [];

  // Traverse AST to find boundaries
  traverse(ast, {
    // Function declarations
    FunctionDeclaration(path: unknown) {
      const node = (path as { node: { start: number; end: number; id?: { name: string } } }).node;
      if (node.start !== null && node.end !== null) {
        boundaries.push({
          start: node.start,
          end: node.end,
          type: 'function',
          name: node.id?.name,
        });
      }
    },

    // Arrow functions and function expressions
    VariableDeclaration(path: unknown) {
      const node = (path as { node: { start: number; end: number; declarations: unknown[] } }).node;
      const pathTyped = path as { node: { declarations: { id?: { name?: string }; init?: { type: string; start: number; end: number } }[] } };

      for (const decl of pathTyped.node.declarations) {
        if (decl.init && (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')) {
          if (node.start !== null && node.end !== null) {
            boundaries.push({
              start: node.start,
              end: node.end,
              type: 'arrow_function',
              name: decl.id?.name,
            });
          }
        }
      }
    },

    // Class declarations
    ClassDeclaration(path: unknown) {
      const node = (path as { node: { start: number; end: number; id?: { name: string } } }).node;
      if (node.start !== null && node.end !== null) {
        boundaries.push({
          start: node.start,
          end: node.end,
          type: 'class',
          name: node.id?.name,
        });
      }
    },

    // Import declarations
    ImportDeclaration(path: unknown) {
      const node = (path as { node: { start: number; end: number } }).node;
      if (node.start !== null && node.end !== null) {
        importExportBoundaries.push({
          start: node.start,
          end: node.end,
          type: 'import',
        });
      }
    },

    // Export declarations
    ExportNamedDeclaration(path: unknown) {
      const node = (path as { node: { start: number; end: number } }).node;
      if (node.start !== null && node.end !== null) {
        importExportBoundaries.push({
          start: node.start,
          end: node.end,
          type: 'export',
        });
      }
    },

    ExportDefaultDeclaration(path: unknown) {
      const node = (path as { node: { start: number; end: number } }).node;
      if (node.start !== null && node.end !== null) {
        importExportBoundaries.push({
          start: node.start,
          end: node.end,
          type: 'export',
        });
      }
    },

    // TypeScript interfaces
    TSInterfaceDeclaration(path: unknown) {
      const node = (path as { node: { start: number; end: number; id?: { name: string } } }).node;
      if (node.start !== null && node.end !== null) {
        boundaries.push({
          start: node.start,
          end: node.end,
          type: 'interface',
          name: node.id?.name,
        });
      }
    },

    // TypeScript type aliases
    TSTypeAliasDeclaration(path: unknown) {
      const node = (path as { node: { start: number; end: number; id?: { name: string } } }).node;
      if (node.start !== null && node.end !== null) {
        boundaries.push({
          start: node.start,
          end: node.end,
          type: 'type',
          name: node.id?.name,
        });
      }
    },

    // TypeScript enums
    TSEnumDeclaration(path: unknown) {
      const node = (path as { node: { start: number; end: number; id?: { name: string } } }).node;
      if (node.start !== null && node.end !== null) {
        boundaries.push({
          start: node.start,
          end: node.end,
          type: 'enum',
          name: node.id?.name,
        });
      }
    },
  });

  // Group consecutive imports/exports together
  const groupedImportExports = groupConsecutiveBoundaries(importExportBoundaries, code);

  // Combine and sort all boundaries
  const allBoundaries = [...boundaries, ...groupedImportExports].sort((a, b) => a.start - b.start);

  return allBoundaries;
}

/**
 * Group consecutive import/export statements together.
 */
function groupConsecutiveBoundaries(boundaries: CodeBoundary[], code: string): CodeBoundary[] {
  if (boundaries.length === 0) return [];

  const grouped: CodeBoundary[] = [];
  let currentGroup: CodeBoundary | null = null;

  for (const boundary of boundaries.sort((a, b) => a.start - b.start)) {
    if (!currentGroup) {
      currentGroup = { ...boundary };
    } else {
      // Check if boundaries are consecutive (only whitespace/newlines between)
      const between = code.slice(currentGroup.end, boundary.start);
      const isConsecutive = /^\s*$/.test(between);

      if (isConsecutive) {
        // Extend current group
        currentGroup.end = boundary.end;
      } else {
        // Start new group
        grouped.push(currentGroup);
        currentGroup = { ...boundary };
      }
    }
  }

  if (currentGroup) {
    grouped.push(currentGroup);
  }

  return grouped;
}

/**
 * Create chunks from code boundaries.
 */
function createChunksFromBoundaries(
  code: string,
  boundaries: CodeBoundary[],
  options: ChunkOptions
): Chunk[] {
  if (boundaries.length === 0) {
    // No boundaries found, use text chunking
    return chunkText(code, options);
  }

  const chunks: Chunk[] = [];
  const maxChars = tokensToChars(options.maxTokens);

  let currentChunkBoundaries: CodeBoundary[] = [];
  let currentSize = 0;

  for (const boundary of boundaries) {
    const boundarySize = boundary.end - boundary.start;
    const boundaryTokens = estimateTokens(code.slice(boundary.start, boundary.end));

    // If single boundary is too large, it needs special handling
    if (boundaryTokens > options.maxTokens) {
      // Flush current chunk if any
      if (currentChunkBoundaries.length > 0) {
        chunks.push(createChunkFromBoundaries(code, currentChunkBoundaries, chunks.length));
        currentChunkBoundaries = [];
        currentSize = 0;
      }

      // Split large boundary using text chunking
      const start = boundary.start;
      const end = boundary.end;
      const content = code.slice(start, end);
      const subChunks = chunkText(content, options);

      for (const subChunk of subChunks) {
        chunks.push({
          ...subChunk,
          index: chunks.length,
          startChar: start + subChunk.startChar,
          endChar: start + subChunk.endChar,
          metadata: {
            ...boundary,
            fallback: true,
          },
        });
      }
    } else if (currentSize + boundarySize > maxChars && currentChunkBoundaries.length > 0) {
      // Current chunk is full, flush it
      chunks.push(createChunkFromBoundaries(code, currentChunkBoundaries, chunks.length));
      currentChunkBoundaries = [boundary];
      currentSize = boundarySize;
    } else {
      // Add to current chunk
      currentChunkBoundaries.push(boundary);
      currentSize += boundarySize;
    }
  }

  // Flush remaining boundaries
  if (currentChunkBoundaries.length > 0) {
    chunks.push(createChunkFromBoundaries(code, currentChunkBoundaries, chunks.length));
  }

  return chunks;
}

/**
 * Create a single chunk from multiple boundaries.
 */
function createChunkFromBoundaries(
  code: string,
  boundaries: CodeBoundary[],
  index: number
): Chunk {
  const start = boundaries[0]!.start;
  const end = boundaries[boundaries.length - 1]!.end;
  const content = code.slice(start, end);

  // Use metadata from first boundary (most significant)
  const primaryBoundary = boundaries[0]!;

  return {
    content,
    index,
    startChar: start,
    endChar: end,
    estimatedTokens: estimateTokens(content),
    startLine: getLineNumber(code, start),
    endLine: getLineNumber(code, end),
    metadata: {
      type: primaryBoundary.type,
      name: primaryBoundary.name,
      className: primaryBoundary.className,
    },
  };
}
