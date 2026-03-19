# lgrep

<p align="center">
  <img src="assets/hero-mural-v2.png" alt="lgrep — semantic code search" width="100%" />
</p>

**Grep understands text. lgrep understands code.**

Search for "authentication logic" and find your OAuth handlers, JWT validation, and session management — even when those words never appear in the source. Ask "what happens if I change setScore" and see the full blast radius before you touch a line.

Traditional code search tools match strings. IDE "find references" works for one symbol at a time. lgrep gives you both — semantic search that understands intent *and* code intelligence that maps your entire codebase's structure — in a single CLI that runs locally or in the cloud.

## What You Get

- **Semantic search** — find code by what it does, not what it's named
- **Code intelligence** — dead code, circular deps, unused exports, breaking changes, impact analysis
- **Context builder** — automatically assemble the right files for an LLM prompt
- **Dependency graph** — interactive web UI showing how your code connects
- **Watch mode** — indexes stay current as you edit
- **Works 100% locally** — Ollama for embeddings + LLM, LanceDB for storage, zero cloud dependencies
- **Or blazing fast with cloud APIs** — OpenAI, Voyage, Cohere, Groq, Anthropic — swap with one config change
- **Claude Code native** — install as a skill or MCP server and Claude uses it automatically

## Install

Requires Node.js >= 18.17.

```bash
npm install -g lgrep
```

**Cloud (fast, recommended):**
```bash
export OPENAI_API_KEY=sk-...    # or VOYAGE_API_KEY, COHERE_API_KEY
```

**Local (private, free):**
```bash
lgrep setup                     # installs Ollama + downloads ~2GB of models
```

Verify with `lgrep doctor`.

## Quick Start

```bash
lgrep index .                              # index your project
lgrep search "user authentication logic"   # semantic search
lgrep search --usages "validateUser"       # find all call sites
lgrep search --definition "UserService"    # jump to definition
lgrep context "add rate limiting"          # build LLM context for a task
lgrep intent "what calls awardBadge"       # natural language — lgrep picks the right command
```

## Claude Code Integration

```bash
lgrep install       # add skill + SessionStart hook
lgrep install-mcp   # or install as MCP server
```

After install, Claude automatically uses lgrep for semantic search, code intelligence, and context building when working in your repos.

## Commands

### Core

| Command | Purpose |
|---------|---------|
| `lgrep index <path>` | Index a directory (`--update`, `--force`, `--name`) |
| `lgrep search <query>` | Semantic search (`--usages`, `--definition`, `--type`) |
| `lgrep context <task>` | Build LLM context (`--max-tokens`, `--depth`, `--format`) |
| `lgrep intent <prompt>` | Natural language command routing |
| `lgrep list` | List all indexes |
| `lgrep watch <path>` | Auto-update index on file changes |
| `lgrep stop <name>` | Stop a watcher |
| `lgrep delete <name>` | Delete an index |
| `lgrep clean` | Remove failed/stale/zombie indexes |

### Code Intelligence

All of these work against the code-intel tables the indexer already builds — no extra setup.

| Command | Purpose |
|---------|---------|
| `lgrep dead` | Functions with zero callers |
| `lgrep similar` | Duplicated function bodies |
| `lgrep cycles` | Circular dependency chains |
| `lgrep unused-exports` | Exported but never imported symbols |
| `lgrep breaking` | Calls with mismatched argument counts |
| `lgrep rename <old> <new>` | Preview every reference a rename would touch |
| `lgrep callers <symbol>` | All callers of a function |
| `lgrep deps <module>` | Module dependency graph |
| `lgrep impact <symbol>` | Blast radius — direct + transitive callers |

### Explore & Visualize

| Command | Purpose |
|---------|---------|
| `lgrep graph` | Interactive dependency graph in the browser (`--mode calls\|deps`) |
| `lgrep analyze <path>` | One-off structure analysis (`--symbols`, `--deps`, `--calls`) |
| `lgrep symbols [query]` | Quick symbol lookup (`-k function`, `-f auth.ts`) |
| `lgrep explain <target>` | AI-powered explanation of a file or symbol |
| `lgrep stats` | Index statistics |
| `lgrep logs` | Watcher daemon logs (`-f` to follow) |
| `lgrep daemon` | In-memory query daemon for instant responses (`start\|stop\|list`) |

All commands support `--json` for scripting. Most support `-i, --index` and `-l, --limit`.

## Providers

lgrep auto-detects the best available provider from your environment. Everything falls back to Ollama when no API keys are set.

### Embeddings

| Provider | Speed | Best For | Setup |
|----------|-------|----------|-------|
| **OpenAI** | ~50ms | General (recommended) | `OPENAI_API_KEY` |
| **Voyage** | ~100ms | Code-optimized | `VOYAGE_API_KEY` |
| **Cohere** | ~50ms | Multilingual | `COHERE_API_KEY` |
| **Ollama** | ~1-5s | Privacy, offline, free | `lgrep setup` |

### LLM (Summarization & Explain)

| Provider | Speed | Setup |
|----------|-------|-------|
| **Groq** | ~100ms | `GROQ_API_KEY` |
| **Anthropic** | ~1.5s | `ANTHROPIC_API_KEY` |
| **OpenAI** | ~2s | `OPENAI_API_KEY` |
| **Ollama** | ~3s | `lgrep setup` |

```bash
lgrep config set model "auto"                  # embedding provider (default)
lgrep config set summarizationModel "auto"     # LLM provider (default)
```

## Storage

**Local by default** — LanceDB stores everything on disk, no server required.

**Cloud options** for shared indexes:
- **Postgres + pgvector** — recommended for teams. See [remote storage guide](docs/guides/remote-storage.md).
- **S3/R2** — alternative backend for cost or compatibility.

## Project Config

Drop a `.lgrep.json` in your repo root to skip `--index` flags:

```json
{
  "index": "my-project",
  "root": "src"
}
```

## Programmatic API

```typescript
import { createEmbeddingClient, createAIProvider, detectBestProvider } from 'lgrep';

const embedder = createEmbeddingClient({ model: 'auto' });
const { embeddings } = await embedder.embed(['hello world']);

const ai = createAIProvider({ model: detectBestProvider() });
const explanation = await ai.generateText('Explain this code...');
```

## Configuration

```bash
lgrep config list              # show all settings
lgrep config get model         # get one
lgrep config set model "auto"  # set one
lgrep doctor                   # verify everything
```

Config location: `~/Library/Application Support/lgrep/config.json` (macOS), `~/.local/share/lgrep/config.json` (Linux). Override with `LGREP_HOME`.

## License

MIT

## Contributing

```bash
git clone https://github.com/dennisonbertram/lgrep && cd lgrep
npm install && npm test
```
