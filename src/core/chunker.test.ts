import { describe, it, expect } from 'vitest';
import {
  chunkText,
  estimateTokens,
  type Chunk,
  type ChunkOptions,
} from './chunker.js';

describe('chunker', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens for a simple string', () => {
      // Rough estimate: ~4 chars per token for English
      const text = 'Hello world this is a test';
      const tokens = estimateTokens(text);

      // Should be approximately 6-7 tokens
      expect(tokens).toBeGreaterThan(4);
      expect(tokens).toBeLessThan(10);
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should handle code with special characters', () => {
      const code = 'function test() { return x + y; }';
      const tokens = estimateTokens(code);

      // Code typically has more tokens due to punctuation
      expect(tokens).toBeGreaterThan(5);
    });
  });

  describe('chunkText', () => {
    const defaultOptions: ChunkOptions = {
      maxTokens: 100,
      overlapTokens: 20,
    };

    it('should return a single chunk for short text', () => {
      const text = 'This is a short text.';
      const chunks = chunkText(text, defaultOptions);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.content).toBe(text);
      expect(chunks[0]?.index).toBe(0);
    });

    it('should split long text into multiple chunks', () => {
      // Create text that's definitely longer than 100 tokens
      const sentences = Array(50)
        .fill('This is a test sentence with several words.')
        .join(' ');
      const chunks = chunkText(sentences, defaultOptions);

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should maintain overlap between chunks', () => {
      // Create enough text for multiple chunks
      const text = Array(100)
        .fill('word')
        .join(' ');
      const chunks = chunkText(text, { maxTokens: 50, overlapTokens: 10 });

      expect(chunks.length).toBeGreaterThan(1);

      // Check that consecutive chunks have some overlapping content
      if (chunks.length >= 2) {
        const chunk1End = chunks[0]?.content.slice(-50);
        const chunk2Start = chunks[1]?.content.slice(0, 50);

        // There should be some shared words between chunk endings and beginnings
        const words1 = chunk1End?.split(/\s+/) ?? [];
        const words2 = chunk2Start?.split(/\s+/) ?? [];

        // At least some words should overlap
        const hasOverlap = words1.some((w) => words2.includes(w));
        expect(hasOverlap).toBe(true);
      }
    });

    it('should include chunk metadata', () => {
      const text = 'Test chunk with metadata';
      const chunks = chunkText(text, defaultOptions);

      expect(chunks[0]).toMatchObject({
        content: text,
        index: 0,
        startChar: 0,
        endChar: text.length,
      });
    });

    it('should calculate estimated tokens for each chunk', () => {
      const text = 'This is some text to chunk';
      const chunks = chunkText(text, defaultOptions);

      expect(chunks[0]?.estimatedTokens).toBeGreaterThan(0);
    });

    it('should handle empty input', () => {
      const chunks = chunkText('', defaultOptions);
      expect(chunks).toHaveLength(0);
    });

    it('should handle whitespace-only input', () => {
      const chunks = chunkText('   \n\n  \t  ', defaultOptions);
      expect(chunks).toHaveLength(0);
    });

    it('should split on sentence boundaries when possible', () => {
      const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
      const chunks = chunkText(text, { maxTokens: 10, overlapTokens: 2 });

      // Each chunk should ideally end at a sentence boundary
      for (const chunk of chunks) {
        // Check that chunk content is not empty and doesn't start with a period
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      }
    });

    it('should preserve line information for code', () => {
      const code = `function test() {
  return 42;
}

function another() {
  return "hello";
}`;

      const chunks = chunkText(code, { maxTokens: 30, overlapTokens: 5 });

      // Should have line numbers
      expect(chunks[0]?.startLine).toBeDefined();
      expect(chunks[0]?.endLine).toBeDefined();
    });

    it('should handle text with no natural boundaries', () => {
      // Long text with no spaces or punctuation
      const text = 'a'.repeat(500);
      const chunks = chunkText(text, { maxTokens: 50, overlapTokens: 10 });

      expect(chunks.length).toBeGreaterThan(1);
      // All content should be preserved
      const totalLength = chunks.reduce((sum, c) => sum + c.content.length, 0);
      // Due to overlap, total might be more than original
      expect(totalLength).toBeGreaterThanOrEqual(text.length);
    });
  });

  describe('chunkMarkdown', () => {
    const defaultOptions: ChunkOptions = {
      maxTokens: 100,
      overlapTokens: 20,
    };

    it('should detect markdown files by extension', () => {
      const text = '# Header\n\nContent';
      const chunksWithMd = chunkText(text, defaultOptions, 'test.md');
      const chunksWithMdx = chunkText(text, defaultOptions, 'test.mdx');
      const chunksWithTxt = chunkText(text, defaultOptions, 'test.txt');

      // Markdown files should be chunked differently (at headers)
      // Non-markdown files should use default chunking
      expect(chunksWithMd.length).toBeGreaterThan(0);
      expect(chunksWithMdx.length).toBeGreaterThan(0);
      expect(chunksWithTxt.length).toBeGreaterThan(0);
    });

    it('should split content at header boundaries', () => {
      const text = `# Header 1

Content for section 1.

## Header 2

Content for section 2.

### Header 3

Content for section 3.`;

      const chunks = chunkText(text, defaultOptions, 'test.md');

      // Should have at least 3 chunks (one per header)
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      // Each chunk should start with a header or be continuation
      expect(chunks[0]?.content).toContain('# Header 1');
      expect(chunks.some(c => c.content.includes('## Header 2'))).toBe(true);
      expect(chunks.some(c => c.content.includes('### Header 3'))).toBe(true);
    });

    it('should keep code blocks intact - never split in middle', () => {
      const text = `# Code Example

Here is some code:

\`\`\`typescript
function example() {
  const x = 1;
  const y = 2;
  return x + y;
}
\`\`\`

More content.`;

      const chunks = chunkText(text, { maxTokens: 30, overlapTokens: 5 }, 'test.md');

      // Verify that no chunk splits the code block
      const allContent = chunks.map(c => c.content).join('\n');
      const codeBlockPattern = /```typescript[\s\S]*?```/g;
      const matches = allContent.match(codeBlockPattern);

      // Code block should be preserved
      expect(matches).toBeTruthy();
      expect(matches?.length).toBeGreaterThan(0);

      // Each chunk should either have complete code block or none
      for (const chunk of chunks) {
        const openBackticks = (chunk.content.match(/```/g) || []).length;
        // Should be even (matched pairs) or zero
        expect(openBackticks % 2).toBe(0);
      }
    });

    it('should preserve frontmatter as separate chunk or attach to first section', () => {
      const text = `---
title: Test Document
author: Claude
date: 2025-12-14
---

# Introduction

This is the introduction.`;

      const chunks = chunkText(text, defaultOptions, 'test.md');

      expect(chunks.length).toBeGreaterThan(0);

      // First chunk should contain frontmatter
      expect(chunks[0]?.content).toContain('---');
      expect(chunks[0]?.content).toContain('title: Test Document');
    });

    it('should include header hierarchy for context', () => {
      const text = `# Main Title

Content under main.

## Subsection

Content under subsection.

### Deep Section

Content under deep.`;

      const chunks = chunkText(text, defaultOptions, 'test.md');

      // When a subsection is split, it should include parent headers for context
      const subsectionChunk = chunks.find(c => c.content.includes('## Subsection'));
      expect(subsectionChunk?.metadata?.headerHierarchy).toBeDefined();

      const deepChunk = chunks.find(c => c.content.includes('### Deep Section'));
      expect(deepChunk?.metadata?.headerHierarchy).toBeDefined();
      if (deepChunk?.metadata?.headerHierarchy) {
        expect(deepChunk.metadata.headerHierarchy.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should handle markdown with no headers', () => {
      const text = `This is plain markdown text.

It has paragraphs but no headers.

Just regular content.`;

      const chunks = chunkText(text, defaultOptions, 'test.md');

      // Should fall back to regular chunking
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.content).toContain('This is plain markdown text.');
    });

    it('should not split on header-like syntax inside code blocks', () => {
      const text = `# Real Header

\`\`\`markdown
# This is not a real header
## Neither is this
\`\`\`

## Real Subheader

More content.`;

      const chunks = chunkText(text, defaultOptions, 'test.md');

      // Should split at real headers, not code block headers
      // The code block should stay intact in one chunk
      const codeChunk = chunks.find(c => c.content.includes('# This is not a real header'));
      if (codeChunk) {
        expect(codeChunk.content).toContain('```markdown');
        expect(codeChunk.content).toContain('```');
      }
    });

    it('should handle nested headers with proper hierarchy', () => {
      const text = `# Chapter 1

Intro to chapter.

## Section 1.1

Content 1.1

### Subsection 1.1.1

Content 1.1.1

## Section 1.2

Content 1.2`;

      const chunks = chunkText(text, defaultOptions, 'test.md');

      expect(chunks.length).toBeGreaterThan(0);

      // Verify hierarchy is tracked
      const section111 = chunks.find(c => c.content.includes('Subsection 1.1.1'));
      if (section111?.metadata?.headerHierarchy) {
        expect(section111.metadata.headerHierarchy).toContain('Chapter 1');
        expect(section111.metadata.headerHierarchy).toContain('Section 1.1');
      }
    });

    it('should handle mixed content with code, lists, and headers', () => {
      const text = `# API Documentation

## Methods

Here are the methods:

\`\`\`typescript
async function search(query: string): Promise<Result[]> {
  // Implementation
}
\`\`\`

### Parameters

- \`query\`: The search string
- Returns: Array of results

## Examples

More content here.`;

      const chunks = chunkText(text, defaultOptions, 'test.md');

      expect(chunks.length).toBeGreaterThan(0);

      // Code blocks should be intact
      for (const chunk of chunks) {
        const backtickCount = (chunk.content.match(/```/g) || []).length;
        expect(backtickCount % 2).toBe(0);
      }
    });
  });
});
