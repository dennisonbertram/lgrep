# Self-Hosted SSH Runbook

This is the concrete runbook for the current "single developer, one remote box, many local worktrees" setup.

It is written from a live proof on a fresh Ubuntu 24.04 Hetzner host and is intended to be reused in agent skills.

## What this runbook proves

This flow was verified live against a fresh SSH host with:

- a self-hosted `lgrep` server managed by real `systemd`
- Postgres running in Docker with `pgvector`
- a local machine configured globally for Claude, Codex, and MCP
- three real `lgrep` worktrees bootstrapped into the hosted database
- hosted `project info`, `worktree list`, `worktree diff`, `callers`, and `impact` queries working against that live server

## Success case

Use this when you want:

- one remote Mac mini, Hetzner box, or similar SSH host
- one Postgres database for the hosted index
- one `project` per repo
- many `worktree`s under that project
- global local-agent instructions that point at the hosted service

## Remote host options

You can use either:

- a self-contained Linux host with Docker + Postgres on the same machine
- a remote host that connects to an already-managed Postgres instance

This runbook shows the self-contained Linux path because it is the easiest to repeat.

## 1. Prepare the remote host

On a fresh Ubuntu host, install Docker and start it:

```bash
ssh root@your-host 'apt-get update && apt-get install -y docker.io && systemctl enable --now docker'
```

Start a local Postgres + `pgvector` container:

```bash
ssh root@your-host '
  docker rm -f lgrep-pg >/dev/null 2>&1 || true
  docker run -d \
    --name lgrep-pg \
    --restart unless-stopped \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=lgrep_remote \
    -p 127.0.0.1:5432:5432 \
    pgvector/pgvector:pg16
'
```

Wait for the database to become ready:

```bash
ssh root@your-host 'until docker exec lgrep-pg pg_isready -U postgres -d lgrep_remote >/dev/null 2>&1; do sleep 1; done'
```

## 2. Create and activate a dedicated local profile

Use a dedicated profile for the hosted server so you do not overwrite unrelated local/cloud setups:

```bash
lgrep profile create hetzner-live
lgrep profile use hetzner-live
```

## 3. Provision the hosted server over SSH

Run the remote installer from your local machine:

```bash
lgrep server install-remote root@your-host \
  --server-url http://your-host:8420 \
  --database-url postgres://postgres:postgres@127.0.0.1:5432/lgrep_remote
```

What this does:

- installs Linux build/runtime prerequisites when needed
- installs a supported Node runtime when the host's system `node` is too old
- installs `lgrep` on the remote host
- writes the hosted server start script under `~/.lgrep-server/<service-name>/`
- provisions `systemd`, `launchd`, or a `tmux` fallback depending on the host
- writes a remote token-store file for hosted auth
- stores the hosted URL and auth token in the active local `lgrep` profile
- updates global Claude/Codex guidance and MCP config on the local machine unless you pass `--skip-local-install`

On a standard Ubuntu server with root SSH, the service should land at:

```text
/etc/systemd/system/lgrep-server.service
```

## 4. Verify the local global install

The SSH installer should update the local machine-wide agent guidance.

Verify that the hosted URL appears in:

```bash
rg -n "http://your-host:8420" \
  ~/.codex/AGENTS.md \
  ~/.claude/CLAUDE.md \
  ~/.claude/settings.json
```

## 5. Optional: upgrade the remote host to an unreleased local branch

Use this only when you are testing branch-only features that are not on npm yet.

Pack the current checkout:

```bash
npm pack
```

Copy the tarball to the remote host and install it with the Node runtime provisioned under `~/.local`:

```bash
scp ./lgrep-0.1.0.tgz root@your-host:/root/lgrep-current.tgz

ssh root@your-host '
  export HOME=/root
  export NPM_CONFIG_PREFIX=/root/.local
  export PATH=/root/.local/bin:$PATH
  /root/.local/bin/npm install -g --legacy-peer-deps /root/lgrep-current.tgz
  systemctl restart lgrep-server
'
```

If you are using a published release only, skip this section.

## 6. Create a tmux SSH tunnel for local bootstrap work

Bootstrapping local worktrees into the hosted database still needs a database connection from your local machine.

Use a tmux-managed SSH tunnel so the connection survives while you work:

```bash
tmux new-session -d -s lgrep-hetzner-pg \
  'ssh -N -L 55432:127.0.0.1:5432 root@your-host'
```

Verify the tunnel:

```bash
nc -z 127.0.0.1 55432
```

## 7. Bootstrap the real repo and worktrees

Point the local bootstrap command at the remote Postgres through the tunnel.

