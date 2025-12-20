import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createEmbeddingClient,
  parseEmbeddingModelString,
  detectBestEmbeddingProvider,
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

// Mock the ai module
vi.mock('ai', () => ({
  embedMany: vi.fn(),
}));

// Mock the voyage client
vi.mock('voyageai', () => ({
  VoyageAIClient: vi.fn().mockImplementation(() => ({
    embed: vi.fn(),
  })),
}));

import ollama from 'ollama';
import { embedMany } from 'ai';

const mockOllama = vi.mocked(ollama);
const mockEmbedMany = vi.mocked(embedMany);

describe('parseEmbeddingModelString', () => {
  it('should parse provider:model format', () => {
    expect(parseEmbeddingModelString('openai:text-embedding-3-small')).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
    });
  });

  it('should parse cohere provider', () => {
    expect(parseEmbeddingModelString('cohere:embed-english-v3.0')).toEqual({
      provider: 'cohere',
      model: 'embed-english-v3.0',
    });
  });

  it('should parse voyage provider', () => {
    expect(parseEmbeddingModelString('voyage:voyage-code-3')).toEqual({
      provider: 'voyage',
      model: 'voyage-code-3',
    });
  });

  it('should assume ollama for model without provider', () => {
    expect(parseEmbeddingModelString('mxbai-embed-large')).toEqual({
      provider: 'ollama',
      model: 'mxbai-embed-large',
    });
  });

  it('should parse ollama with explicit provider', () => {
    expect(parseEmbeddingModelString('ollama:nomic-embed-text')).toEqual({
      provider: 'ollama',
      model: 'nomic-embed-text',
    });
  });

  it('should throw for unsupported provider', () => {
    expect(() => parseEmbeddingModelString('unsupported:model')).toThrow(
      'Unsupported embedding provider'
    );
  });

  it('should throw for empty model', () => {
    expect(() => parseEmbeddingModelString('openai:')).toThrow(
      'Model name cannot be empty'
    );
  });
});

describe('detectBestEmbeddingProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
    delete process.env.COHERE_API_KEY;
    delete process.env.VOYAGE_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should prioritize OpenAI when available', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.COHERE_API_KEY = 'test-key';
    expect(detectBestEmbeddingProvider()).toBe('openai:text-embedding-3-small');
  });

  it('should use Cohere when OpenAI is not available', () => {
    process.env.COHERE_API_KEY = 'test-key';
    expect(detectBestEmbeddingProvider()).toBe('cohere:embed-english-v3.0');
  });

  it('should use Voyage when OpenAI and Cohere are not available', () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    expect(detectBestEmbeddingProvider()).toBe('voyage:voyage-code-3');
  });

  it('should fallback to Ollama when no API keys are set', () => {
    expect(detectBestEmbeddingProvider()).toBe('ollama:mxbai-embed-large');
  });
});

describe('Ollama embedding client', () => {
  let client: EmbeddingClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createEmbeddingClient({ model: 'ollama:mxbai-embed-large' });
  });

  describe('createEmbeddingClient', () => {
    it('should create a client with the specified model', () => {
      const customClient = createEmbeddingClient({ model: 'ollama:custom-model' });
      expect(customClient.model).toBe('ollama:custom-model');
      expect(customClient.provider).toBe('ollama');
    });

    it('should use default model when not specified (assumes ollama)', () => {
      const defaultClient = createEmbeddingClient();
      expect(defaultClient.model).toBe('ollama:mxbai-embed-large');
      expect(defaultClient.provider).toBe('ollama');
    });

    it('should support model without provider prefix (assumes ollama)', () => {
      const client = createEmbeddingClient({ model: 'nomic-embed-text' });
      expect(client.model).toBe('ollama:nomic-embed-text');
      expect(client.provider).toBe('ollama');
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

    it('should add query prefix for mxbai retrieval queries', async () => {
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
    it('should return known dimensions for common models', async () => {
      const dimensions = await client.getModelDimensions();
      expect(dimensions).toBe(1024); // Known dimension for mxbai-embed-large
    });

    it('should detect dimensions for unknown models', async () => {
      const unknownClient = createEmbeddingClient({ model: 'ollama:unknown-model' });
      const mockEmbedding = new Array(512).fill(0.1);
      mockOllama.embed.mockResolvedValueOnce({
        embeddings: [mockEmbedding],
        model: 'unknown-model',
      });

      const dimensions = await unknownClient.getModelDimensions();

      expect(dimensions).toBe(512);
    });

    it('should throw error when unable to determine dimensions', async () => {
      const unknownClient = createEmbeddingClient({ model: 'ollama:unknown-model' });
      mockOllama.embed.mockRejectedValueOnce(new Error('Model not found'));

      await expect(unknownClient.getModelDimensions()).rejects.toThrow(
        'Failed to determine model dimensions'
      );
    });
  });
});

describe('OpenAI embedding client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create client with correct provider info', () => {
    const client = createEmbeddingClient({ model: 'openai:text-embedding-3-small' });
    expect(client.model).toBe('openai:text-embedding-3-small');
    expect(client.provider).toBe('openai');
  });

  it('should return known dimensions for OpenAI models', async () => {
    const client = createEmbeddingClient({ model: 'openai:text-embedding-3-small' });
    const dimensions = await client.getModelDimensions();
    expect(dimensions).toBe(1536);
  });

  it('should return known dimensions for large model', async () => {
    const client = createEmbeddingClient({ model: 'openai:text-embedding-3-large' });
    const dimensions = await client.getModelDimensions();
    expect(dimensions).toBe(3072);
  });

  it('should check for API key in health check', async () => {
    const client = createEmbeddingClient({ model: 'openai:text-embedding-3-small' });
    const result = await client.healthCheck();
    expect(result.healthy).toBe(true);
  });

  it('should fail health check without API key', async () => {
    delete process.env.OPENAI_API_KEY;
    const client = createEmbeddingClient({ model: 'openai:text-embedding-3-small' });
    const result = await client.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('OPENAI_API_KEY');
  });
});

