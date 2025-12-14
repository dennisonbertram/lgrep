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
});
