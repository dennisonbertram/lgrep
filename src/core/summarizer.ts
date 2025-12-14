/**
 * Configuration options for the summarizer client.
 */
export interface SummarizerOptions {
  /** Ollama model to use (default: 'llama3.2:3b') */
  model?: string;
  /** Ollama host URL (default: 'http://localhost:11434') */
  host?: string;
  /** Maximum summary length in characters (default: 100) */
  maxLength?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Symbol information for summarization.
 */
export interface SymbolInfo {
  /** Symbol name */
  name: string;
  /** Symbol kind (e.g., 'function', 'class', 'interface') */
  kind: string;
  /** Optional type signature */
  signature?: string;
  /** Source code */
  code: string;
  /** Optional documentation */
  documentation?: string;
}

/**
 * Implementation step suggested by the AI.
 */
export interface ImplementationStep {
  /** Step number */
  step: number;
  /** Step description */
  description: string;
  /** Files to modify for this step */
  targetFiles: string[];
}

/**
 * Context for approach suggestion.
 */
export interface ApproachContext {
  /** Relevant symbols from the codebase */
  relevantSymbols: Array<{
    name: string;
    kind: string;
    summary: string;
  }>;
  /** Relevant files with their symbols */
  relevantFiles: Array<{
    path: string;
    symbols: string[];
  }>;
}

/**
 * Health check result.
 */
export interface HealthCheckResult {
  /** Whether the Ollama service is healthy */
  healthy: boolean;
  /** Whether the configured model is available */
  modelAvailable: boolean;
}

/**
 * Client for generating code summaries and suggestions using Ollama.
 */
export interface SummarizerClient {
  /** The model being used */
  readonly model: string;

  /**
   * Summarize a code symbol (function, class, etc.).
   */
  summarizeSymbol(symbol: SymbolInfo): Promise<string>;

  /**
   * Suggest an implementation approach for a task.
   */
  suggestApproach(
    task: string,
    context: ApproachContext
  ): Promise<ImplementationStep[]>;

  /**
   * Check if Ollama is healthy and the model is available.
   */
  healthCheck(): Promise<HealthCheckResult>;
}

/**
 * Default options for the summarizer.
 */
const DEFAULT_OPTIONS: Required<SummarizerOptions> = {
  model: 'llama3.2:3b',
  host: 'http://localhost:11434',
  maxLength: 100,
  timeout: 30000,
};

/**
 * Create a summarizer client.
 */
export function createSummarizerClient(
  options?: SummarizerOptions
): SummarizerClient {
  const config = { ...DEFAULT_OPTIONS, ...options };

  /**
   * Make a request to Ollama chat API with timeout.
   */
  async function chatRequest(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(`${config.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
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
        throw new Error(`Request timeout after ${config.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Truncate text to maximum length.
   */
  function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) {
      return text;
    }
    return text.slice(0, maxLen - 3) + '...';
  }

  return {
    model: config.model,

    async summarizeSymbol(symbol: SymbolInfo): Promise<string> {
      const prompt = `Summarize what this ${symbol.kind} does in ONE concise sentence (max ${config.maxLength} chars).
Focus on PURPOSE, not implementation.

Name: ${symbol.name}
${symbol.signature ? `Signature: ${symbol.signature}\n` : ''}Code:
\`\`\`
${symbol.code}
\`\`\`
${symbol.documentation ? `\nDocumentation: ${symbol.documentation}\n` : ''}
Summary:`;

      const summary = await chatRequest(prompt);
      return truncate(summary.trim(), config.maxLength);
    },

    async suggestApproach(
      task: string,
      context: ApproachContext
    ): Promise<ImplementationStep[]> {
      const symbolsContext = context.relevantSymbols
        .map((s) => `- ${s.kind} ${s.name}: ${s.summary}`)
        .join('\n');

      const filesContext = context.relevantFiles
        .map((f) => `- ${f.path}: [${f.symbols.join(', ')}]`)
        .join('\n');

      const prompt = `Given this task and code context, suggest 3-5 implementation steps.

Task: ${task}

Relevant code:
${symbolsContext}

Relevant files:
${filesContext}

For each step provide:
- step: number (1, 2, 3...)
- description: string
- targetFiles: string[] (files to modify)

Return ONLY a JSON array of steps, no other text:`;

      const response = await chatRequest(prompt);

      // Try to parse JSON from response (may have markdown code fences)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;

      try {
        const steps = JSON.parse(jsonStr);
        if (!Array.isArray(steps)) {
          throw new Error('Response is not an array');
        }
        return steps;
      } catch (error) {
        throw new Error(
          `Failed to parse approach suggestion: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    },

    async healthCheck(): Promise<HealthCheckResult> {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);

        const response = await fetch(`${config.host}/api/tags`, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return { healthy: false, modelAvailable: false };
        }

        const data = (await response.json()) as {
          models?: Array<{ name: string }>;
        };
        const models = data.models || [];
        const modelAvailable = models.some((m) => m.name === config.model);

        return { healthy: true, modelAvailable };
      } catch (error) {
        return { healthy: false, modelAvailable: false };
      }
    },
  };
}
