# lgrep

Local semantic code search CLI - AI-powered grep with embeddings.

**Why lgrep?** Traditional grep finds text patterns, but lgrep understands code. Search for "authentication logic" and find OAuth handlers, JWT validation, and session management—even if those words never appear in the code. Plus built-in code intelligence: find dead code, circular dependencies, and see the blast radius before refactoring. Works locally with Ollama or blazing fast with cloud APIs.

## Prerequisites

lgrep requires an embedding provider. Choose one:

| Provider | Setup | Speed | Cost |
|----------|-------|-------|------|
| **OpenAI** (recommended) | `export OPENAI_API_KEY=sk-...` | ~50ms | ~$0.02/1M tokens |
| **Voyage** (best for code) | `export VOYAGE_API_KEY=...` | ~100ms | ~$0.06/1M tokens |
| **Cohere** | `export COHERE_API_KEY=...` | ~50ms | ~$0.10/1M tokens |
| **Ollama** (local/free) | `lgrep setup` | ~1-5s | Free (downloads ~2GB) |

**Without one of these configured, indexing will fail.**

> **Note:** `lgrep setup` auto-installs Ollama and downloads the required AI models (~2GB). This is the easiest option if you don't have API keys.

## Installation

```bash
# 1. Install lgrep
npm install -g lgrep

# 2. Configure embedding provider (choose one):

# Option A: Use OpenAI (fast, recommended)
export OPENAI_API_KEY=sk-...

# Option B: Use local Ollama (private, free, slower)
lgrep setup   # Downloads Ollama + ~2GB of models

# 3. Verify setup
lgrep doctor
```

## Quick Start

```bash
# Index your project
lgrep index ./my-project

# Search semantically
cd my-project
lgrep search "user authentication logic"

# Find symbol usages
lgrep search --usages "validateUser"

# Find definitions
lgrep search --definition "UserService"

# Build context for a task
lgrep context "add rate limiting to the API"
```

## Claude Code Integration

Install lgrep as a Claude Code skill:

```bash
lgrep install
```

This adds:
- **Skill** - Claude learns when/how to use lgrep automatically
- **SessionStart hook** - Auto-indexes repos when you open them in Claude Code

After installation, Claude will use lgrep for semantic search, code intelligence, and context building.

## Features

- **Semantic Search** - Find code by meaning, not just text matching
- **Code Intelligence** - Understands symbols, calls, and dependencies
- **Multi-Provider** - OpenAI, Cohere, Voyage, or local Ollama
- **Privacy-First** - Run completely locally with Ollama
- **Fast** - LanceDB vector storage, parallel processing, incremental indexing
- **Watch Mode** - Auto-update indexes on file changes
- **Natural Language** - `lgrep intent "<prompt>"` routes queries to the right command
- **Refactoring Tools** - Dead code, circular deps, unused exports, impact analysis

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
| `lgrep callers <symbol>` | Show all locations that call a given function/method |
| `lgrep deps <module>` | Show what modules import/depend on a given module |
| `lgrep impact <symbol>` | Show blast radius if you change a function (direct + transitive callers) |

Each command supports `-i, --index`, `-l, --limit`, and `-j, --json` (when applicable) so you can script them like the existing CLI commands.

### `lgrep graph`

Open a local web UI to visualize how your code is connected as a graph.

- **Dependencies**: file → file imports (default)
- **Calls**: file → file call edges (best-effort, based on resolved callees)

```bash
# Auto-detect index (when inside an indexed directory)
lgrep graph

# Specify index explicitly
lgrep graph --index my-project

# Switch graph mode
lgrep graph --mode calls
lgrep graph --mode deps

# Include external dependencies (deps mode)
lgrep graph --external

# Do not auto-open the browser
lgrep graph --no-open

# Bind to a specific port (default: 0 = random high port)
lgrep graph --port 5050
```


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

### `lgrep stats`

Show index statistics.

```bash
lgrep stats              # Stats for current directory's index
lgrep stats --all        # Stats for all indexes
lgrep stats -i myproject # Stats for specific index
```

### `lgrep logs`

View watcher daemon logs.

```bash
lgrep logs               # Last 50 lines for current index
lgrep logs -n 100        # Last 100 lines
lgrep logs -f            # Follow logs in real-time (like tail -f)
lgrep logs --all         # Logs for all watchers
```

### `lgrep symbols [query]`

Quick symbol lookup by name.

```bash
lgrep symbols              # List all symbols
lgrep symbols User         # Find symbols matching "User"
lgrep symbols -k function  # Only functions
lgrep symbols -f auth.ts   # Only from files matching "auth.ts"
```

### `lgrep explain <target>`

AI-powered explanation of a file or symbol.

```bash
lgrep explain src/auth.ts        # Explain a file
lgrep explain authenticateUser   # Explain a symbol
lgrep explain validateToken -m groq:llama-3.3-70b  # Use specific model
```

### `lgrep install`

Install lgrep integration with Claude Code.

