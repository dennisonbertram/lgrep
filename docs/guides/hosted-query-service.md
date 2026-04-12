# Hosted Query Service

## What this is

This is the first hosted-cloud slice for lgrep.

Today it gives you:

- a shared HTTP query service backed by Postgres
- bearer-token protection for that service
- filesystem-backed scoped tokens for self-hosted SSH deployments where you control the server host
- remote project/worktree discovery from the CLI when `LGREP_SERVER_URL` is set
- remote semantic search from the CLI when `LGREP_SERVER_URL` is set
- remote `callers`, `impact`, and `context` when `LGREP_SERVER_URL` is set and you target a project or worktree
- hosted MCP usage through the normal stdio MCP server by passing `LGREP_SERVER_URL` plus `LGREP_SERVER_AUTH_TOKEN`

Today it does not yet give you:

- multi-tenant isolation
- per-project or per-user auth
- hosted indexing workers
- an HTTP-native hosted MCP endpoint

Think of this as a secure single-tenant team deployment, not the final lgrep Cloud product.

## The simple version

If your goal is:

- one hosted Postgres database
- one Mac mini, Hetzner box, or other SSH-accessible server host
- one repo-level project
- many worktrees under that project
- agents querying it without direct database credentials

then the flow is:

1. Provision the remote host with `lgrep server install-remote <ssh-target> --server-url <url>`.
2. Create a `project`.
3. Add `worktree`s for each checkout or branch you want searchable.
4. Give agents the configured hosted URL and token, or let the global install write them into the active lgrep profile on this machine.

That is the current hosted setup. You do not need to wait for the later roadmap items to start using it.

## SSH self-hosted setup

This is the recommended deployment path today for a single developer who wants a dedicated Mac mini or Linux box to serve hosted lgrep to local tools and agents.

Prerequisites on the remote host:

- SSH access
- Node.js and npm installed
- network access to the Postgres instance

Run:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep server install-remote user@host \
  --server-url https://lgrep.example.com
```

What this does:

- installs the published `lgrep` package on the remote host
- installs Linux build/runtime prerequisites if the host is missing them
- writes a start script under `~/.lgrep-server/<service-name>/`
- provisions `launchd` on macOS, a working `systemd` service when available, or a `tmux` fallback on minimal/container-style Linux hosts
- creates a remote token-store JSON file for hosted auth
- configures this machine globally for Claude, Codex, and MCP unless you pass `--skip-local-install`

If you only want the remote host provisioned and do not want local machine changes:

```bash
lgrep server install-remote user@host \
  --server-url https://lgrep.example.com \
  --skip-local-install
```

## One-command bootstrap

If you want the quickest path, use:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep server bootstrap /path/to/repo \
  --project repo-main \
  --branch main \
  --worktree 'feature-login|/path/to/repo-feature-login|feature/login' \
  --worktree 'feature-billing|/path/to/repo-feature-billing|feature/billing'
```

What this does:

- configures the `cloud` profile for Postgres
- creates the project if it does not exist
- creates or updates the main worktree
- creates or updates additional worktrees
- mints a scoped hosted token for colocated/self-hosted use
- prints the exact server and client commands to use next

The `--worktree` format is:

```bash
name|/absolute/path/to/worktree|branch
```

The branch part is optional:

```bash
name|/absolute/path/to/worktree
```

## Manual server setup

The server host needs the same Postgres-backed configuration used for BYO cloud mode:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep config storageMode postgres
lgrep config storageDatabaseUrlEnv LGREP_DATABASE_URL
lgrep config cacheBackend postgres
lgrep config cacheDatabaseUrlEnv LGREP_DATABASE_URL
```

If you prefer to do it manually instead of using `lgrep server bootstrap`, the manual flow is below.

Create the project you want to expose:

```bash
lgrep project create repo-main
```

Index the main worktree:

```bash
lgrep worktree create /path/to/repo --project repo-main --name main --branch main
```

Add additional worktrees:

```bash
lgrep worktree fork main \
  --project repo-main \
  --name feature-login \
  --path /path/to/repo-feature-login \
  --branch feature/login
```

```bash
lgrep worktree fork main \
  --project repo-main \
  --name feature-billing \
  --path /path/to/repo-feature-billing \
  --branch feature/billing
```

Create a scoped hosted token for that project:

```bash
lgrep server token create --label "repo-main agents" --projects repo-main
```

This writes a hashed token record to the local token store, usually:

```bash
$LGREP_HOME/server-tokens.json
```

You can inspect configured scopes without revealing secrets:

```bash
lgrep server token list
```

Start the shared query service:

```bash
lgrep server start --port 8420
```

The server will accept:

- the legacy single token from `LGREP_SERVER_AUTH_TOKEN`, if set
- any scoped token stored in the local token store

For remote deployments like Railway, the service-wide `LGREP_SERVER_AUTH_TOKEN` is the supported auth path today. The scoped token file is local to the machine where you ran `lgrep server token create` unless you explicitly copy and manage that token store on the server.

## Client setup

If you used `lgrep server install-remote` without `--skip-local-install`, this machine is already configured. The hosted URL and token are stored in the active lgrep profile, and the global Claude/Codex/MCP files are updated.

For any other client machine or agent host, point lgrep at the shared service and use the created token:

```bash
export LGREP_SERVER_URL="https://lgrep.example.com"
export LGREP_SERVER_AUTH_TOKEN="paste-the-service-token"
```

You can also persist the same settings directly into the active profile on that machine:

```bash
lgrep install --target all --global \
  --server-url https://lgrep.example.com \
  --server-auth-token paste-the-service-token
