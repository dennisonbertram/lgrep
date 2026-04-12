## lgrep - Semantic Code Search

Treat `lgrep` as the default entrypoint for understanding this codebase. Use it before `rg`, `grep`, or manual file-by-file exploration whenever you need discovery, context, callers, impact, definitions, usages, or semantic search.

### Session Start

- Claude's `SessionStart` hook should prepare `lgrep` automatically.
- In **local mode**, the hook can clean stale state and start a watcher for the current repo when that is useful.
- In **cloud mode**, the hook should verify the hosted service is reachable and keep hosted reads as the default path.
- If startup looks wrong, run `lgrep doctor` for setup/debugging.

### Hard Rules

- Prefer `lgrep` before `rg` or `grep` unless you already know the exact literal string, filename, or regex you need.
- Let hosted auto-detection choose the project/worktree first when you are inside a registered git worktree.
- In **cloud mode**, do not start local watchers or rebuild local indexes unless the user explicitly asks for a local workflow.

### Session Workflow

```bash
# Local mode / setup debugging
lgrep doctor

# Hosted mode / shared remote workflow
lgrep project list

# Then use lgrep first
lgrep search "user authentication flow"
lgrep search --definition "ClassName"
lgrep search --usages "functionName"
lgrep callers myFunction
lgrep impact myFunction
lgrep context "implement feature X"
lgrep intent "what calls awardBadge"
```

### Best Practices

1. Start with `lgrep` and only fall back to `rg` for exact-text confirmation.
2. Use `lgrep context` before broad code changes or multi-file edits.
3. Use `lgrep callers` or `lgrep impact` before refactors and renames.
4. In local mode, let the SessionStart hook or `lgrep watch` keep active repos fresh.
5. In cloud mode, assume the hosted index is the source of truth unless the user asks for local-only indexing.
