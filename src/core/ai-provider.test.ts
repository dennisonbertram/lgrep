import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseModelString,
  detectBestProvider,
  createAIProvider,
  type AIProviderConfig,
} from './ai-provider.js';

describe('parseModelString', () => {
  it('should parse groq model string', () => {
    const result = parseModelString('groq:llama-3.1-8b-instant');
    expect(result).toEqual({
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
    });
  });

  it('should parse anthropic model string', () => {
    const result = parseModelString('anthropic:claude-3-5-haiku-latest');
    expect(result).toEqual({
      provider: 'anthropic',
      model: 'claude-3-5-haiku-latest',
    });
  });

  it('should parse openai model string', () => {
    const result = parseModelString('openai:gpt-4o-mini');
    expect(result).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
  });

  it('should parse ollama model string', () => {
    const result = parseModelString('ollama:llama3.2:3b');
    expect(result).toEqual({
      provider: 'ollama',
      model: 'llama3.2:3b',
    });
  });

  it('should parse model with colon in name', () => {
    const result = parseModelString('ollama:llama3.2:3b');
    expect(result).toEqual({
      provider: 'ollama',
      model: 'llama3.2:3b',
    });
  });

  it('should throw error for invalid format', () => {
    expect(() => parseModelString('invalid-format')).toThrow(
      'Invalid model string format'
    );
  });

  it('should throw error for empty provider', () => {
    expect(() => parseModelString(':model-name')).toThrow(
      'Invalid model string format'
    );
  });

  it('should throw error for empty model', () => {
    expect(() => parseModelString('provider:')).toThrow(
      'Invalid model string format'
    );
  });
});

describe('detectBestProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should prefer Groq if API key is set', () => {
    process.env.GROQ_API_KEY = 'test-key';
    const result = detectBestProvider();
    expect(result).toBe('groq:llama-3.1-8b-instant');
  });

  it('should prefer Anthropic if no Groq key', () => {
    delete process.env.GROQ_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const result = detectBestProvider();
    expect(result).toBe('anthropic:claude-3-5-haiku-latest');
  });

  it('should prefer OpenAI if no Groq or Anthropic keys', () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    const result = detectBestProvider();
    expect(result).toBe('openai:gpt-4o-mini');
  });

  it('should fallback to Ollama if no API keys', () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = detectBestProvider();
    expect(result).toBe('ollama:llama3.2:3b');
  });

  it('should prefer Groq even if other keys exist', () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    const result = detectBestProvider();
    expect(result).toBe('groq:llama-3.1-8b-instant');
  });
});

describe('createAIProvider', () => {
  describe('configuration', () => {
    it('should create provider with default timeout', () => {
      const config: AIProviderConfig = {
        model: 'ollama:llama3.2:3b',
      };
      const provider = createAIProvider(config);
      expect(provider).toBeDefined();
    });

    it('should create provider with custom timeout', () => {
      const config: AIProviderConfig = {
        model: 'groq:llama-3.1-8b-instant',
        timeout: 5000,
      };
      const provider = createAIProvider(config);
      expect(provider).toBeDefined();
    });

    it('should throw error for unsupported provider', () => {
      const config: AIProviderConfig = {
        model: 'unsupported:model',
      };
      expect(() => createAIProvider(config)).toThrow('Unsupported AI provider');
    });
  });

  describe('provider interface', () => {
    it('should return provider with generateText method', () => {
      const config: AIProviderConfig = {
        model: 'ollama:llama3.2:3b',
      };
      const provider = createAIProvider(config);
      expect(provider.generateText).toBeDefined();
      expect(typeof provider.generateText).toBe('function');
    });

    it('should return provider with healthCheck method', () => {
      const config: AIProviderConfig = {
        model: 'ollama:llama3.2:3b',
      };
      const provider = createAIProvider(config);
      expect(provider.healthCheck).toBeDefined();
      expect(typeof provider.healthCheck).toBe('function');
    });
  });

  describe('generateText', () => {
    beforeEach(() => {
      // Mock global fetch for Ollama tests
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should generate text with Ollama provider', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          message: { content: 'Generated text response' },
        }),
      };
      vi.mocked(global.fetch).mockResolvedValueOnce(
        mockResponse as unknown as Response
      );

      const config: AIProviderConfig = {
        model: 'ollama:llama3.2:3b',
      };
      const provider = createAIProvider(config);
      const result = await provider.generateText('Test prompt');

      expect(result).toBe('Generated text response');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('Test prompt'),
        })
      );
    });

    it('should handle Ollama timeout', async () => {
      vi.mocked(global.fetch).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AbortError')), 100);
          })
      );

      const config: AIProviderConfig = {
        model: 'ollama:llama3.2:3b',
        timeout: 50,
      };
      const provider = createAIProvider(config);

      await expect(provider.generateText('Test')).rejects.toThrow();
    });

    it('should handle Ollama error responses', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
      vi.mocked(global.fetch).mockResolvedValueOnce(
        mockResponse as unknown as Response
      );

      const config: AIProviderConfig = {
        model: 'ollama:llama3.2:3b',
      };
      const provider = createAIProvider(config);

      await expect(provider.generateText('Test')).rejects.toThrow(
        'Ollama request failed'
      );
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return healthy status for Ollama', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          models: [{ name: 'llama3.2:3b' }],
        }),
      };
      vi.mocked(global.fetch).mockResolvedValueOnce(
        mockResponse as unknown as Response
      );

      const config: AIProviderConfig = {
        model: 'ollama:llama3.2:3b',
      };
      const provider = createAIProvider(config);
      const result = await provider.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.provider).toBe('ollama');
    });

    it('should return unhealthy status on Ollama connection error', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(
        new Error('Connection refused')
      );

      const config: AIProviderConfig = {
        model: 'ollama:llama3.2:3b',
      };
      const provider = createAIProvider(config);
      const result = await provider.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.provider).toBe('ollama');
    });

    it('should include provider name in health check result', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ models: [] }),
      };
      vi.mocked(global.fetch).mockResolvedValueOnce(
        mockResponse as unknown as Response
      );

      const config: AIProviderConfig = {
        model: 'ollama:llama3.2:3b',
      };
      const provider = createAIProvider(config);
      const result = await provider.healthCheck();

      expect(result.provider).toBe('ollama');
    });
  });

  describe('provider-specific implementations', () => {
    it('should create Groq provider', () => {
      const config: AIProviderConfig = {
        model: 'groq:llama-3.1-8b-instant',
      };
      const provider = createAIProvider(config);
      expect(provider).toBeDefined();
    });

    it('should create Anthropic provider', () => {
      const config: AIProviderConfig = {
        model: 'anthropic:claude-3-5-haiku-latest',
      };
      const provider = createAIProvider(config);
      expect(provider).toBeDefined();
    });

    it('should create OpenAI provider', () => {
      const config: AIProviderConfig = {
        model: 'openai:gpt-4o-mini',
      };
      const provider = createAIProvider(config);
      expect(provider).toBeDefined();
    });
  });

  describe('auto-detection integration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should work with auto-detected provider', () => {
      process.env.GROQ_API_KEY = 'test-key';
      const detectedModel = detectBestProvider();
      const config: AIProviderConfig = {
        model: detectedModel,
      };
      const provider = createAIProvider(config);
      expect(provider).toBeDefined();
    });
  });
});
