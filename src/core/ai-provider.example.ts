/**
 * Example usage of the AI Provider abstraction.
 *
 * This file demonstrates how to use the multi-provider AI abstraction
 * to work with different AI services seamlessly.
 */

import {
  createAIProvider,
  detectBestProvider,
  parseModelString,
  type AIProviderConfig,
  type AIProvider,
} from './ai-provider.js';

/**
 * Example 1: Auto-detect best provider based on available API keys
 */
async function autoDetectExample() {
  // Automatically selects the best available provider
  // Priority: Groq > Anthropic > OpenAI > Ollama
  const modelString = detectBestProvider();
  console.log(`Auto-detected model: ${modelString}`);

  const config: AIProviderConfig = {
    model: modelString,
  };

  const provider = createAIProvider(config);
  const response = await provider.generateText('What is TypeScript?');
  console.log('Response:', response);
}

/**
 * Example 2: Use a specific provider (Groq for speed)
 */
async function groqExample() {
  const config: AIProviderConfig = {
    model: 'groq:llama-3.1-8b-instant',
    timeout: 5000, // 5 second timeout
  };

  const provider = createAIProvider(config);

  // Check health first
  const health = await provider.healthCheck();
  if (!health.healthy) {
    throw new Error(`${health.provider} is not available`);
  }

  // Generate text
  const response = await provider.generateText('Explain async/await in JavaScript');
  console.log('Groq response:', response);
}

/**
 * Example 3: Use Anthropic for high quality responses
 */
async function anthropicExample() {
  const config: AIProviderConfig = {
    model: 'anthropic:claude-3-5-haiku-latest',
  };

  const provider = createAIProvider(config);
  const response = await provider.generateText('Summarize the benefits of TypeScript');
  console.log('Anthropic response:', response);
}

/**
 * Example 4: Use OpenAI
 */
async function openaiExample() {
  const config: AIProviderConfig = {
    model: 'openai:gpt-4o-mini',
  };

  const provider = createAIProvider(config);
  const response = await provider.generateText('What are REST APIs?');
  console.log('OpenAI response:', response);
}

/**
 * Example 5: Use local Ollama (no API key needed)
 */
async function ollamaExample() {
  const config: AIProviderConfig = {
    model: 'ollama:llama3.2:3b',
  };

  const provider = createAIProvider(config);

  // Check if Ollama is running
  const health = await provider.healthCheck();
  if (!health.healthy) {
    console.error('Ollama is not running. Start it with: ollama serve');
    return;
  }

  const response = await provider.generateText('What is Node.js?');
  console.log('Ollama response:', response);
}

/**
 * Example 6: Parse model strings
 */
function parseExample() {
  const examples = [
    'groq:llama-3.1-8b-instant',
    'anthropic:claude-3-5-haiku-latest',
    'openai:gpt-4o-mini',
    'ollama:llama3.2:3b',
  ];

  examples.forEach((modelString) => {
    const parsed = parseModelString(modelString);
    console.log(`${modelString} -> provider: ${parsed.provider}, model: ${parsed.model}`);
  });
}

/**
 * Example 7: Multi-provider fallback strategy
 */
async function fallbackExample(prompt: string): Promise<string> {
  const providers: AIProviderConfig[] = [
    { model: 'groq:llama-3.1-8b-instant', timeout: 5000 },
    { model: 'anthropic:claude-3-5-haiku-latest' },
    { model: 'openai:gpt-4o-mini' },
    { model: 'ollama:llama3.2:3b' },
  ];

  for (const config of providers) {
    try {
      const provider = createAIProvider(config);
      const health = await provider.healthCheck();

      if (health.healthy) {
        console.log(`Using provider: ${health.provider}`);
        return await provider.generateText(prompt);
      }
    } catch (error) {
      console.log(`Failed with ${config.model}, trying next...`);
      continue;
    }
  }

  throw new Error('No available AI providers');
}

/**
 * Example 8: Helper function to create a provider with auto-detection
 */
function createSmartProvider(): AIProvider {
  const model = detectBestProvider();
  console.log(`Creating provider with: ${model}`);

  return createAIProvider({
    model,
    timeout: 30000,
  });
}

// Export examples for use in documentation
export {
  autoDetectExample,
  groqExample,
  anthropicExample,
  openaiExample,
  ollamaExample,
  parseExample,
  fallbackExample,
  createSmartProvider,
};
