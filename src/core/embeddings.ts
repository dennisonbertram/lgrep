import ollama from 'ollama';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { cohere } from '@ai-sdk/cohere';
import { VoyageAIClient } from 'voyageai';

/**
 * Result from embedding generation.
 */
export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
}

/**
 * Health check result.
 */
export interface HealthCheckResult {
  healthy: boolean;
  modelAvailable: boolean;
  error?: string;
}

/**
 * Options for creating an embedding client.
 */
export interface EmbeddingClientOptions {
  /**
   * Model in format "provider:model" or just "model" for Ollama.
   * 
   * Examples:
   * - 'openai:text-embedding-3-small' (recommended for speed/cost)
   * - 'openai:text-embedding-3-large' (higher quality)
   * - 'cohere:embed-english-v3.0'
   * - 'voyage:voyage-3' (good general purpose)
   * - 'voyage:voyage-code-3' (optimized for code)
   * - 'ollama:mxbai-embed-large' or just 'mxbai-embed-large' (local)
   * - 'auto' - auto-detect best available provider
   */
  model?: string;
  /** Ollama host URL (default: 'http://localhost:11434') - only used for Ollama provider */
  host?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Client for generating embeddings via multiple providers.
 */
export interface EmbeddingClient {
  /** The model being used (in provider:model format) */
  readonly model: string;
  /** The provider being used */
  readonly provider: string;

  /**
   * Generate embeddings for one or more texts.
   */
  embed(input: string | string[]): Promise<EmbeddingResult>;

  /**
   * Generate embeddings for a search query.
   * Automatically adds the retrieval prefix for better search results.
   */
  embedQuery(query: string): Promise<EmbeddingResult>;

  /**
   * Check if the provider is available and the model is loaded.
   */
  healthCheck(): Promise<HealthCheckResult>;

  /**
   * Get the embedding dimensions for the current model.
   */
  getModelDimensions(): Promise<number>;
}

/**
 * Default embedding model.
 */
const DEFAULT_MODEL = 'mxbai-embed-large';

/**
 * Default timeout for requests.
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Query prefix for mxbai-embed models (required for retrieval).
 * See: https://huggingface.co/mixedbread-ai/mxbai-embed-large-v1
 */
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/**
 * Supported embedding providers.
 */
const SUPPORTED_PROVIDERS = ['ollama', 'openai', 'cohere', 'voyage'] as const;
type EmbeddingProvider = (typeof SUPPORTED_PROVIDERS)[number];

/**
 * Model dimensions for known models (to avoid extra API calls).
 */
const KNOWN_DIMENSIONS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Cohere
  'embed-english-v3.0': 1024,
  'embed-multilingual-v3.0': 1024,
  'embed-english-light-v3.0': 384,
  'embed-multilingual-light-v3.0': 384,
  // Voyage
  'voyage-3': 1024,
  'voyage-3-lite': 512,
  'voyage-code-3': 1024,
  'voyage-finance-2': 1024,
  'voyage-law-2': 1024,
  // Ollama - common models
  'mxbai-embed-large': 1024,
  'nomic-embed-text': 768,
  'all-minilm': 384,
};

/**
 * Parse model string in format "provider:model" or just "model" for Ollama.
 */
export function parseEmbeddingModelString(modelString: string): {
  provider: EmbeddingProvider;
  model: string;
} {
  const colonIndex = modelString.indexOf(':');

  if (colonIndex === -1) {
    // No provider specified, assume Ollama
    return { provider: 'ollama', model: modelString };
  }

  const providerPart = modelString.slice(0, colonIndex);
  const modelPart = modelString.slice(colonIndex + 1);

  if (!SUPPORTED_PROVIDERS.includes(providerPart as EmbeddingProvider)) {
    throw new Error(
      `Unsupported embedding provider: ${providerPart}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`
    );
  }

  if (!modelPart) {
    throw new Error('Model name cannot be empty');
  }

  return { provider: providerPart as EmbeddingProvider, model: modelPart };
}

