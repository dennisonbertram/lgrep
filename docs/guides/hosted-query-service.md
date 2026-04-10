# Hosted Query Service

## What this is

This is the first hosted-cloud slice for lgrep.

Today it gives you:

- a shared HTTP query service backed by Postgres
- bearer-token protection for that service
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
export LGREP_SERVER_AUTH_TOKEN="$(openssl rand -hex 32)"

lgrep config storageMode postgres
lgrep config storageDatabaseUrlEnv LGREP_DATABASE_URL
lgrep config cacheBackend postgres
lgrep config cacheDatabaseUrlEnv LGREP_DATABASE_URL
```

Start the shared query service:

```bash
lgrep server start --port 8420
```

If `LGREP_SERVER_AUTH_TOKEN` is set, the server requires `Authorization: Bearer ...` on both `/health` and `/query`.

## Client setup

On any client machine or agent host, point lgrep at the shared service:

```bash
export LGREP_SERVER_URL="https://lgrep.example.com"
export LGREP_SERVER_AUTH_TOKEN="..."
```

Then run project- or worktree-scoped semantic search:

```bash
lgrep search "authentication flow" --project my-project
lgrep search "request validation" --project my-project --worktree main
```

When `LGREP_SERVER_URL` is set, `lgrep search` will use the hosted service for semantic search if:

- `--project` or `--worktree` is provided
- `--index` is not provided
- the query is a normal semantic search, not `--definition`, `--usages`, or `--type`

## Health and operations

Check the hosted service:

```bash
lgrep server status
```

The response includes:

- auth mode
- Postgres connectivity
- project/worktree counts
- shared chunk counts

## Current limitations

- This is still single-tenant. One server token protects the whole service.
- Remote CLI usage is currently semantic-search-first. Code-intelligence commands still use direct storage access.
- Indexing is still a write-side CLI workflow pointed at Postgres, not a managed hosted job system.

## Recommended deployment shape

For now, the most practical setup is:

1. Use managed Postgres with `pgvector`.
2. Run `lgrep server start` behind a private network or reverse proxy.
3. Store `LGREP_SERVER_AUTH_TOKEN` in the service environment.
4. Give agents only `LGREP_SERVER_URL` and `LGREP_SERVER_AUTH_TOKEN`, not database credentials.

That keeps the read/query path closer to the eventual hosted product while leaving write/index flows on the existing BYO Postgres path.
