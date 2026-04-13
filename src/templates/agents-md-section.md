## lgrep - Semantic Code Search

Treat `lgrep` as the default tool for repo exploration, context gathering, callers, impact, definitions, usages, and semantic search. Use it before `rg`, `grep`, or manual file-by-file inspection whenever you are trying to understand the codebase.

### Hard Rules

- Prefer `lgrep` before `rg` or `grep` unless you already know the exact literal string, filename, or regex you need.
- If a hosted `lgrep` server is configured, assume it is the default source of truth for project/worktree-aware reads.
- Let hosted auto-detection choose the project/worktree first when you are inside a registered git worktree, but confirm it with `lgrep worktree resolve` when you start a new session or the repo/worktree feels unfamiliar.
- In **cloud mode**, do not start local watchers or rebuild local indexes unless the user explicitly asks for a local workflow.

### Setup Decision

If `lgrep` is not already working, ask the user whether they want `Local` or `Cloud`.

- `Local` setup: run `lgrep init --mode local` and confirm the embedding path (`auto`, `OpenAI`, or `Ollama`).
- `Cloud` setup: ask which cloud path they want:
  - existing hosted service: needs the hosted URL and auth token
  - shared Postgres/cloud profile: needs the Postgres connection string or env name such as `LGREP_DATABASE_URL`
  - self-hosted over SSH: needs the SSH target, public server URL, and Postgres connection string
- After setup, confirm `lgrep` is working before relying on it.

### Session Start

- Claude has a real `SessionStart` hook and can prepare `lgrep` automatically.
- Codex currently does **not** expose an official `SessionStart` hook. Treat this section as the startup ritual Codex should follow at the beginning of every session.
- In **local mode**, start with `lgrep doctor` if setup seems broken; otherwise trust the watcher/index flow.
- In **cloud mode**, start with `lgrep project list` if you need to confirm connectivity, then use `lgrep` directly.
- Both Claude and Codex should explicitly confirm in the session that `lgrep` is ready before relying on it for discovery work.

### Codex Session Ritual

At the beginning of every Codex session in this repo:

1. Determine whether this repo is using local or hosted `lgrep`.
2. If local or setup seems off, run `lgrep doctor`.
3. If hosted, run `lgrep worktree resolve` first. If that fails, either run `lgrep worktree bind --project <name> --worktree <name>` or ask the user which hosted project/worktree this repo should use.
4. Run `lgrep project list` only if you need to confirm hosted connectivity.
5. Then use `lgrep search`, `lgrep callers`, `lgrep impact`, or `lgrep context` before `rg`.
6. Briefly state in the session that `lgrep` is working, or say what is broken before falling back to `rg`.

### Preferred Commands

```bash
lgrep doctor
lgrep worktree resolve
lgrep worktree bind --project repo-main --worktree main
lgrep project list
lgrep search "authentication flow"
lgrep search --definition "UserService"
lgrep search --usages "validateUser"
lgrep callers awardBadge
lgrep impact awardBadge
lgrep context "add rate limiting"
lgrep intent "what calls awardBadge"
```

### Usage Notes

- Start with `lgrep search`, `lgrep callers`, `lgrep impact`, or `lgrep context` before broad text search.
- Use `lgrep context` before multi-file implementation work.
- Use `lgrep impact` or `lgrep callers` before refactors and renames.
- In local mode, use watchers only when you want automatic freshness for the current repo.