/**
 * Auto-detect the best available embedding provider based on environment variables.
 * Priority: OpenAI > Cohere > Voyage > Ollama (local fallback)
 */
export function detectBestEmbeddingProvider(): string {
  if (process.env.OPENAI_API_KEY) {
    return 'openai:text-embedding-3-small';
  }
  if (process.env.COHERE_API_KEY) {
    return 'cohere:embed-english-v3.0';
  }
  if (process.env.VOYAGE_API_KEY) {
    return 'voyage:voyage-code-3';
  }
  // Fallback to local Ollama
  return 'ollama:mxbai-embed-large';
}

/**
 * Create an embedding client.
 */
export function createEmbeddingClient(
  options: EmbeddingClientOptions = {}
): EmbeddingClient {
  const modelString = options.model ?? DEFAULT_MODEL;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  // Handle 'auto' mode
  const resolvedModelString =
    modelString === 'auto' ? detectBestEmbeddingProvider() : modelString;

  const { provider, model } = parseEmbeddingModelString(resolvedModelString);

  switch (provider) {
    case 'openai':
      return createOpenAIEmbeddingClient(model, timeout);
    case 'cohere':
      return createCohereEmbeddingClient(model, timeout);
    case 'voyage':
      return createVoyageEmbeddingClient(model, timeout);
    case 'ollama':
      return createOllamaEmbeddingClient(model, options.host, timeout);
    default:
      throw new Error(`Provider ${provider} not implemented`);
  }
}

/**
 * Create OpenAI embedding client using Vercel AI SDK.
 */
function createOpenAIEmbeddingClient(
  model: string,
  timeout: number
): EmbeddingClient {
  const embeddingModel = openai.embedding(model);
  const fullModelString = `openai:${model}`;

  return {
    model: fullModelString,
    provider: 'openai',

    async embed(input: string | string[]): Promise<EmbeddingResult> {
      const values = Array.isArray(input) ? input : [input];

      const result = await embedMany({
        model: embeddingModel,
        values,
        abortSignal: AbortSignal.timeout(timeout),
      });

      return {
        embeddings: result.embeddings,
        model: fullModelString,
      };
    },

    async embedQuery(query: string): Promise<EmbeddingResult> {
      // OpenAI doesn't require a special prefix for queries
      return this.embed(query);
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return {
          healthy: false,
          modelAvailable: false,
          error: 'OPENAI_API_KEY not set',
        };
      }
      return { healthy: true, modelAvailable: true };
    },

    async getModelDimensions(): Promise<number> {
      const known = KNOWN_DIMENSIONS[model];
      if (known) return known;

      // Generate a test embedding to determine dimensions
      const result = await this.embed('test');
      return result.embeddings[0]?.length ?? 0;
    },
  };
}

/**
 * Create Cohere embedding client using Vercel AI SDK.
 */
function createCohereEmbeddingClient(
  model: string,
  timeout: number
): EmbeddingClient {
  const embeddingModel = cohere.embedding(model);
  const fullModelString = `cohere:${model}`;

  return {
    model: fullModelString,
    provider: 'cohere',

    async embed(input: string | string[]): Promise<EmbeddingResult> {
      const values = Array.isArray(input) ? input : [input];

      const result = await embedMany({
        model: embeddingModel,
        values,
        abortSignal: AbortSignal.timeout(timeout),
      });

      return {
        embeddings: result.embeddings,
        model: fullModelString,
      };
    },

    async embedQuery(query: string): Promise<EmbeddingResult> {
      // Cohere handles query/document distinction internally
      return this.embed(query);
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const apiKey = process.env.COHERE_API_KEY;
      if (!apiKey) {
        return {
          healthy: false,
          modelAvailable: false,
          error: 'COHERE_API_KEY not set',
        };
      }
      return { healthy: true, modelAvailable: true };
    },

    async getModelDimensions(): Promise<number> {
      const known = KNOWN_DIMENSIONS[model];
      if (known) return known;

      // Generate a test embedding to determine dimensions
      const result = await this.embed('test');
      return result.embeddings[0]?.length ?? 0;
    },
  };
}

