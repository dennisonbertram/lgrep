# lgrep

Local semantic code search CLI - AI-powered grep with embeddings.

```bash
npm install -g lgrep
```

## Features

- **Semantic Search** - Find code by meaning, not just text matching
- **Auto-Detection** - Automatically detects the right index from your current directory
- **Multi-Provider AI** - Embeddings: OpenAI, Cohere, Voyage, Ollama | LLM: Groq, Anthropic, OpenAI, Ollama
- **Code Intelligence** - Understands symbols, calls, and dependencies
- **Privacy-First** - Run completely locally with Ollama
- **Fast** - LanceDB vector storage, incremental indexing
- **Watch Mode** - Auto-update indexes on file changes
- **Natural Language Intent** - `lgrep intent "<prompt>"` routes casual queries to the right code-intel command
- **High-Impact Code Intelligence** - Built-in `dead`, `similar`, `cycles`, `unused-exports`, `breaking`, and `rename` helpers

## Quick Start

```bash
# Setup Ollama (local, private)
lgrep setup

# Index your project
lgrep index ./my-project

# Search semantically (auto-detects index from current directory)
cd my-project
lgrep search "user authentication logic"

# Or specify index explicitly
lgrep search "user authentication logic" --index my-project

# Find symbol usages
lgrep search --usages "validateUser"

# Find definitions
lgrep search --definition "UserService"

# Build context for a task
lgrep context "add rate limiting to the API"
```

## Installation

```bash
npm install -g lgrep
```

### Requirements

