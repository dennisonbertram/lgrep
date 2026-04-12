# lgrep

AI-powered semantic code search. Find code by meaning, not just text.

Search for "authentication logic" and find OAuth handlers, JWT validation, and session management — even if those words never appear in the code. Built-in code intelligence finds dead code, circular dependencies, and shows blast radius before refactoring.

## Install

Requires Node.js >= 18.17.

```bash
npm install -g lgrep
lgrep init
```

`lgrep init` walks you through the two supported first-run paths:

- `Local` - local index and local cache
- `Cloud` - Postgres-backed index and Postgres-backed cache

### From Source

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

## Agent Integration

```bash
lgrep install --target claude
lgrep install --target codex
lgrep install --target mcp
lgrep install --target all
lgrep install --target all --global --server-url https://lgrep.example.com --server-auth-token <token>
```

Targets:

- `claude` installs the Claude skill and SessionStart hook
- `codex` writes guidance into `AGENTS.md` or `~/.codex/AGENTS.md` when `--global` is used
- `mcp` configures lgrep as an MCP server
- `all` installs all three

In local mode, the SessionStart hook can start local watchers automatically. In cloud mode, the hook exits immediately and relies on the shared remote index.

For a machine-wide hosted setup, use:

```bash
lgrep install --target all --global \
  --server-url https://lgrep.example.com \
  --server-auth-token <token>
```

That persists the hosted URL and token into the active lgrep profile, updates `~/.claude/CLAUDE.md`, updates `~/.codex/AGENTS.md`, and carries the same hosted settings into the MCP config.

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

## Hosted Query Service Preview

You can also run lgrep behind a shared HTTP query service instead of giving every agent direct database credentials.

### Fastest Self-Hosted Path

For a Mac mini, Hetzner box, or any SSH-accessible machine:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep server install-remote user@host \
  --server-url https://lgrep.example.com
```

That will:

- install `lgrep` on the remote host
- install a supported Node runtime when the host's system `node` is too old
- install Linux build/runtime prerequisites when the host needs them
- provision a `launchd`, working `systemd`, or `tmux` service runner
- create a remote token-store file for hosted auth
- configure this machine globally for Claude, Codex, and MCP unless you pass `--skip-local-install`

For the exact Hetzner/Mac-mini runbook, including the tmux tunnel/bootstrap flow for many local worktrees, see [docs/guides/self-hosted-ssh-runbook.md](docs/guides/self-hosted-ssh-runbook.md).

### Project Bootstrap

Then register a repo and its worktrees in the same hosted Postgres:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep server bootstrap /path/to/repo \
  --project repo-main \
  --branch main \
  --worktree 'feature-login|/path/to/repo-feature-login|feature/login'
```

### Client Usage

After a global install, this machine can just use `lgrep` directly:

```bash
lgrep project info repo-main
lgrep worktree list --project repo-main
lgrep search "authentication flow" --project repo-main
lgrep callers createSession --project repo-main --worktree feature-login
```

If you want to configure another client machine manually:

```bash
export LGREP_SERVER_URL="https://lgrep.example.com"
export LGREP_SERVER_AUTH_TOKEN="your-hosted-service-token"
lgrep project info repo-main
lgrep worktree list --project repo-main
lgrep search "authentication flow" --project repo-main
lgrep callers createSession --project repo-main --worktree feature-login
lgrep impact createSession --project repo-main --worktree feature-login
lgrep context "trace session token flow" --project repo-main --worktree feature-login
```

Hosted semantic `search` and hosted `context` need a real embedding provider on the server, such as `OPENAI_API_KEY`. Hosted `search --definition` and `search --usages` remain database-backed client flows today.

If you want MCP clients to use the hosted service without shell exports, run:

```bash
lgrep install --target mcp --global \
  --server-url https://lgrep.example.com \
  --server-auth-token <token>
```

Today this hosted path is a bearer-token-protected, single-tenant query layer for project/worktree discovery, semantic search, callers, impact, and context packages. For self-hosted SSH deployments, `lgrep server install-remote` provisions a filesystem-backed token store on the remote host, which is the recommended auth path today. For Railway and other stateless remote deployments, keep using the service-wide `LGREP_SERVER_AUTH_TOKEN`. See [docs/guides/hosted-query-service.md](docs/guides/hosted-query-service.md) for the hosted multi-worktree workflow, SSH self-host path, Railway deploy path, and current limits.

### If You Want To Use Hosted Mode Today

This is the practical next step if your goal is "one hosted database, many worktrees":

1. Create a `cloud` profile that points at Postgres.
2. Create one `project` for your repo.
3. Create one `worktree` per branch or checkout you want searchable.
4. Run `lgrep server start` on the machine that has Postgres access.
5. For self-hosted deployments, you can mint a scoped token with `lgrep server token create`.
6. For Railway and similar remote deployments today, use the shared `LGREP_SERVER_AUTH_TOKEN` service secret.
7. Point agents at `LGREP_SERVER_URL` plus `LGREP_SERVER_AUTH_TOKEN`.

That is enough to start using hosted lgrep now.

### What We Are Building Next

The next product step is not another setup step for you. It is feature expansion on top of the hosted query service:

- hosted HTTP MCP transport
- richer hosted code-intel coverage like definitions/usages and deeper impact analysis
- background sync and hosted indexing workers

Those will make the hosted path more useful for agents, but they are not required for the current multi-worktree setup.

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

## License

MIT

## Contributing

```bash
git clone https://github.com/dennisonbertram/lgrep && cd lgrep
npm install --legacy-peer-deps
npm run build
npm test
```

Maintainers: see [docs/guides/releasing.md](docs/guides/releasing.md) for npm release setup and the tag-based publish flow.