```

Discover the hosted project and its worktrees:

```bash
lgrep project list
lgrep project info repo-main
lgrep worktree list --project repo-main
```

Then run hosted reads against the project or a specific worktree:

```bash
lgrep search "authentication flow" --project repo-main
lgrep search "request validation" --project repo-main --worktree main
lgrep search "login state bug" --project repo-main --worktree feature-login
lgrep callers createSession --project repo-main --worktree feature-login
lgrep impact createSession --project repo-main --worktree feature-login
lgrep context "trace session token flow" --project repo-main --worktree feature-login
```

When `LGREP_SERVER_URL` is set, `lgrep search` will use the hosted service for semantic search if:

- `--project` or `--worktree` is provided
- `--index` is not provided
- the query is a normal semantic search, not `--definition`, `--usages`, or `--type`

When `LGREP_SERVER_URL` is set, these commands also use the hosted service:

- `lgrep project list`
- `lgrep project info <name>`
- `lgrep worktree list`
- `lgrep worktree diff <a> <b>`
- `lgrep callers <symbol> --project <name> [--worktree <name>]`
- `lgrep impact <symbol> --project <name> [--worktree <name>]`
- `lgrep context "<task>" --project <name> [--worktree <name>]`

## Hosted MCP

The existing stdio MCP server can talk to the hosted query service.

Export the hosted env vars first:

```bash
export LGREP_SERVER_URL="https://lgrep.example.com"
export LGREP_SERVER_AUTH_TOKEN="paste-the-service-token"
```

Then install the MCP integration:

```bash
lgrep install --target mcp --global \
  --server-url https://lgrep.example.com \
  --server-auth-token paste-the-service-token
```

That writes the hosted settings into the MCP config so Claude/Codex can use the hosted project without direct database access.

## Railway deployment

This repo now includes a Railway-ready deployment shape:

- [nixpacks.toml](../../nixpacks.toml)
- [start-hosted-server.sh](../../scripts/start-hosted-server.sh)

The startup script automatically runs:

1. `lgrep init --mode cloud --yes --skip-index`
2. `lgrep server start --port $PORT`

That means a Railway container can boot entirely from environment variables.

Suggested setup:

1. Create a Railway Postgres service.
2. Create a service for this repo, for example `lgrep-server`.
3. Set `LGREP_DATABASE_URL` on `lgrep-server` to the Postgres `DATABASE_URL` reference.
4. Set `LGREP_SERVER_AUTH_TOKEN` on `lgrep-server` for one shared bearer token.
5. Set `OPENAI_API_KEY` on `lgrep-server` if you want hosted semantic search and hosted `context`.
6. Deploy the repo with `railway up -s lgrep-server`.
7. Generate a Railway domain for `lgrep-server`.
8. Bootstrap your project/worktrees into the same database from a machine that can reach Postgres:

```bash
export LGREP_DATABASE_URL="postgres://..."
lgrep server bootstrap /path/to/repo --project repo-main --branch main
```

Today, Railway should use the shared `LGREP_SERVER_AUTH_TOKEN` secret for clients and agents. The scoped token file created by `lgrep server token create` is local to the machine that created it unless you also mount and manage a shared token-store file on the service. For SSH-managed self-hosting, prefer `lgrep server install-remote`, which provisions that token store on the remote host for you.

## Health and operations

Check the hosted service:

```bash
lgrep server status
```

The response includes:

- auth mode
- scoped token count
- Postgres connectivity
- project/worktree counts
- shared chunk counts

## Current limitations

- This is still single-tenant. Tokens are scoped to projects/worktrees, but there is no tenant or org boundary yet.
- Remote CLI usage covers hosted discovery, semantic search, callers, impact, and context. Definitions/usages and the rest of code-intel still use direct storage access.
- Indexing is still a write-side CLI workflow pointed at Postgres, not a managed hosted job system.
- Token management is still file-based or legacy-env-based. There is no hosted admin API yet.

## What "next step" means

There are two different meanings of "next step":

### Next step for you as a user

Use the workflow in this guide:

1. create the cloud profile
2. create a project
3. add worktrees
4. create a scoped token
5. start the hosted query server
6. point agents at the hosted URL

### Next step for the product

The next engineering milestones are:

- hosted HTTP MCP transport
- hosted definitions/usages and richer code-intel endpoints
- eventually hosted indexing workers and full multi-tenancy

Those are improvements to the hosted experience. They are not blockers for the basic "one hosted DB, many worktrees" workflow that exists now.

## Recommended deployment shape

For now, the most practical setup is:

1. Use managed Postgres with `pgvector`.
2. Create one `project` per repo and one `worktree` per branch or checkout you want searchable.
3. For self-hosted deployments, provision the host with `lgrep server install-remote` so the token store lives on the server itself.
4. For manual or colocated deployments, mint one scoped server token per agent or team workflow with `lgrep server token create`.
5. Run `lgrep server start` behind a private network or reverse proxy.
6. Give agents only `LGREP_SERVER_URL` and their scoped `LGREP_SERVER_AUTH_TOKEN`, not database credentials.

That keeps the read/query path closer to the eventual hosted product while leaving write/index flows on the existing BYO Postgres path.