Example with one main worktree plus two additional local worktrees:

```bash
LGREP_PROFILE=hetzner-live \
LGREP_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/lgrep_remote \
LGREP_TEST_EMBEDDINGS=1 \
lgrep server bootstrap /absolute/path/to/main/worktree \
  --profile hetzner-live \
  --project repo-main \
  --main-name main \
  --branch main \
  --worktree 'feature-a|/absolute/path/to/feature-a|feature/a' \
  --worktree 'feature-b|/absolute/path/to/feature-b|feature/b' \
  --database-url postgres://postgres:postgres@127.0.0.1:55432/lgrep_remote \
  --server-url http://your-host:8420
```

For the live `lgrep` proof, the verified worktrees were:

```bash
LGREP_PROFILE=hetzner-live \
LGREP_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/lgrep_remote \
LGREP_TEST_EMBEDDINGS=1 \
node dist/cli/index.js server bootstrap /Users/dennisonbertram/Develop/apps/lgrep \
  --profile hetzner-live \
  --project lgrep \
  --main-name global-remote-install \
  --branch codex/global-remote-install \
  --worktree 'local-cloud-onboarding|/Users/dennisonbertram/.codex/worktrees/a058/lgrep|codex/local-cloud-onboarding' \
  --worktree 'team-docs|/Users/dennisonbertram/conductor/workspaces/lgrep/seattle|dennisonbertram/team-docs' \
  --database-url postgres://postgres:postgres@127.0.0.1:55432/lgrep_remote \
  --server-url http://178.156.241.78:8420
```

Notes:

- `LGREP_TEST_EMBEDDINGS=1` is a smoke-test shortcut.
- For real semantic search, use a real embedding provider on the hosted server, such as `OPENAI_API_KEY`.

## 8. Verify the hosted server

Check that the remote service is running:

```bash
ssh root@your-host 'systemctl is-active lgrep-server'
```

Check hosted server health:

```bash
lgrep server status --json
```

Verify the hosted project:

```bash
LGREP_PROFILE=hetzner-live lgrep project info repo-main --json
LGREP_PROFILE=hetzner-live lgrep worktree list --project repo-main --json
```

For the live proof, the hosted server reported:

- `projects: 1`
- `worktrees: 3`
- `unique_content_hashes: 280`

## 9. Verified hosted queries

These commands were proven live against the Hetzner-hosted service:

```bash
LGREP_PROFILE=hetzner-live lgrep project info lgrep --json
LGREP_PROFILE=hetzner-live lgrep worktree list --project lgrep --json
LGREP_PROFILE=hetzner-live lgrep worktree diff global-remote-install local-cloud-onboarding --json
LGREP_PROFILE=hetzner-live lgrep callers runInstallCommand --project lgrep --worktree local-cloud-onboarding --json
LGREP_PROFILE=hetzner-live lgrep impact runInstallCommand --project lgrep --worktree local-cloud-onboarding --json
```

The live `callers` proof returned these notable callers for `runInstallCommand` in `local-cloud-onboarding`:

- `runInitCommand` in `src/cli/commands/init.ts`
- `runServerInstallRemoteCommand` in `src/cli/commands/server-install-remote.ts`

The live `impact` proof returned:

- the same direct callers
- `totalFiles: 8`

## 10. Verified local doctor flow

Because the active profile is a cloud/Postgres profile, `doctor` needs the database URL available when you want full cloud validation from the local machine:

```bash
LGREP_PROFILE=hetzner-live \
LGREP_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/lgrep_remote \
lgrep doctor --json
```

That flow was verified live and returned `success: true`.

## Known limitations

- Hosted semantic search and hosted `context` need a real embedding provider configured on the server. Without that, semantic `search` returns a missing-provider error.
- `lgrep search --definition ...` and `lgrep search --usages ...` are still database-backed client flows today and are not part of the hosted-read proof.
- If you are testing an unreleased branch, use the tarball upgrade path above instead of assuming `npm install -g lgrep` has your local changes.
- The current hosted setup is still single-tenant.

## Mac mini notes

The Mac mini path is the same at a high level:

1. provision Postgres locally or point at a managed Postgres instance
2. run `lgrep server install-remote user@mac-mini --server-url ...`
3. bootstrap local worktrees into the hosted database
4. use the resulting hosted profile + global agent instructions from your local machine

The main operational difference is service management:

- macOS should use `launchd`
- Linux should use `systemd` when available
- container/minimal hosts fall back to `tmux`

## Cleanup

Stop the SSH tunnel when you are done:

```bash
tmux kill-session -t lgrep-hetzner-pg
```
