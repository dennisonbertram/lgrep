# Project Configuration

## lgrep - Local Semantic Code Search

**Use lgrep for code exploration and context building.**

### When to Use

- Searching for code by meaning
- Understanding how the codebase works
- Building context for implementing features
- Finding where functionality is implemented
- Locating relevant files for a task
- Diagnosing configuration issues

### Quick Commands

```bash
# Check health and configuration
lgrep doctor

# Search semantically
lgrep search "user authentication" --index PROJECT_NAME

# Find usages
lgrep search --usages "functionName" --index PROJECT_NAME

# Find definition
lgrep search --definition "ClassName" --index PROJECT_NAME

# Build context for a task
lgrep context "implement feature X" --index PROJECT_NAME

# Natural language intent routing
lgrep intent "what calls awardBadge"

# List available indexes
lgrep list
```

### All Commands

| Command | Purpose |
|---------|---------|
| **Core** | |
| `lgrep index <path>` | Index a directory for semantic search |
| `lgrep search <query>` | Semantic code search |
| `lgrep context <task>` | Build context package for a task |
| `lgrep intent <prompt>` | Natural language command routing |
| `lgrep list` | List all indexes |
| `lgrep watch <path>` | Auto-update index on file changes |
| `lgrep stop <name>` | Stop a running watcher |
| `lgrep delete <name>` | Delete an index |
| `lgrep clean` | Remove failed/stale/zombie indexes |
| **Code Intelligence** | |
| `lgrep dead` | Find functions with zero callers |
| `lgrep similar` | Find duplicated function bodies |
| `lgrep cycles` | Detect circular dependencies |
| `lgrep unused-exports` | Find exported but never imported symbols |
| `lgrep breaking` | Find calls with mismatched arguments |
| `lgrep rename <old> <new>` | Preview rename impact |
| `lgrep callers <symbol>` | Find all callers of a function |
| `lgrep deps <file>` | Show file dependencies |
| `lgrep impact <symbol>` | Analyze change impact |
| **Analysis & Exploration** | |
| `lgrep graph` | Visualize code dependencies in a web UI |
| `lgrep analyze <path>` | Analyze code structure without indexing |
| `lgrep symbols [query]` | Quick symbol lookup by name |
| `lgrep explain <target>` | AI-powered explanation of a file or symbol |
| `lgrep stats` | Show index statistics |
| `lgrep logs` | View watcher daemon logs |
| **Configuration & Setup** | |
| `lgrep doctor` | Check health, config, and indexing status |
| `lgrep config` | Manage configuration |
| `lgrep setup` | Auto-install Ollama and download models |
| `lgrep install` | Install Claude Code integration (skill + hook) |
| `lgrep install-mcp` | Install lgrep as an MCP server |
| `lgrep auth r2` | Configure R2/S3 remote storage credentials |
| `lgrep daemon` | Manage query daemon (start/stop/list/query/logs) |

### Embedding Providers

lgrep supports multiple embedding providers for fast vector generation:

| Provider | Model | Speed | Best For |
|----------|-------|-------|----------|
| **OpenAI** | `openai:text-embedding-3-small` | ~50ms | General (recommended) |
| **Cohere** | `cohere:embed-english-v3.0` | ~50ms | Multilingual |
| **Voyage** | `voyage:voyage-code-3` | ~100ms | Code search |
| **Ollama** | `ollama:mxbai-embed-large` | ~1-5s | Privacy, offline |

```bash
# Auto-detect best provider (based on API keys)
lgrep config set model "auto"

# Or specify explicitly
lgrep config set model "openai:text-embedding-3-small"
lgrep config set model "voyage:voyage-code-3"
```

**API Keys** (set in environment):
- `OPENAI_API_KEY` - OpenAI embeddings + LLM
- `COHERE_API_KEY` - Cohere embeddings
- `VOYAGE_API_KEY` - Voyage embeddings (code-optimized)
- `GROQ_API_KEY` - Groq LLM (fastest summarization)
- `ANTHROPIC_API_KEY` - Anthropic LLM

### LLM Providers (Summarization)

| Provider | Speed | API Key |
|----------|-------|---------|
| **Groq** | ~100ms | `GROQ_API_KEY` |
| **Anthropic** | ~1.5s | `ANTHROPIC_API_KEY` |
| **OpenAI** | ~2s | `OPENAI_API_KEY` |
| **Ollama** | ~3s | None (local) |

```bash
# Auto-detect LLM provider
lgrep config set summarizationModel "auto"

# Or specify
lgrep config set summarizationModel "groq:llama-3.1-8b-instant"
```

### Best Practices

1. **Run doctor first** - `lgrep doctor` diagnoses issues quickly
2. **Use the watcher** - Keep indexes up-to-date automatically
3. **Context builder first** - Use `lgrep context` for optimal file selection
4. **Leverage code intelligence** - `--usages` and `--definition` are powerful
5. **Adjust search diversity** - Use `--diversity` to balance variety vs precision
6. **JSON output** - Use `--json` for programmatic processing
7. **Use external providers** - Set API keys for 10-100x faster indexing

### Configuration

Config stored in platform-specific location (macOS: `~/Library/Application Support/lgrep/config.json`, Linux: `~/.local/share/lgrep/config.json`). Override with `LGREP_HOME` env var.

```bash
lgrep config list                    # Show all settings
lgrep config get model               # Get specific setting
lgrep config set model "auto"        # Set embedding model
lgrep config set summarizationModel "auto"  # Set LLM model
```

### Integration

The SessionStart hook automatically starts a watcher for the current directory.
Check running watchers with `lgrep list`.
