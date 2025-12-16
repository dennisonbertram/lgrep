import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createSummarizerClient, type SummarizerClient } from './summarizer.js';

// Mock fetch for all tests
global.fetch = vi.fn();

// Mock AI provider module
vi.mock('./ai-provider.js', () => ({
  createAIProvider: vi.fn(),
  parseModelString: vi.fn((model: string) => {
    const colonIndex = model.indexOf(':');
    return {
      provider: model.slice(0, colonIndex),
      model: model.slice(colonIndex + 1),
    };
  }),
  detectBestProvider: vi.fn(() => 'ollama:llama3.2:3b'),
}));

describe('SummarizerClient', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('model configuration', () => {
    it('should handle auto model detection', async () => {
      const { detectBestProvider } = await import('./ai-provider.js');
      vi.mocked(detectBestProvider).mockReturnValueOnce('groq:llama-3.1-8b-instant');

      // Mock Ollama response (since it will fallback to ollama for now)
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: 'Test summary' } }),
      } as Response);

      const client = createSummarizerClient({ model: 'auto' });

      await client.summarizeSymbol({
        name: 'test',
        kind: 'function',
        code: 'function test() {}',
      });

      expect(detectBestProvider).toHaveBeenCalled();
    });

    it('should accept provider:model format', () => {
      const client = createSummarizerClient({ model: 'groq:llama-3.1-8b-instant' });
      expect(client.model).toBe('groq:llama-3.1-8b-instant');
    });

    it('should accept ollama:model format for backward compatibility', () => {
      const client = createSummarizerClient({ model: 'ollama:llama3.2:3b' });
      expect(client.model).toBe('ollama:llama3.2:3b');
    });
  });

  describe('summarizeSymbol', () => {
    it('should use AI SDK provider for non-Ollama models', async () => {
      const { createAIProvider } = await import('./ai-provider.js');

      const mockProvider = {
        generateText: vi.fn().mockResolvedValue('Uses Groq to generate summary'),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, provider: 'groq' }),
      };

      vi.mocked(createAIProvider).mockReturnValueOnce(mockProvider);

      const client = createSummarizerClient({ model: 'groq:llama-3.1-8b-instant' });

      const summary = await client.summarizeSymbol({
        name: 'testFunction',
        kind: 'function',
        code: 'function testFunction() { return true; }',
      });

      expect(createAIProvider).toHaveBeenCalledWith({
        model: 'groq:llama-3.1-8b-instant',
        timeout: 30000,
      });
      expect(mockProvider.generateText).toHaveBeenCalled();
      expect(summary).toBe('Uses Groq to generate summary');
    });

    it('should return a concise summary of a symbol', async () => {
      // Mock successful Ollama response
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: 'Calculates sum of item prices in array',
          },
        }),
      } as Response);

      const client = createSummarizerClient({
        model: 'ollama:llama3.2:3b',
        host: 'http://localhost:11434',
      });

      const summary = await client.summarizeSymbol({
        name: 'calculateTotal',
        kind: 'function',
        signature: 'function calculateTotal(items: Item[]): number',
        code: 'function calculateTotal(items: Item[]) { return items.reduce((sum, item) => sum + item.price, 0); }',
        documentation: 'Calculates the total price of all items',
      });

      // Should return a string summary
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThanOrEqual(100);
    });

    it('should respect maxLength option', async () => {
      // Mock response with a long summary
      const longSummary = 'This is a very long summary that exceeds the maximum length limit and should be truncated to fit within the specified character count';

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: longSummary,
          },
        }),
      } as Response);

      const client = createSummarizerClient({
        model: 'ollama:llama3.2:3b',
        maxLength: 50,
      });

      const summary = await client.summarizeSymbol({
        name: 'test',
        kind: 'function',
        code: 'function test() {}',
      });

      expect(summary.length).toBeLessThanOrEqual(50);
    });
  });

  describe('suggestApproach', () => {
    it('should return numbered implementation steps', async () => {
      // Mock Ollama response with JSON steps
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              {
                step: 1,
                description: 'Add input validation',
                targetFiles: ['src/validator.ts'],
              },
              {
                step: 2,
                description: 'Implement core logic',
                targetFiles: ['src/core/processor.ts'],
              },
              {
                step: 3,
                description: 'Add tests',
                targetFiles: ['src/core/processor.test.ts'],
              },
            ]),
          },
        }),
      } as Response);

      const client = createSummarizerClient();

      const steps = await client.suggestApproach('Add user authentication', {
        relevantSymbols: [
          { name: 'User', kind: 'class', summary: 'Represents a user' },
        ],
        relevantFiles: [{ path: 'src/models/user.ts', symbols: ['User'] }],
      });

      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[0]).toHaveProperty('step');
      expect(steps[0]).toHaveProperty('description');
      expect(steps[0]).toHaveProperty('targetFiles');
      expect(Array.isArray(steps[0].targetFiles)).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('should detect when Ollama is healthy and model is available', async () => {
      // Mock successful health check
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3.2:3b' },
          ],
        }),
      } as Response);

      const client = createSummarizerClient({
        model: 'ollama:llama3.2:3b',
      });

      const health = await client.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.modelAvailable).toBe(true);
    });

    it('should detect when model is not available', async () => {
      // Mock response without the target model
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3:8b' },
          ],
        }),
      } as Response);

      const client = createSummarizerClient({
        model: 'ollama:llama3.2:3b',
      });

      const health = await client.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.modelAvailable).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle Ollama connection errors gracefully', async () => {
      // Mock network error
      vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const client = createSummarizerClient();

      await expect(
        client.summarizeSymbol({
          name: 'test',
          kind: 'function',
          code: 'function test() {}',
        })
      ).rejects.toThrow();
    });

    it('should handle timeout gracefully', async () => {
      // Mock timeout by delaying response
      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 100);
          })
      );

      const client = createSummarizerClient({
        timeout: 50,
      });

      await expect(
        client.summarizeSymbol({
          name: 'test',
          kind: 'function',
          code: 'function test() {}',
        })
      ).rejects.toThrow();
    });

    it('should handle non-OK HTTP responses', async () => {
      // Mock 500 error
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const client = createSummarizerClient();

      await expect(
        client.summarizeSymbol({
          name: 'test',
          kind: 'function',
          code: 'function test() {}',
        })
      ).rejects.toThrow();
    });
  });
});