describe('Cohere embedding client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, COHERE_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create client with correct provider info', () => {
    const client = createEmbeddingClient({ model: 'cohere:embed-english-v3.0' });
    expect(client.model).toBe('cohere:embed-english-v3.0');
    expect(client.provider).toBe('cohere');
  });

  it('should return known dimensions for Cohere models', async () => {
    const client = createEmbeddingClient({ model: 'cohere:embed-english-v3.0' });
    const dimensions = await client.getModelDimensions();
    expect(dimensions).toBe(1024);
  });

  it('should check for API key in health check', async () => {
    const client = createEmbeddingClient({ model: 'cohere:embed-english-v3.0' });
    const result = await client.healthCheck();
    expect(result.healthy).toBe(true);
  });

  it('should fail health check without API key', async () => {
    delete process.env.COHERE_API_KEY;
    const client = createEmbeddingClient({ model: 'cohere:embed-english-v3.0' });
    const result = await client.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('COHERE_API_KEY');
  });
});

describe('Voyage embedding client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, VOYAGE_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create client with correct provider info', () => {
    const client = createEmbeddingClient({ model: 'voyage:voyage-code-3' });
    expect(client.model).toBe('voyage:voyage-code-3');
    expect(client.provider).toBe('voyage');
  });

  it('should return known dimensions for Voyage models', async () => {
    const client = createEmbeddingClient({ model: 'voyage:voyage-code-3' });
    const dimensions = await client.getModelDimensions();
    expect(dimensions).toBe(1024);
  });

  it('should check for API key in health check', async () => {
    const client = createEmbeddingClient({ model: 'voyage:voyage-code-3' });
    const result = await client.healthCheck();
    expect(result.healthy).toBe(true);
  });

  it('should fail health check without API key', async () => {
    delete process.env.VOYAGE_API_KEY;
    const client = createEmbeddingClient({ model: 'voyage:voyage-code-3' });
    const result = await client.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('VOYAGE_API_KEY');
  });
});

describe('auto detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
    delete process.env.COHERE_API_KEY;
    delete process.env.VOYAGE_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should auto-detect OpenAI when key is set', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const client = createEmbeddingClient({ model: 'auto' });
    expect(client.provider).toBe('openai');
    expect(client.model).toBe('openai:text-embedding-3-small');
  });

  it('should auto-detect Cohere when only Cohere key is set', () => {
    process.env.COHERE_API_KEY = 'test-key';
    const client = createEmbeddingClient({ model: 'auto' });
    expect(client.provider).toBe('cohere');
    expect(client.model).toBe('cohere:embed-english-v3.0');
  });

  it('should auto-detect Voyage when only Voyage key is set', () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    const client = createEmbeddingClient({ model: 'auto' });
    expect(client.provider).toBe('voyage');
    expect(client.model).toBe('voyage:voyage-code-3');
  });

  it('should fallback to Ollama when no keys are set', () => {
    const client = createEmbeddingClient({ model: 'auto' });
    expect(client.provider).toBe('ollama');
    expect(client.model).toBe('ollama:mxbai-embed-large');
  });
});
