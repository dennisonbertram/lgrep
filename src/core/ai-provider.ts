import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { groq } from '@ai-sdk/groq';

/**
 * Configuration for AI provider.
 * Model format: "provider:model" e.g. "groq:llama-3.1-8b-instant"
 */
export interface AIProviderConfig {
  /** Model in format "provider:model" */
  model: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * AI provider interface.
 */
export interface AIProvider {
  /**
   * Generate text from a prompt.
   */
  generateText(prompt: string): Promise<string>;

  /**
   * Check provider health and availability.
   */
  healthCheck(): Promise<{ healthy: boolean; provider: string }>;
}

/**
 * Parsed model string.
 */
interface ParsedModel {
  provider: string;
  model: string;
}

/**
 * Default timeout for AI requests.
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Default Ollama host.
 */
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

/**
 * Parse model string in format "provider:model".
 * For models with colons in the name (e.g., "ollama:llama3.2:3b"),
 * the provider is the first part and the rest is the model name.
 */
export function parseModelString(modelString: string): ParsedModel {
  const colonIndex = modelString.indexOf(':');

  if (colonIndex === -1) {
    throw new Error(
      'Invalid model string format. Expected "provider:model" (e.g., "groq:llama-3.1-8b-instant")'
    );
  }

  const provider = modelString.slice(0, colonIndex);
  const model = modelString.slice(colonIndex + 1);

  if (!provider || !model) {
    throw new Error(
      'Invalid model string format. Provider and model cannot be empty'
    );
  }

  return { provider, model };
}

/**
 * Auto-detect the best available provider based on environment variables.
 * Priority: Groq > Anthropic > OpenAI > Ollama (local fallback)
 */
export function detectBestProvider(): string {
  if (process.env.GROQ_API_KEY) {
    return 'groq:llama-3.1-8b-instant';
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return 'anthropic:claude-3-5-haiku-latest';
  }
  if (process.env.OPENAI_API_KEY) {
    return 'openai:gpt-4o-mini';
  }
  // Fallback to local Ollama
  return 'ollama:llama3.2:3b';
}

/**
 * Create an AI provider instance.
 */
export function createAIProvider(config: AIProviderConfig): AIProvider {
  const { provider, model } = parseModelString(config.model);
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  // Validate provider
  const supportedProviders = ['ollama', 'groq', 'anthropic', 'openai'];
  if (!supportedProviders.includes(provider)) {
    throw new Error(
      `Unsupported AI provider: ${provider}. Supported: ${supportedProviders.join(', ')}`
    );
  }

  // Create provider-specific implementation
  switch (provider) {
    case 'ollama':
      return createOllamaProvider(model, timeout);
    case 'groq':
      return createGroqProvider(model, timeout);
    case 'anthropic':
      return createAnthropicProvider(model, timeout);
    case 'openai':
      return createOpenAIProvider(model, timeout);
    default:
      throw new Error(`Provider ${provider} not implemented`);
  }
}

/**
 * Create Ollama provider implementation.
 */
function createOllamaProvider(model: string, timeout: number): AIProvider {
  const host = DEFAULT_OLLAMA_HOST;

  return {
    async generateText(prompt: string): Promise<string> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(`${host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(
            `Ollama request failed: ${response.status} ${response.statusText}`
          );
        }

        const data = (await response.json()) as {
          message: { content: string };
        };
        return data.message.content;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Request timeout after ${timeout}ms`);
        }
        throw error;
      }
    },

    async healthCheck(): Promise<{ healthy: boolean; provider: string }> {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(`${host}/api/tags`, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        return {
          healthy: response.ok,
          provider: 'ollama',
        };
      } catch {
        return {
          healthy: false,
          provider: 'ollama',
        };
      }
    },
  };
}

/**
 * Create Groq provider implementation using AI SDK.
 */
function createGroqProvider(model: string, timeout: number): AIProvider {
  return {
    async generateText(prompt: string): Promise<string> {
      const { text } = await generateText({
        model: groq(model),
        prompt,
        abortSignal: AbortSignal.timeout(timeout),
      });
      return text;
    },

    async healthCheck(): Promise<{ healthy: boolean; provider: string }> {
      try {
        // Check if API key is set
        const apiKey = process.env.GROQ_API_KEY;
        return {
          healthy: Boolean(apiKey),
          provider: 'groq',
        };
      } catch {
        return {
          healthy: false,
          provider: 'groq',
        };
      }
    },
  };
}

/**
 * Create Anthropic provider implementation using AI SDK.
 */
function createAnthropicProvider(model: string, timeout: number): AIProvider {
  return {
    async generateText(prompt: string): Promise<string> {
      const { text } = await generateText({
        model: anthropic(model),
        prompt,
        abortSignal: AbortSignal.timeout(timeout),
      });
      return text;
    },

    async healthCheck(): Promise<{ healthy: boolean; provider: string }> {
      try {
        // Check if API key is set
        const apiKey = process.env.ANTHROPIC_API_KEY;
        return {
          healthy: Boolean(apiKey),
          provider: 'anthropic',
        };
      } catch {
        return {
          healthy: false,
          provider: 'anthropic',
        };
      }
    },
  };
}

/**
 * Create OpenAI provider implementation using AI SDK.
 */
function createOpenAIProvider(model: string, timeout: number): AIProvider {
  return {
    async generateText(prompt: string): Promise<string> {
      const { text } = await generateText({
        model: openai(model),
        prompt,
        abortSignal: AbortSignal.timeout(timeout),
      });
      return text;
    },

    async healthCheck(): Promise<{ healthy: boolean; provider: string }> {
      try {
        // Check if API key is set
        const apiKey = process.env.OPENAI_API_KEY;
        return {
          healthy: Boolean(apiKey),
          provider: 'openai',
        };
      } catch {
        return {
          healthy: false,
          provider: 'openai',
        };
      }
    },
  };
}
