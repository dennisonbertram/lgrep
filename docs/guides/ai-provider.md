# AI Provider Abstraction

## Overview

The AI provider abstraction allows lgrep to work with multiple AI services seamlessly:
- **Ollama** (local, private) - Default fallback
- **Groq** (blazing fast, ~100ms) - Best for speed
- **Anthropic** (high quality) - Best for quality
- **OpenAI** (widely available) - Good balance

## Quick Start

### Auto-Detection

The simplest way to use the AI provider is to let it auto-detect the best available provider:

```typescript
import { createAIProvider, detectBestProvider } from 'lgrep';

// Auto-detect based on available API keys
const model = detectBestProvider();
const provider = createAIProvider({ model });

// Generate text
const response = await provider.generateText('What is TypeScript?');
console.log(response);
```

### Auto-Detection Priority

The detection follows this priority order:

1. **Groq** - If `GROQ_API_KEY` is set
2. **Anthropic** - If `ANTHROPIC_API_KEY` is set
3. **OpenAI** - If `OPENAI_API_KEY` is set
4. **Ollama** - Local fallback (no API key needed)

## Model String Format

All providers use a consistent format: `provider:model`

```typescript
// Groq
'groq:llama-3.1-8b-instant'

// Anthropic
'anthropic:claude-3-5-haiku-latest'

// OpenAI
'openai:gpt-4o-mini'

// Ollama
'ollama:llama3.2:3b'
```

## Provider-Specific Usage

### Groq (Fast)

Best for: Speed-critical applications, real-time responses

```typescript
import { createAIProvider } from 'lgrep';

const provider = createAIProvider({
  model: 'groq:llama-3.1-8b-instant',
  timeout: 5000, // 5 second timeout
});

// Check health
const health = await provider.healthCheck();
if (health.healthy) {
  const response = await provider.generateText('Explain async/await');
  console.log(response);
}
```

**Requirements:**
- Set `GROQ_API_KEY` environment variable
- Get API key from: https://console.groq.com

### Anthropic (Quality)

Best for: High-quality responses, complex reasoning

```typescript
import { createAIProvider } from 'lgrep';

const provider = createAIProvider({
  model: 'anthropic:claude-3-5-haiku-latest',
});

const response = await provider.generateText('Summarize TypeScript benefits');
console.log(response);
```

**Requirements:**
- Set `ANTHROPIC_API_KEY` environment variable
- Get API key from: https://console.anthropic.com

### OpenAI

Best for: General purpose, widely available

```typescript
import { createAIProvider } from 'lgrep';

const provider = createAIProvider({
  model: 'openai:gpt-4o-mini',
});

const response = await provider.generateText('What are REST APIs?');
console.log(response);
```

**Requirements:**
- Set `OPENAI_API_KEY` environment variable
- Get API key from: https://platform.openai.com

### Ollama (Local)

Best for: Privacy, no API costs, offline use

```typescript
import { createAIProvider } from 'lgrep';

const provider = createAIProvider({
  model: 'ollama:llama3.2:3b',
});

// Check if Ollama is running
const health = await provider.healthCheck();
if (!health.healthy) {
  console.error('Ollama is not running. Start it with: ollama serve');
  process.exit(1);
}

const response = await provider.generateText('What is Node.js?');
console.log(response);
```

**Requirements:**
- Install Ollama: https://ollama.ai
- Start Ollama: `ollama serve`
- Pull model: `ollama pull llama3.2:3b`

## API Reference

### `detectBestProvider()`

Auto-detect the best available provider based on environment variables.

```typescript
function detectBestProvider(): string;
```

**Returns:** Model string (e.g., `'groq:llama-3.1-8b-instant'`)

**Example:**
```typescript
const model = detectBestProvider();
console.log(model); // 'groq:llama-3.1-8b-instant'
```

### `parseModelString(modelString)`

Parse a model string into provider and model components.

```typescript
function parseModelString(modelString: string): {
  provider: string;
  model: string;
};
```

**Parameters:**
- `modelString` - Model string in format `'provider:model'`

**Returns:** Object with `provider` and `model` fields

**Example:**
```typescript
const parsed = parseModelString('groq:llama-3.1-8b-instant');
// { provider: 'groq', model: 'llama-3.1-8b-instant' }
```

**Errors:**
- Throws if format is invalid
- Throws if provider or model is empty

### `createAIProvider(config)`

Create an AI provider instance.

```typescript
function createAIProvider(config: AIProviderConfig): AIProvider;

interface AIProviderConfig {
  model: string;      // Format: 'provider:model'
  timeout?: number;   // Timeout in ms (default: 30000)
}
```

**Parameters:**
- `config.model` - Model string (e.g., `'groq:llama-3.1-8b-instant'`)
- `config.timeout` - Optional timeout in milliseconds (default: 30000)

**Returns:** `AIProvider` instance

