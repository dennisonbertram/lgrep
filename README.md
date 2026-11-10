# lgrep

Semantic code search CLI. Find code by meaning, not just text, using a local index (LanceDB) or a Postgres-backed cloud profile.

Search for "authentication logic" and find OAuth handlers, JWT validation, and session management, even if those words never appear in the code. The same index powers code-intelligence commands that find dead code and circular dependencies and show the blast radius of a change.

**Status:** repository version 0.2.1 (MIT). As of November 2026, `npm view lgrep version` returns 0.1.2, so the npm package is older than this source tree; use the source install below for the latest features. The local CLI is the main path. The hosted query service is a preview (see below).

**Languages:** JavaScript, TypeScript, Solidity, Go, Rust, Python, C, C++ and Java (`src/core/ast/languages.ts`).

## Install

Requires Node.js >= 18.17.

```bash
npm install -g lgrep
lgrep init
```

`lgrep init` walks you through the two supported first-run paths:

- `Local` - local index and local cache
- `Cloud` - Postgres-backed index and Postgres-backed cache

From source:

```bash
git clone https://github.com/dennisonbertram/lgrep && cd lgrep
npm install --legacy-peer-deps
npm run build
node dist/cli/index.js init
```

## Quick Start

```bash
lgrep init
lgrep doctor
lgrep list
lgrep search "user authentication logic"
lgrep search --usages "validateUser"
lgrep search --definition "UserService"
lgrep context "add rate limiting"
lgrep intent "what calls awardBadge"
```

## Repo map

- `src/cli/` - CLI commands
- `src/core/` - chunking, embeddings, AST analysis, file watcher, context builder
- `src/storage/` - index, cache and config storage (LanceDB, Postgres)
- `src/server/` - hosted query service
- `src/mcp/` - MCP server (`lgrep-mcp`)
- `viewer/` - dependency graph web UI
- `docs/guides/` - deeper guides (providers, remote storage, hosted service, releasing)

## Agent Integration

```bash
lgrep install --target claude
lgrep install --target codex
lgrep install --target mcp
lgrep install --target all
lgrep install --target all --global --server-url https://lgrep.example.com --server-auth-token <token>
```

Targets:

- `claude` installs the Claude skill, the SessionStart hook, and repo-local `CLAUDE.md` guidance by default
- `codex` writes guidance into `AGENTS.md` or `~/.codex/AGENTS.md` when `--global` is used
- `mcp` configures lgrep as an MCP server
- `all` installs all three

Session start behavior:

- In local mode, the Claude SessionStart hook can clean stale state and start local watchers automatically.
- In cloud mode, the SessionStart hook verifies the hosted service is reachable and tells agents when a repo is simply unbound on first run, with concrete next steps (`lgrep project list`, `lgrep worktree bind`, or local indexing).
- Codex currently uses installed `AGENTS.md` instructions as its startup ritual. OpenAI’s documented Codex surfaces today are `AGENTS.md` and `notify`, not a SessionStart-style hook.
- For Codex or manual sessions, start with `lgrep` first. Use `lgrep doctor` for local setup/debugging, or `lgrep worktree resolve` plus `lgrep project list` for hosted connectivity and first-run binding checks.

For a machine-wide hosted setup, use:

```bash
lgrep install --target all --global \
  --server-url https://lgrep.example.com \
  --server-auth-token <token>
```

That persists the hosted URL and token into the active lgrep profile, updates `~/.claude/CLAUDE.md`, updates `~/.codex/AGENTS.md`, and carries the same hosted settings into the MCP config.

The intended workflow is:

1. Install lgrep integration.
2. Let the SessionStart hook prepare local or hosted lgrep automatically when Claude starts.
3. If hosted, use `lgrep worktree resolve` to confirm the current worktree binding. If it says no match, treat that as a first-run unbound repo, not a generic outage.
4. Use `lgrep search`, `lgrep callers`, `lgrep impact`, or `lgrep context` before broad `rg`/`grep` searches.

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
| `lgrep init` | Guided setup for local or cloud profiles |
| `lgrep profile` | Manage named local/cloud profiles |
| `lgrep worktree resolve` | Show which hosted project/worktree the current git worktree resolves to |
| `lgrep worktree bind` | Create or repair an explicit hosted binding for the current git worktree |
| `lgrep server` | Run or inspect the shared hosted query service |
| `lgrep server bootstrap` | Bootstrap a hosted project, worktrees, and token |
| `lgrep server install-remote <ssh-target>` | Provision a self-hosted server over SSH and optionally configure this machine globally |
| `lgrep server token` | Create and inspect scoped hosted query tokens |

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
| **Ollama** | ~1-5s | Privacy, offline | `lgrep init` |

