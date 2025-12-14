import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createEmbeddingClient,
  type EmbeddingClient,
  type EmbeddingResult,
} from './embeddings.js';

// Mock the ollama module
vi.mock('ollama', () => ({
  default: {
    embed: vi.fn(),
    list: vi.fn(),
    show: vi.fn(),
  },
}));

import ollama from 'ollama';

const mockOllama = vi.mocked(ollama);

describe('embeddings client', () => {
  let client: EmbeddingClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createEmbeddingClient({ model: 'mxbai-embed-large' });
  });

  describe('createEmbeddingClient', () => {
    it('should create a client with the specified model', () => {
      const customClient = createEmbeddingClient({ model: 'custom-model' });
      expect(customClient.model).toBe('custom-model');
    });

    it('should use default model when not specified', () => {
      const defaultClient = createEmbeddingClient();
      expect(defaultClient.model).toBe('mxbai-embed-large');
    });
  });

  describe('embed', () => {
    it('should generate embeddings for a single text', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockOllama.embed.mockResolvedValueOnce({
        embeddings: [mockEmbedding],
        model: 'mxbai-embed-large',
      });

      const result = await client.embed('test text');

      expect(result.embeddings).toHaveLength(1);
      expect(result.embeddings[0]).toEqual(mockEmbedding);
      expect(mockOllama.embed).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        input: 'test text',
      });
    });

    it('should generate embeddings for multiple texts', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      mockOllama.embed.mockResolvedValueOnce({
        embeddings: mockEmbeddings,
        model: 'mxbai-embed-large',
      });

      const result = await client.embed(['text 1', 'text 2']);

      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings).toEqual(mockEmbeddings);
    });

    it('should add query prefix for retrieval queries', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockOllama.embed.mockResolvedValueOnce({
        embeddings: [mockEmbedding],
        model: 'mxbai-embed-large',
      });

      await client.embedQuery('search query');

      expect(mockOllama.embed).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        input: 'Represent this sentence for searching relevant passages: search query',
      });
    });
  });

  describe('healthCheck', () => {
    it('should return true when Ollama is available and model exists', async () => {
      mockOllama.list.mockResolvedValueOnce({
        models: [
          { name: 'mxbai-embed-large', model: 'mxbai-embed-large:latest', modified_at: new Date(), size: 1000, digest: 'abc', details: {} as never },
        ],
      });

      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.modelAvailable).toBe(true);
    });

    it('should return false when Ollama is not available', async () => {
      mockOllama.list.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('should indicate when model is not available', async () => {
      mockOllama.list.mockResolvedValueOnce({
        models: [
          { name: 'other-model', model: 'other-model:latest', modified_at: new Date(), size: 1000, digest: 'abc', details: {} as never },
        ],
      });

      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.modelAvailable).toBe(false);
    });
  });

  describe('getModelDimensions', () => {
    it('should detect embedding dimensions by generating a test embedding', async () => {
      // Generate a mock embedding with 1024 dimensions
      const mockEmbedding = new Array(1024).fill(0.1);
      mockOllama.embed.mockResolvedValueOnce({
        embeddings: [mockEmbedding],
        model: 'mxbai-embed-large',
      });

      const dimensions = await client.getModelDimensions();

      expect(dimensions).toBe(1024);
    });

    it('should throw error when unable to determine dimensions', async () => {
      mockOllama.embed.mockRejectedValueOnce(new Error('Model not found'));

      await expect(client.getModelDimensions()).rejects.toThrow(
        'Failed to determine model dimensions'
      );
    });
  });
});
