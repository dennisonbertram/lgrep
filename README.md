# lgrep

AI-powered semantic code search. Find code by meaning, not just text.

Search for "authentication logic" and find OAuth handlers, JWT validation, and session management — even if those words never appear in the code. Built-in code intelligence finds dead code, circular dependencies, and shows blast radius before refactoring.

## Install

Requires Node.js >= 18.17.

```bash
npm install -g lgrep
export OPENAI_API_KEY=sk-...   # or: VOYAGE_API_KEY, COHERE_API_KEY
lgrep doctor                   # verify setup
```

No API key? Run `lgrep setup` to install Ollama locally (free, ~2GB download).

## Quick Start

```bash
lgrep index .                              # index your project
lgrep search "user authentication logic"   # semantic search
lgrep search --usages "validateUser"       # find all usages of a symbol
lgrep search --definition "UserService"    # jump to definition
lgrep context "add rate limiting"          # build LLM context for a task
lgrep intent "what calls awardBadge"       # natural language query routing
```

## Claude Code Integration

```bash
lgrep install       # add skill + SessionStart hook
lgrep install-mcp   # or install as MCP server
```

Claude will automatically use lgrep for semantic search, code intelligence, and context building.

## Commands

### Core

| Command | Purpose |
|---------|---------|
| `lgrep index <path>` | Index a directory (`--update`, `--force`, `--name`) |
| `lgrep search <query>` | Semantic search (`--usages`, `--definition`, `--type`) |
| `lgrep context <task>` | Build context for LLM tasks (`--max-tokens`, `--depth`) |
| `lgrep intent <prompt>` | Natural language command routing |
| `lgrep list` | List all indexes |
| `lgrep watch <path>` | Auto-update index on file changes |
| `lgrep stop <name>` | Stop a watcher |
| `lgrep delete <name>` | Delete an index |
| `lgrep clean` | Remove failed/stale/zombie indexes |

### Code Intelligence

| Command | Purpose |
|---------|---------|
| `lgrep dead` | Functions with zero callers |
| `lgrep similar` | Duplicated function bodies |
| `lgrep cycles` | Circular dependency chains |
| `lgrep unused-exports` | Exported but never imported symbols |
| `lgrep breaking` | Calls with mismatched argument counts |
| `lgrep rename <old> <new>` | Preview rename impact |
| `lgrep callers <symbol>` | All callers of a function |
| `lgrep deps <module>` | Module dependency graph |
| `lgrep impact <symbol>` | Blast radius of a change |

### Analysis & Exploration

| Command | Purpose |
|---------|---------|
| `lgrep graph` | Visualize dependencies in a web UI (`--mode calls\|deps`) |
| `lgrep analyze <path>` | One-off code structure analysis (`--symbols`, `--deps`, `--calls`) |
| `lgrep symbols [query]` | Quick symbol lookup (`-k function`, `-f auth.ts`) |
| `lgrep explain <target>` | AI-powered explanation of a file or symbol |
| `lgrep stats` | Index statistics |
| `lgrep logs` | Watcher daemon logs (`-f` to follow) |
| `lgrep daemon` | Manage in-memory query daemons (`start\|stop\|list`) |

All commands support `--json` for scripting. Most support `-i, --index` and `-l, --limit`.

## Embedding Providers

| Provider | Speed | Best For | Setup |
|----------|-------|----------|-------|
| **OpenAI** | ~50ms | General (recommended) | `OPENAI_API_KEY` |
| **Voyage** | ~100ms | Code search | `VOYAGE_API_KEY` |
| **Cohere** | ~50ms | Multilingual | `COHERE_API_KEY` |
| **Ollama** | ~1-5s | Privacy, offline | `lgrep setup` |

```bash
lgrep config set model "auto"                       # auto-detect (default)
lgrep config set model "voyage:voyage-code-3"       # explicit
```

### LLM Providers (Summarization)

Auto-detected. Priority: Groq > Anthropic > OpenAI > Ollama.

```bash
lgrep config set summarizationModel "auto"                    # default
lgrep config set summarizationModel "groq:llama-3.1-8b-instant"  # explicit
```

## Project Config

Create `.lgrep.json` in your repo root to skip `--index` flags:

```json
{
  "index": "my-project",
  "root": "src"
}
```

## Remote Storage

Local by default. For shared/cloud indexes, use Postgres with pgvector or S3/R2.

See [docs/guides/remote-storage.md](docs/guides/remote-storage.md) for setup.

## Programmatic API

```typescript
import { createEmbeddingClient, createAIProvider, detectBestProvider } from 'lgrep';

const embedder = createEmbeddingClient({ model: 'auto' });
const { embeddings } = await embedder.embed(['hello world']);

const ai = createAIProvider({ model: detectBestProvider() });
const explanation = await ai.generateText('Explain this code...');
```

## Configuration

Config location: `~/Library/Application Support/lgrep/config.json` (macOS), `~/.local/share/lgrep/config.json` (Linux). Override with `LGREP_HOME`.

```bash
lgrep config list              # show all settings
lgrep config get model         # get one
lgrep config set model "auto"  # set one
lgrep doctor                   # check everything
```

## License

MIT

## Contributing

```bash
git clone https://github.com/dennisonbertram/lgrep && cd lgrep
npm install && npm test
```
