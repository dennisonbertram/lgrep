---
name: lgrep-search
description: "Semantic code search and code-intelligence guidance for lgrep. Use when searching code by meaning, locating definitions or usages, building task context, checking refactor impact, finding dead code, or exploring dependency structure."
---

# lgrep - Semantic Code Search

## Overview

Treat `lgrep` as the default tool for understanding a codebase. Use it before broad `rg` or `grep` sweeps whenever you need:

- semantic code search
- definitions and usages
- callers and impact analysis
- dead code, unused exports, or cycles
- task-oriented context building

## Session Start

- Start with `lgrep`, not with broad text search.
- In **local mode**, the Claude `SessionStart` hook can clean stale state and start a watcher for the current repo automatically.
- In **cloud mode**, assume the shared remote index is the default path and use `lgrep worktree resolve` to confirm the current project/worktree when possible.
- In Codex, use the repo or global `AGENTS.md` startup ritual because Codex currently relies on instruction loading rather than a supported SessionStart hook.
- If startup looks wrong, run `lgrep doctor`.
- At the beginning of the session, explicitly confirm whether `lgrep` is working before relying on it for discovery.

## Setup Decision

If `lgrep` is not already working, ask the user whether they want `Local` or `Cloud`.

- `Local` setup: run `lgrep init --mode local` and confirm the embedding path (`auto`, `OpenAI`, or `Ollama`).
- `Cloud` setup: ask which cloud path they want:
  - existing hosted service: needs the hosted URL and auth token
  - shared Postgres/cloud profile: needs the Postgres connection string or env name such as `LGREP_DATABASE_URL`
  - self-hosted over SSH: needs the SSH target, public server URL, and Postgres connection string
- After setup, confirm `lgrep` is working before relying on it.

## Storage-Aware Behavior

- In **local mode**, `lgrep watch` can keep the current repo indexed as files change.
- In **cloud mode**, prefer the shared remote index. Do not start local watchers or rebuild local indexes unless the user explicitly asks for a local workflow.

## Fast Path

Start with:

```bash
lgrep doctor
lgrep worktree resolve
lgrep project list
```

Then use:

```bash
lgrep search "user authentication flow"
lgrep search --definition "UserService"
lgrep search --usages "validateUser"
lgrep callers awardBadge
lgrep impact awardBadge
lgrep context "add rate limiting"
lgrep intent "what calls awardBadge"
```

## Guidance

- Prefer `lgrep intent` when the user asks in natural language.
- Prefer `lgrep context` before implementation work that spans multiple files.
- Prefer `lgrep impact` or `lgrep callers` before refactors.
- Use `rg` only when you already know the exact literal string or regex you need to confirm.
