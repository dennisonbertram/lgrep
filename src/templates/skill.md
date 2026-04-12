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
- In **cloud mode**, assume the shared remote index is the default path and let hosted auto-detection pick the current project/worktree when possible.
- If startup looks wrong, run `lgrep doctor`.

## Storage-Aware Behavior

- In **local mode**, `lgrep watch` can keep the current repo indexed as files change.
- In **cloud mode**, prefer the shared remote index. Do not start local watchers or rebuild local indexes unless the user explicitly asks for a local workflow.

## Fast Path

Start with:

```bash
lgrep doctor
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