**Example:**
```typescript
const provider = createAIProvider({
  model: 'groq:llama-3.1-8b-instant',
  timeout: 5000,
});
```

**Errors:**
- Throws if provider is unsupported
- Throws if model string format is invalid

### `AIProvider` Interface

```typescript
interface AIProvider {
  generateText(prompt: string): Promise<string>;
  healthCheck(): Promise<{ healthy: boolean; provider: string }>;
}
```

#### `generateText(prompt)`

Generate text from a prompt.

```typescript
async generateText(prompt: string): Promise<string>;
```

**Parameters:**
- `prompt` - Text prompt

**Returns:** Generated text response

**Example:**
```typescript
const response = await provider.generateText('What is TypeScript?');
console.log(response);
```

**Errors:**
- Throws on timeout
- Throws on API errors
- Throws if service is unavailable

#### `healthCheck()`

Check provider health and availability.

```typescript
async healthCheck(): Promise<{
  healthy: boolean;
  provider: string;
}>;
```

**Returns:**
- `healthy` - Whether the provider is available
- `provider` - Provider name (e.g., `'groq'`, `'anthropic'`)

**Example:**
```typescript
const health = await provider.healthCheck();
if (!health.healthy) {
  console.error(`${health.provider} is not available`);
}
```

## Patterns

### Multi-Provider Fallback

Try multiple providers in order until one works:

```typescript
import { createAIProvider, type AIProviderConfig } from 'lgrep';

async function generateWithFallback(prompt: string): Promise<string> {
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
        return await provider.generateText(prompt);
      }
    } catch (error) {
      continue;
    }
  }

  throw new Error('No available AI providers');
}
```

### Health Check Before Use

Always check health for production code:

```typescript
import { createAIProvider } from 'lgrep';

async function safeGenerate(prompt: string) {
  const provider = createAIProvider({
    model: 'groq:llama-3.1-8b-instant',
  });

  const health = await provider.healthCheck();
  if (!health.healthy) {
    throw new Error(`Provider ${health.provider} is not available`);
  }

  return await provider.generateText(prompt);
}
```

### Custom Timeout

Use shorter timeouts for speed-critical applications:

```typescript
const provider = createAIProvider({
  model: 'groq:llama-3.1-8b-instant',
  timeout: 3000, // 3 seconds
});

try {
  const response = await provider.generateText('Quick summary');
  console.log(response);
} catch (error) {
  console.error('Timeout or error:', error);
}
```

## Environment Setup

### Groq

```bash
export GROQ_API_KEY="your-api-key"
```

### Anthropic

```bash
export ANTHROPIC_API_KEY="your-api-key"
```

### OpenAI

```bash
export OPENAI_API_KEY="your-api-key"
```

### Ollama

```bash
# Install
curl -fsSL https://ollama.ai/install.sh | sh

# Start service
ollama serve

# Pull model
ollama pull llama3.2:3b
```

## Troubleshooting

### "Unsupported AI provider" Error

Make sure your model string uses a supported provider:
- `ollama`
- `groq`
- `anthropic`
- `openai`

```typescript
// Wrong
createAIProvider({ model: 'gemini:model' }); // Error

// Right
createAIProvider({ model: 'groq:llama-3.1-8b-instant' }); // Works
```

### "Invalid model string format" Error

Model strings must be in format `provider:model`:

```typescript
// Wrong
createAIProvider({ model: 'llama3.2' }); // Error

// Right
createAIProvider({ model: 'ollama:llama3.2:3b' }); // Works
```

### Health Check Fails

**Groq/Anthropic/OpenAI:**
- Check API key is set in environment
- Verify API key is valid
- Check internet connection

**Ollama:**
- Make sure Ollama is running: `ollama serve`
- Check if model is pulled: `ollama list`
- Pull model if needed: `ollama pull llama3.2:3b`

### Timeout Errors

Increase timeout or switch to faster provider:

```typescript
// Option 1: Increase timeout
const provider = createAIProvider({
  model: 'ollama:llama3.2:3b',
  timeout: 60000, // 60 seconds
});

// Option 2: Switch to faster provider
const provider = createAIProvider({
  model: 'groq:llama-3.1-8b-instant',
  timeout: 5000,
});
```

## Best Practices

1. **Use auto-detection** for flexibility
2. **Check health** before generating text
3. **Set appropriate timeouts** based on use case
4. **Implement fallbacks** for production
5. **Cache API keys** in environment variables
6. **Use Groq** for speed-critical paths
7. **Use Anthropic** for quality-critical tasks
8. **Use Ollama** for privacy-sensitive operations

## Related

- [AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Groq Documentation](https://console.groq.com/docs)
- [Anthropic Documentation](https://docs.anthropic.com)
- [OpenAI Documentation](https://platform.openai.com/docs)
- [Ollama Documentation](https://github.com/ollama/ollama)