```bash
lgrep config model auto                 # auto-detect (default)
lgrep config model voyage:voyage-code-3 # explicit
```

### LLM Providers (Summarization)

Auto-detected. Priority: Groq > Anthropic > OpenAI > Ollama.

```bash
lgrep config summarizationModel auto                   # default
lgrep config summarizationModel groq:llama-3.1-8b-instant # explicit
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

For cloud mode, lgrep defaults to Postgres for both the index and the cache. S3/R2 is still supported as an advanced/manual path, but it is no longer the default onboarding route.

See [docs/guides/remote-storage.md](docs/guides/remote-storage.md) for setup.

## Hosted Query Service (preview)

lgrep can run behind a shared HTTP query service so agents do not need direct database credentials. Today it is a bearer-token-protected, single-tenant query layer for project/worktree discovery, semantic search, callers, impact, and context packages. Hosted semantic `search` and `context` need an embedding provider on the server, such as `OPENAI_API_KEY`.

Self-host on any SSH-accessible machine:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep server install-remote user@host \
  --server-url https://lgrep.example.com
```

This command also configures the local machine globally for Claude, Codex, and MCP (a global `lgrep install` pointed at the new server). Pass `--skip-local-install` to skip that step.

Register a repo and its worktrees, then query it:

```bash
lgrep server bootstrap /path/to/repo \
  --project repo-main \
  --branch main \
  --worktree 'feature-login|/path/to/repo-feature-login|feature/login'

lgrep search "authentication flow" --project repo-main
lgrep callers createSession --project repo-main --worktree feature-login
```

Hosted `search --definition` and `search --usages` are not sent to the hosted service. They still open the configured database, so a client with only a hosted URL and token will fail on them today.

Another client machine can point at the service with `LGREP_SERVER_URL` and `LGREP_SERVER_AUTH_TOKEN`. Self-hosted SSH deployments use a filesystem-backed token store (`lgrep server token create`); Railway and other stateless deployments use the service-wide `LGREP_SERVER_AUTH_TOKEN`.

Planned next, per the earlier README: hosted HTTP MCP transport, richer hosted code intelligence (definitions/usages, deeper impact analysis), and background sync and indexing workers.

Details: [hosted-query-service.md](docs/guides/hosted-query-service.md) and [self-hosted-ssh-runbook.md](docs/guides/self-hosted-ssh-runbook.md).

## Programmatic API

```typescript
import { createEmbeddingClient, createAIProvider, detectBestProvider } from 'lgrep';

const embedder = createEmbeddingClient({ model: 'auto' });
const { embeddings } = await embedder.embed(['hello world']);

const ai = createAIProvider({ model: detectBestProvider() });
const explanation = await ai.generateText('Explain this code...');
```

## Configuration

By default, lgrep reads config from the active profile. You can manage profiles with `lgrep profile`.

```bash
lgrep profile list
lgrep profile create cloud
lgrep profile use cloud
lgrep config                   # show all settings
lgrep config model             # get one
lgrep config model auto        # set one
lgrep doctor                   # check everything
```

You can still override everything with `LGREP_HOME` for a one-off isolated home:

```bash
LGREP_HOME="$HOME/Library/Application Support/lgrep-local" lgrep doctor
LGREP_HOME="$HOME/Library/Application Support/lgrep-local" lgrep index . --name my-project
```

## Contributing

```bash
git clone https://github.com/dennisonbertram/lgrep && cd lgrep
npm install --legacy-peer-deps
npm run build
npm test
```

Maintainers: see [docs/guides/releasing.md](docs/guides/releasing.md) for npm release setup and the tag-based publish flow.

## License

MIT
