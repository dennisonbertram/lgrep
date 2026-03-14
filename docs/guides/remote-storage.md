# Remote Storage

## Overview

lgrep can store generated index data in an S3-compatible object store instead of the local `db` directory under `LGREP_HOME`.

Phase 1 keeps the embedding cache local. Only the index database moves remote.

Recommended backend:

- Cloudflare R2 Standard for active indexes

## What moves remote

- Index metadata
- Chunk tables
- Code-intelligence tables

What stays local by default:

- `config.json`
- first-run state
- embedding cache

## Cloudflare R2 setup

Create an R2 bucket and an API token with read/write access to that bucket. Then export credentials:

```bash
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
```

Configure lgrep:

```bash
lgrep config set storageMode s3
lgrep config set storageUri s3://my-r2-bucket/lgrep
lgrep config set storageEndpoint https://<account-id>.r2.cloudflarestorage.com
lgrep config set storageRegion auto
lgrep config set storageAccessKeyEnv R2_ACCESS_KEY_ID
lgrep config set storageSecretKeyEnv R2_SECRET_ACCESS_KEY
```

Optional session token env override:

```bash
lgrep config set storageSessionTokenEnv AWS_SESSION_TOKEN
```

## Local install setup

For a machine-local lgrep install shared by coding agents on the same machine, prefer the keychain-backed auth flow over repo-local `.env` files:

```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."

lgrep auth r2 \
  --storage-uri s3://lgrep/indexes \
  --endpoint https://<account-id>.r2.cloudflarestorage.com
```

This stores the R2 credentials in the local macOS keychain and updates the global lgrep config to use:

- `storageMode = s3`
- `storageCredentialSource = keychain`
- `storageProfile = default`

After that, local coding agents can use the same lgrep install without depending on a repo-specific `.env`.

## Cache policy

The embedding cache remains local for indexing performance. You can tune or disable it:

```bash
lgrep config set cacheEnabled true
lgrep config set cacheMaxEntries 50000
lgrep config set cacheTtlHours 0
```

Notes:

- `cacheMaxEntries = 0` means unlimited
- `cacheTtlHours = 0` disables TTL-based expiry
- `cacheEnabled = false` disables cache reads and writes entirely

## Migrating from local storage

Phase 1 migration is reindex-based. Existing local indexes are not copied automatically.

Recommended flow:

```bash
# 1. Point lgrep at remote storage
lgrep config set storageMode s3
lgrep config set storageUri s3://my-r2-bucket/lgrep
lgrep config set storageEndpoint https://<account-id>.r2.cloudflarestorage.com
lgrep config set storageRegion auto

# 2. Reindex the repo into remote storage
lgrep index /path/to/repo --name my-project

# 3. Verify the remote index
lgrep list
lgrep stats --index my-project
lgrep search "entry point" --index my-project

# 4. Remove the old local index if you no longer need it
lgrep config set storageMode local
lgrep delete my-project
lgrep config set storageMode s3
```

## Rollback to local storage

Switch configuration back to local mode:

```bash
lgrep config set storageMode local
lgrep config set storageUri ""
lgrep config set storageEndpoint ""
```

After rollback, local indexes continue to work as before. Remote indexes remain in object storage until you explicitly delete them while `storageMode` points at the remote backend.

## Operational notes

- `stats` only reports database directory size in local mode.
- `doctor` and `clean` now query the storage layer instead of assuming a local `db` directory.
- The MCP server uses the same storage config resolution as the CLI.
- This layout is currently single-tenant. If lgrep becomes an external or hosted product, we will need tenant isolation for prefixes, metadata, credentials, and write coordination.
