# Remote Storage

## Overview

lgrep now supports two cloud layouts:

1. Preferred: managed Postgres for both the vector index and the embedding cache.
2. Optional: S3/R2 for the index plus Postgres for the embedding cache.

The preferred layout is simpler and usually the better default:

- one backend instead of two
- `pgvector` for semantic search
- normal Postgres tables for metadata, code-intel rows, and the cache
- less local disk usage without introducing object storage into the hot path

## What moves remote

With the Postgres-first layout, these all move off the local machine:

- index metadata
- chunk embeddings and chunk content
- code-intelligence tables
- embedding cache rows

What stays local:

- `config.json`
- first-run state

## Hosted query service preview

If you want agents to query lgrep without direct database credentials, run the shared query server on top of the same Postgres-backed setup:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep server install-remote user@host \
  --server-url https://lgrep.example.com
```

Then bootstrap the repo and worktrees into that hosted Postgres:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"

lgrep server bootstrap /path/to/repo --project repo-main --branch main
```

Clients and agents can then query through the hosted endpoint:

```bash
export LGREP_SERVER_URL="https://lgrep.example.com"
export LGREP_SERVER_AUTH_TOKEN="your-hosted-service-token"

lgrep project info repo-main
lgrep worktree list --project repo-main
lgrep search "entry point" --project repo-main
lgrep callers createSession --project repo-main --worktree feature-login
lgrep impact createSession --project repo-main --worktree feature-login
lgrep context "trace session token flow" --project repo-main --worktree feature-login
```

This hosted path is currently a single-tenant query layer. For self-hosted SSH deployments, `lgrep server install-remote` provisions the remote token store for you, installs Linux prerequisites when needed, installs a supported Node runtime when the system one is too old, and falls back to `tmux` on hosts without usable `systemd`; it is the preferred auth path today. For Railway and other stateless remote deployments, use the shared `LGREP_SERVER_AUTH_TOKEN` service secret. See [hosted-query-service.md](./hosted-query-service.md) for the supported workflow, global client install path, hosted MCP setup, Railway deployment path, and current limitations, and [self-hosted-ssh-runbook.md](./self-hosted-ssh-runbook.md) for the step-by-step Hetzner/Mac-mini runbook.

If your real goal is "one hosted Postgres database with many worktrees under one project", start with [hosted-query-service.md](./hosted-query-service.md). That guide is the clearest end-to-end path for the current hosted setup.

## Preferred setup: Postgres for index and cache

Create or use a Postgres database with the `vector` extension available. Many managed providers expose this as `pgvector`.

Export a connection string:

```bash
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"
```

Configure lgrep to use Postgres for the index:

```bash
lgrep config storageMode postgres
lgrep config storageDatabaseUrlEnv LGREP_DATABASE_URL
```

Point the embedding cache at the same database:

```bash
lgrep config cacheBackend postgres
lgrep config cacheDatabaseUrlEnv LGREP_DATABASE_URL
lgrep config cacheTableName embedding_cache
```

Notes:

- lgrep creates its index, metadata, and cache tables automatically.
- lgrep will attempt `CREATE EXTENSION IF NOT EXISTS vector` on startup.
- If your database user cannot enable extensions, enable `vector` ahead of time and reuse that database.
- The cache is a keyed lookup table, not a vector-search table.

## Optional alternative: S3/R2 for the index

If you still want object storage for the index, keep `storageMode = s3` and use Postgres only for the cache.

Create an R2 bucket and an API token with read/write access to that bucket, then export credentials:

```bash
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
```

Configure lgrep:

```bash
lgrep config storageMode s3
lgrep config storageUri s3://my-r2-bucket/lgrep
lgrep config storageEndpoint https://<account-id>.r2.cloudflarestorage.com
lgrep config storageRegion auto
lgrep config storageAccessKeyEnv R2_ACCESS_KEY_ID
lgrep config storageSecretKeyEnv R2_SECRET_ACCESS_KEY
```

Optional session token env override:

```bash
lgrep config storageSessionTokenEnv AWS_SESSION_TOKEN
```

For a machine-local install shared by coding agents on the same machine, prefer the keychain-backed auth flow over repo-local `.env` files:

```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."

lgrep auth r2 \
  --storage-uri s3://lgrep/indexes \
  --endpoint https://<account-id>.r2.cloudflarestorage.com
```

This stores the R2 credentials in the local macOS keychain and updates the global lgrep config to use keychain-backed S3/R2 access.

## Cache policy

The embedding cache can be local or Postgres-backed. You can tune or disable it:

```bash
lgrep config cacheEnabled true
lgrep config cacheMaxEntries 50000
lgrep config cacheTtlHours 0
```

Notes:

- `cacheMaxEntries = 0` means unlimited
- `cacheTtlHours = 0` disables TTL-based expiry
- `cacheEnabled = false` disables cache reads and writes entirely

## Migrating from local storage

Migration is reindex-based. Existing local indexes are not copied automatically, and local cache entries are not backfilled into Postgres.

Recommended flow:

```bash
# 1. Point lgrep at Postgres
export LGREP_DATABASE_URL="postgres://user:password@host:5432/lgrep"
lgrep config storageMode postgres
lgrep config storageDatabaseUrlEnv LGREP_DATABASE_URL

# 2. Point the embedding cache at Postgres
lgrep config cacheBackend postgres
lgrep config cacheDatabaseUrlEnv LGREP_DATABASE_URL
lgrep config cacheTableName embedding_cache

# 3. Reindex the repo into Postgres
lgrep index /path/to/repo --name my-project

# 4. Verify the remote index
lgrep list
lgrep stats --index my-project
lgrep search "entry point" --index my-project

# 5. Remove the old local index if you no longer need it
lgrep config storageMode local
lgrep delete my-project
lgrep config storageMode postgres
```

## Rollback to local storage

Switch configuration back to local mode:

```bash
lgrep config storageMode local
lgrep config storageUri ""
lgrep config storageEndpoint ""
lgrep config cacheBackend local
```

After rollback, local indexes continue to work as before. Remote indexes remain in whichever backend you were using last until you explicitly delete them while `storageMode` points at that backend, and remote cache rows remain in Postgres until you remove them yourself.

## Operational notes

- `stats` only reports database directory size in local mode.
- `doctor` and `clean` now query the storage layer instead of assuming a local `db` directory.
- The MCP server uses the same storage config resolution as the CLI.
- The hosted query service can use either a remote token-store file or the shared `LGREP_SERVER_AUTH_TOKEN`, depending on deployment style.
- The Postgres index and the Postgres cache can share one database or use separate databases.
- The remote cache currently uses environment-variable configuration for the Postgres connection string.
- S3/R2 remains supported, but it is now the secondary path rather than the default recommendation.
- The current cloud layout and hosted query service are still single-tenant. A full hosted product will still need tenant isolation for metadata, credentials, cache scope, and write coordination.
