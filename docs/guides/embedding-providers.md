# Embedding Providers

## Overview

lgrep supports multiple embedding providers for generating vector embeddings:

| Provider | Speed | Quality | Cost | Best For |
|----------|-------|---------|------|----------|
| **OpenAI** | Fast (~50-100ms) | High | $0.02/1M tokens | General use, recommended |
| **Cohere** | Fast | High | $0.10/1M tokens | Multilingual support |
| **Voyage** | Fast | Excellent for code | $0.06/1M tokens | Code-focused projects |
| **Ollama** | Slow (~1-5s) | Good | Free (local) | Privacy, offline use |

## Quick Start

### Auto-Detection (Recommended)

Set the embedding model to `auto` and provide an API key:

```bash
# Set your preferred provider's API key
export OPENAI_API_KEY="your-key"    # Priority 1
export COHERE_API_KEY="your-key"    # Priority 2  
export VOYAGE_API_KEY="your-key"    # Priority 3
# Ollama is fallback (no key needed)

# lgrep will auto-detect and use the best available provider
lgrep config set model "auto"
```

Detection priority: **OpenAI > Cohere > Voyage > Ollama**

### Explicit Provider Selection

```bash
# OpenAI (recommended for speed/cost balance)
lgrep config set model "openai:text-embedding-3-small"

# Cohere (good for multilingual)
lgrep config set model "cohere:embed-english-v3.0"

# Voyage (excellent for code)
lgrep config set model "voyage:voyage-code-3"

# Ollama (local, private)
lgrep config set model "ollama:mxbai-embed-large"
```

## Provider Details

### OpenAI

Best for: General use, speed, and cost efficiency.

**Models:**
- `text-embedding-3-small` (1536 dims) - Fast and cheap, recommended
- `text-embedding-3-large` (3072 dims) - Higher quality
- `text-embedding-ada-002` (1536 dims) - Legacy

**Setup:**
```bash
export OPENAI_API_KEY="sk-..."
lgrep config set model "openai:text-embedding-3-small"
```

**Get API Key:** https://platform.openai.com/api-keys

### Cohere

Best for: Multilingual codebases, international projects.

**Models:**
- `embed-english-v3.0` (1024 dims) - English optimized
- `embed-multilingual-v3.0` (1024 dims) - 100+ languages
- `embed-english-light-v3.0` (384 dims) - Faster, smaller
- `embed-multilingual-light-v3.0` (384 dims) - Lighter multilingual

**Setup:**
```bash
export COHERE_API_KEY="..."
lgrep config set model "cohere:embed-english-v3.0"
```

**Get API Key:** https://dashboard.cohere.com/api-keys

### Voyage AI

Best for: Code search, programming-focused projects.

**Models:**
- `voyage-code-3` (1024 dims) - **Optimized for code** ⭐
- `voyage-3` (1024 dims) - General purpose
- `voyage-3-lite` (512 dims) - Faster, smaller
- `voyage-finance-2` (1024 dims) - Financial domain
- `voyage-law-2` (1024 dims) - Legal domain

**Setup:**
```bash
export VOYAGE_API_KEY="..."
lgrep config set model "voyage:voyage-code-3"
```

**Get API Key:** https://dash.voyageai.com/

### Ollama (Local)

Best for: Privacy, offline use, no API costs.

**Models:**
- `mxbai-embed-large` (1024 dims) - High quality, default
- `nomic-embed-text` (768 dims) - Good balance
- `all-minilm` (384 dims) - Fast, small

**Setup:**
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Start service
ollama serve

# Pull model
ollama pull mxbai-embed-large

# Configure lgrep
lgrep config set model "ollama:mxbai-embed-large"
```

## Migrating Indexes

**Important:** When you change embedding providers, existing indexes become incompatible because different models produce different vector spaces.

To use a new provider with existing projects:

```bash
# 1. Delete the old index
lgrep delete my-project

# 2. Set new provider
lgrep config set model "openai:text-embedding-3-small"

# 3. Re-index
lgrep index /path/to/project --name my-project
```

## API Reference

### Configuration

```typescript
interface EmbeddingClientOptions {
  /**
   * Model in format "provider:model" or just "model" for Ollama.
   * Use 'auto' for auto-detection.
   */
  model?: string;
  
  /** Ollama host URL (default: 'http://localhost:11434') */
  host?: string;
  
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}
```

### Programmatic Usage

```typescript
import { createEmbeddingClient, detectBestEmbeddingProvider } from 'lgrep';

// Auto-detect
const autoClient = createEmbeddingClient({ model: 'auto' });

// Or explicit
const client = createEmbeddingClient({
  model: 'openai:text-embedding-3-small',
  timeout: 10000,
});

// Generate embeddings
const result = await client.embed(['text 1', 'text 2']);
console.log(result.embeddings); // [[...], [...]]

// Query embedding (some providers optimize for queries)
const queryResult = await client.embedQuery('search term');

// Health check
const health = await client.healthCheck();
if (!health.healthy) {
  console.error('Provider unavailable:', health.error);
}

// Get dimensions
const dims = await client.getModelDimensions();
console.log(`Model uses ${dims} dimensions`);
```

## Troubleshooting

### "API key not set" Error

Make sure the environment variable is set:
```bash
# Check if set
echo $OPENAI_API_KEY

# Set it
export OPENAI_API_KEY="your-key"
```

### "Model not found" (Ollama)

Pull the model first:
```bash
ollama pull mxbai-embed-large
```

### Slow Indexing

Switch to an external provider:
```bash
export OPENAI_API_KEY="your-key"
lgrep config set model "auto"
```

### Dimension Mismatch Error

This happens when searching an index created with a different model. Re-index:
```bash
lgrep delete my-project
lgrep index /path/to/project --name my-project
```

## Performance Comparison

| Provider | Embed 100 chunks | Notes |
|----------|-----------------|-------|
| OpenAI | ~2-3 seconds | Batch API, very fast |
| Cohere | ~2-3 seconds | Batch API |
| Voyage | ~3-5 seconds | Good for code |
| Ollama | ~30-60 seconds | Local, no network |

## Cost Estimation

For a typical codebase (10,000 files, ~500k tokens):

| Provider | Model | Estimated Cost |
|----------|-------|----------------|
| OpenAI | text-embedding-3-small | ~$0.01 |
| OpenAI | text-embedding-3-large | ~$0.07 |
| Cohere | embed-english-v3.0 | ~$0.05 |
| Voyage | voyage-code-3 | ~$0.03 |
| Ollama | any | Free |

## Related

- [AI Provider Guide](./ai-provider.md) - LLM providers for summarization
- [Configuration](../JSON_OUTPUT_GUIDE.md) - Full configuration reference
