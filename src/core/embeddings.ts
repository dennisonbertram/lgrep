import ollama from 'ollama';

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
  model?: string;
  host?: string;
}

/**
 * Client for generating embeddings via Ollama.
 */
export interface EmbeddingClient {
  /** The model being used */
  readonly model: string;

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
   * Check if Ollama is available and the model is loaded.
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
 * Query prefix for mxbai-embed models (required for retrieval).
 * See: https://huggingface.co/mixedbread-ai/mxbai-embed-large-v1
 */
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/**
 * Create an embedding client.
 */
export function createEmbeddingClient(
  options: EmbeddingClientOptions = {}
): EmbeddingClient {
  const model = options.model ?? DEFAULT_MODEL;

  return {
    model,

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
      // Add the query prefix for retrieval
      const prefixedQuery = `${QUERY_PREFIX}${query}`;

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