- Node.js >= 18.17
- [Ollama](https://ollama.ai) (for local mode) or API key for cloud providers

### Setup Local Mode (Ollama)

```bash
# Install Ollama from https://ollama.ai
# Then run setup:
lgrep setup
```

This pulls the required models:
- `mxbai-embed-large` - For embeddings
- `llama3.2:3b` - For code summarization

## Commands

### `lgrep index <path>`

Index a directory for semantic search.

```bash
lgrep index ./src                    # Index with auto-generated name
lgrep index ./src --name my-project  # Custom index name
lgrep index ./src --update           # Incremental update
lgrep index ./src --force            # Full reindex
```

### `lgrep search <query>`

Search indexed code semantically. The index is auto-detected from your current directory, or you can specify it explicitly with `--index`.

```bash
# Auto-detect index (when inside an indexed directory)
lgrep search "error handling"

# Specify index explicitly
lgrep search "error handling" --index my-project

# Code intelligence queries
lgrep search --usages "fetchUser"    # Find all usages
lgrep search --definition "Config"   # Find definitions
lgrep search --type function "auth"  # Filter by symbol type
lgrep search "api" --limit 20        # Adjust result count
```

### `lgrep intent <prompt>`

Let the CLI interpret your question and run the most appropriate helper. Examples:

```bash
lgrep intent "what calls awardBadge"
lgrep intent "what happens if I change setScore"
lgrep intent "find dead code"
```

You can still pass `--index <name>` or `--limit <n>` when multiple indexes exist.

### High-impact code intelligence commands

The following commands run against the same auto-detected index and re-use the code-intel tables that the main indexer already populates:

| Command | Purpose |
|---|---|
| `lgrep dead` | Find functions/methods with zero callers |
| `lgrep similar` | Show duplicated function bodies via a lightweight fingerprint |
| `lgrep cycles` | Detect circular dependency chains through resolved imports |
| `lgrep unused-exports` | Flag exported symbols that are never imported |
| `lgrep breaking` | Surface calls whose argument count no longer matches the signature |
| `lgrep rename <old> <new>` | Preview every reference that would change if you rename a symbol |

Each command supports `-i, --index`, `-l, --limit`, and `-j, --json` (when applicable) so you can script them like the existing CLI commands.


### `lgrep context <task>`

Build context package for a coding task. The index is auto-detected from your current directory, or you can specify it explicitly with `--index`.

```bash
# Auto-detect index (when inside an indexed directory)
lgrep context "implement caching"

# Specify index explicitly
lgrep context "implement caching" --index my-project

# Additional options
lgrep context "fix N+1 query" --suggest        # Include implementation steps
lgrep context "add tests" --max-tokens 16000   # Limit context size
```

### `lgrep list`

List all indexes.

```bash
lgrep list          # Show all indexes
lgrep list --json   # JSON output
```

### `lgrep doctor`

Check lgrep health, configuration, and indexing status.

```bash
lgrep doctor              # Check current directory
lgrep doctor --path /foo  # Check specific path
lgrep doctor --json       # JSON output
```

Output includes:
- ✓ lgrep home directory
- ✓ Config file status
- ✓ Ollama installation/running status
- ✓ Embedding provider availability
- ✓ Index count and names
- ✓ Current directory indexing status
- ✓ Watcher daemon status
- ✓ Claude integration status

### `lgrep watch <index-name>`

Watch for file changes and update index automatically.

```bash
lgrep watch my-project         # Start watching
lgrep watch my-project --stop  # Stop watching
```

### `lgrep delete <index-name>`

Delete an index.

```bash
lgrep delete my-project
```

### `lgrep config`

Manage configuration.

```bash
lgrep config list                                    # Show all settings
lgrep config get model                               # Get specific setting
lgrep config set summarizationModel anthropic:claude-3-5-haiku-latest
```

## Multi-Provider Support

### Embedding Providers

lgrep supports multiple embedding providers for vector generation:

| Provider | Speed | Best For | API Key |
|----------|-------|----------|---------|
| **OpenAI** | ~50ms | General use, recommended | `OPENAI_API_KEY` |
| **Cohere** | ~50ms | Multilingual | `COHERE_API_KEY` |
| **Voyage** | ~100ms | Code (voyage-code-3) | `VOYAGE_API_KEY` |
| **Ollama** | ~1-5s | Privacy, offline | None |

```bash
# Set API key and use auto-detection (recommended)
export OPENAI_API_KEY="sk-..."
lgrep config set model "auto"

# Or explicitly choose a model
lgrep config set model "openai:text-embedding-3-small"
lgrep config set model "voyage:voyage-code-3"  # Great for code!
lgrep config set model "cohere:embed-english-v3.0"
```

### LLM Providers (for Summarization)

lgrep supports multiple AI providers for summarization and context suggestions:

| Provider | Speed | Quality | Privacy |
|----------|-------|---------|---------|
| **Groq** | ~0.1s | Good | Cloud |
| **Anthropic** | ~1.5s | Excellent | Cloud |
| **OpenAI** | ~2s | Excellent | Cloud |
| **Ollama** | ~3s | Good | Local |

### Auto-Detection

Create a `.lgrep.json` file in your repo root to declare the default index and root path. lgrep reads this file (before scanning the list of indexes) so you can stay in one folder without passing `--index` repeatedly.

```json
{
  "index": "frontend-ui",
  "root": "src"
}
```

lgrep automatically selects the best available provider based on environment variables:

```bash
# Priority: Groq > Anthropic > OpenAI > Ollama
export GROQ_API_KEY=gsk_...
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

### Manual Selection

```bash
# Use specific provider
lgrep config set summarizationModel groq:llama-3.1-8b-instant
lgrep config set summarizationModel anthropic:claude-3-5-haiku-latest
lgrep config set summarizationModel openai:gpt-4o-mini
lgrep config set summarizationModel ollama:llama3.2:3b

# Auto-detect (default)
lgrep config set summarizationModel auto
```

## Programmatic API

```typescript
import {
  createEmbeddingClient,
  detectBestEmbeddingProvider,
  createAIProvider,
  detectBestProvider
} from 'lgrep';

// Embeddings (auto-detect provider)
const embedder = createEmbeddingClient({ model: 'auto' });
const { embeddings } = await embedder.embed(['hello world']);
console.log(`Using ${embedder.provider}: ${embedder.model}`);

// Or specify provider explicitly
const openaiEmbedder = createEmbeddingClient({ 
  model: 'openai:text-embedding-3-small' 
});
const voyageEmbedder = createEmbeddingClient({ 
  model: 'voyage:voyage-code-3'  // Great for code!
});

// AI Provider for LLM (auto-detect)
const provider = createAIProvider({ model: detectBestProvider() });
const response = await provider.generateText('Explain this code...');
```

## Configuration

Configuration is stored in `~/.lgrep/config.json`:

```json
{
  "model": "auto",
  "summarizationModel": "auto",
  "ollamaHost": "http://localhost:11434",
  "embedBatchSize": 10,
  "dbBatchSize": 250
}
```

### Environment Variables

```bash
LGREP_HOME          # Config/data directory (default: ~/.lgrep)
OLLAMA_HOST         # Ollama server URL

# Embedding providers (priority: OpenAI > Cohere > Voyage > Ollama)
OPENAI_API_KEY      # OpenAI API key (embeddings + LLM)
COHERE_API_KEY      # Cohere API key (embeddings only)
VOYAGE_API_KEY      # Voyage API key (embeddings only)

# LLM providers (priority: Groq > Anthropic > OpenAI > Ollama)
GROQ_API_KEY        # Groq API key (LLM only, fastest)
ANTHROPIC_API_KEY   # Anthropic API key (LLM only)
```

## Performance

Optimized for large codebases:

- **Batched embeddings** - 10 chunks per API call
- **Batched DB writes** - 250 chunks per flush
- **Incremental indexing** - Only reprocess changed files
- **File metadata table** - O(files) hash lookups

| Repo Size | Memory | Index Time |
|-----------|--------|------------|
| 1,000 files | ~150MB | ~2 min |
| 5,000 files | ~200MB | ~10 min |
| 10,000 files | ~300MB | ~20 min |

## Integration with Claude Code

lgrep works great with Claude Code for AI-assisted development:

```bash
# In Claude Code, lgrep auto-detects ANTHROPIC_API_KEY
lgrep index .
lgrep context "implement feature X" --suggest
```

## License

MIT - See [LICENSE](LICENSE)

## Contributing

Contributions welcome! Please read the contributing guidelines first.

```bash
git clone https://github.com/dennisonbertram/lgrep
cd lgrep
npm install
npm test
```