```bash
lgrep install                  # Install skill + SessionStart hook
lgrep install --skip-hook      # Skip SessionStart hook (skill only)
lgrep install --add-to-claude-md  # Also add to ~/.claude/CLAUDE.md (optional)
lgrep install --add-to-project    # Also add to project CLAUDE.md (optional)
```

### `lgrep analyze <path>`

Analyze code structure without indexing. Useful for one-off analysis.

```bash
lgrep analyze ./src                    # Analyze directory
lgrep analyze ./src --symbols          # List all symbols
lgrep analyze ./src --deps             # Show dependency graph
lgrep analyze ./src --calls            # Show call graph
lgrep analyze ./src --file auth.ts     # Analyze single file
```

### `lgrep watch <path>`

Watch for file changes and update index automatically.

```bash
lgrep watch .                  # Start watching current directory
lgrep watch ./src --name proj  # Watch with custom index name
```

### `lgrep stop <index-name>`

Stop a running watcher.

```bash
lgrep stop my-project          # Stop watching
```

### `lgrep delete <index-name>`

Delete an index.

```bash
lgrep delete my-project
```

### `lgrep clean`

Clean up failed, stale, and zombie indexes.

```bash
lgrep clean --dry-run    # Preview what would be cleaned
lgrep clean              # Clean all (zombies, failed, stale, stop watchers)
lgrep clean --failed     # Only failed indexes
lgrep clean --stale      # Only indexes with missing paths
lgrep clean --zombies    # Only stuck-building indexes
lgrep clean --watchers   # Stop all running watchers
```

### `lgrep config`

Manage configuration.

```bash
lgrep config list                                    # Show all settings
lgrep config get model                               # Get specific setting
lgrep config set summarizationModel anthropic:claude-3-5-haiku-latest
```

### Remote Storage

The preferred cloud architecture is Postgres for both the search index and the embedding cache:

- `pgvector` stores chunk embeddings for semantic search.
- regular Postgres tables store metadata, code-intel rows, and the embedding cache.

You can point both layers at the same managed Postgres database:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep config set storageMode postgres
lgrep config set storageDatabaseUrlEnv LGREP_DATABASE_URL

lgrep config set cacheBackend postgres
lgrep config set cacheDatabaseUrlEnv LGREP_DATABASE_URL
lgrep config set cacheTableName embedding_cache
```

Notes:

- The Postgres index backend requires the `vector` extension.
- lgrep will create its tables automatically on first use.
- The cache is still a keyed lookup table, not a vector-search table.
- You can keep the cache local if you want an L1 cache on a single machine.

S3/R2 is still supported as an optional alternative backend for indexes, but it is no longer the recommended default. If you want that path for cost or compatibility reasons, use `storageMode = s3` and the R2 auth flow:

```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."

lgrep auth r2 \
  --storage-uri s3://lgrep/indexes \
  --endpoint https://<account-id>.r2.cloudflarestorage.com
```

See [docs/guides/remote-storage.md](docs/guides/remote-storage.md) for the full Postgres setup, migration, rollback, and the optional S3/R2 variant.

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

Configuration is stored in a platform-specific location:
- **macOS**: `~/Library/Application Support/lgrep/config.json`
- **Linux**: `~/.config/lgrep/config.json` (or `$XDG_CONFIG_HOME/lgrep/`)
- **Windows**: `%APPDATA%\lgrep\config.json`

Override with `LGREP_HOME` environment variable.

```json
{
  "model": "auto",
  "summarizationModel": "auto",
  "storageMode": "local",
  "storageUri": "",
  "storageEndpoint": "",
  "storageRegion": "auto",
  "storageDatabaseUrlEnv": "LGREP_DATABASE_URL",
  "cacheBackend": "local",
  "cacheDatabaseUrlEnv": "LGREP_CACHE_DATABASE_URL",
  "cacheTableName": "embedding_cache",
  "cacheEnabled": true,
  "cacheMaxEntries": 50000,
  "cacheTtlHours": 0,
  "embedBatchSize": 10,
  "dbBatchSize": 250,
  "parallelFiles": 10
}
```

### Environment Variables

```bash
LGREP_HOME          # Config/data directory (default: ~/.lgrep)
OLLAMA_HOST         # Ollama server URL
AWS_ACCESS_KEY_ID   # Default S3-compatible access key env name for remote storage
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN
LGREP_DATABASE_URL  # Postgres URL for the remote index backend
LGREP_CACHE_DATABASE_URL # Postgres URL for remote embedding cache

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

- **Parallel file processing** - 10 files processed concurrently (configurable)
- **Cross-file embedding batching** - Batches chunks across multiple files
- **Batched embeddings** - 10 chunks per API call
- **Batched DB writes** - 250 chunks per flush
- **Incremental indexing** - Only reprocess changed files
- **File metadata table** - O(files) hash lookups

| Repo Size | Memory | Index Time |
|-----------|--------|------------|
| 1,000 files | ~150MB | ~2 min |
| 5,000 files | ~200MB | ~10 min |
| 10,000 files | ~300MB | ~20 min |

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

## Authors

- **Dennison Bertram** ([@dennisonbertram](https://github.com/dennisonbertram)) - Creator
- **Claude** (Anthropic) - AI pair programmer