/**
 * Create Voyage AI embedding client.
 */
function createVoyageEmbeddingClient(
  model: string,
  timeout: number
): EmbeddingClient {
  const client = new VoyageAIClient({
    apiKey: process.env.VOYAGE_API_KEY,
  });
  const fullModelString = `voyage:${model}`;

  return {
    model: fullModelString,
    provider: 'voyage',

    async embed(input: string | string[]): Promise<EmbeddingResult> {
      const values = Array.isArray(input) ? input : [input];

      const response = await client.embed(
        {
          input: values,
          model,
        },
        { timeoutInSeconds: timeout / 1000 }
      );

      const embeddings = response.data?.map((d) => d.embedding ?? []) ?? [];

      return {
        embeddings,
        model: fullModelString,
      };
    },

    async embedQuery(query: string): Promise<EmbeddingResult> {
      // Voyage supports input_type for queries vs documents
      const response = await client.embed(
        {
          input: [query],
          model,
          inputType: 'query',
        },
        { timeoutInSeconds: timeout / 1000 }
      );

      const embeddings = response.data?.map((d) => d.embedding ?? []) ?? [];

      return {
        embeddings,
        model: fullModelString,
      };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const apiKey = process.env.VOYAGE_API_KEY;
      if (!apiKey) {
        return {
          healthy: false,
          modelAvailable: false,
          error: 'VOYAGE_API_KEY not set',
        };
      }
      return { healthy: true, modelAvailable: true };
    },

    async getModelDimensions(): Promise<number> {
      const known = KNOWN_DIMENSIONS[model];
      if (known) return known;

      // Generate a test embedding to determine dimensions
      const result = await this.embed('test');
      return result.embeddings[0]?.length ?? 0;
    },
  };
}

/**
 * Create Ollama embedding client (local).
 */
function createOllamaEmbeddingClient(
  model: string,
  host?: string,
  _timeout?: number
): EmbeddingClient {
  const fullModelString = `ollama:${model}`;

  // Note: Ollama SDK doesn't support custom host via options directly
  // It uses OLLAMA_HOST environment variable
  if (host && host !== 'http://localhost:11434') {
    process.env.OLLAMA_HOST = host;
  }

  return {
    model: fullModelString,
    provider: 'ollama',

    async embed(input: string | string[]): Promise<EmbeddingResult> {
      const response = await ollama.embed({
        model,
        input,
      });

      return {
        embeddings: response.embeddings,
        model: response.model,
      };
    },

    async embedQuery(query: string): Promise<EmbeddingResult> {
      // Add the query prefix for retrieval (mxbai-embed models)
      const prefixedQuery = model.includes('mxbai')
        ? `${QUERY_PREFIX}${query}`
        : query;

      const response = await ollama.embed({
        model,
        input: prefixedQuery,
      });

      return {
        embeddings: response.embeddings,
        model: response.model,
      };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      try {
        const response = await ollama.list();
        const modelAvailable = response.models.some(
          (m) => m.name === model || m.name.startsWith(`${model}:`)
        );

        return {
          healthy: true,
          modelAvailable,
        };
      } catch (error) {
        return {
          healthy: false,
          modelAvailable: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getModelDimensions(): Promise<number> {
      const known = KNOWN_DIMENSIONS[model];
      if (known) return known;

      try {
        // Generate a test embedding to determine dimensions
        const response = await ollama.embed({
          model,
          input: 'test',
        });

        const embedding = response.embeddings[0];
        if (!embedding || embedding.length === 0) {
          throw new Error('Empty embedding returned');
        }

        return embedding.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to determine model dimensions: ${message}`);
      }
    },
  };
}
