# Hosted Query Service

## What this is

This is the first hosted-cloud slice for lgrep.

Today it gives you:

- a shared HTTP query service backed by Postgres
- bearer-token protection for that service
- project-scoped token storage for hosted clients and agents
- remote project/worktree discovery from the CLI when `LGREP_SERVER_URL` is set
- remote semantic search from the CLI when `LGREP_SERVER_URL` is set

Today it does not yet give you:

- multi-tenant isolation
- per-project or per-user auth
- hosted indexing workers
- a hosted MCP endpoint

Think of this as a secure single-tenant team deployment, not the final lgrep Cloud product.

## Server setup

The server host needs the same Postgres-backed configuration used for BYO cloud mode:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep config storageMode postgres
lgrep config storageDatabaseUrlEnv LGREP_DATABASE_URL
lgrep config cacheBackend postgres
lgrep config cacheDatabaseUrlEnv LGREP_DATABASE_URL
```

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

## Client setup

On any client machine or agent host, point lgrep at the shared service and use the created token:

```bash
export LGREP_SERVER_URL="https://lgrep.example.com"
export LGREP_SERVER_AUTH_TOKEN="paste-the-created-token"
```

Discover the hosted project and its worktrees:

```bash
lgrep project list
lgrep project info repo-main
lgrep worktree list --project repo-main
```

Then run project- or worktree-scoped semantic search:

```bash
lgrep search "authentication flow" --project repo-main
lgrep search "request validation" --project repo-main --worktree main
lgrep search "login state bug" --project repo-main --worktree feature-login
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
- Remote CLI usage currently covers hosted discovery plus semantic search. Code-intelligence commands still use direct storage access.
- Indexing is still a write-side CLI workflow pointed at Postgres, not a managed hosted job system.
- Token management is local-file-based. There is no hosted admin API yet.

## Recommended deployment shape

For now, the most practical setup is:

1. Use managed Postgres with `pgvector`.
2. Create one `project` per repo and one `worktree` per branch or checkout you want searchable.
3. Mint one scoped server token per agent or team workflow with `lgrep server token create`.
4. Run `lgrep server start` behind a private network or reverse proxy.
5. Give agents only `LGREP_SERVER_URL` and their scoped `LGREP_SERVER_AUTH_TOKEN`, not database credentials.

That keeps the read/query path closer to the eventual hosted product while leaving write/index flows on the existing BYO Postgres path.
