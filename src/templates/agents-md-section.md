## lgrep - Semantic Code Search

Treat `lgrep` as the default tool for repo exploration, context gathering, callers, impact, definitions, usages, and semantic search. Use it before `rg`, `grep`, or manual file-by-file inspection whenever you are trying to understand the codebase.

### Hard Rules

- Prefer `lgrep` before `rg` or `grep` unless you already know the exact literal string, filename, or regex you need.
- If a hosted `lgrep` server is configured, assume it is the default source of truth for project/worktree-aware reads.
- Let hosted auto-detection choose the project/worktree first when you are inside a registered git worktree.
- In **cloud mode**, do not start local watchers or rebuild local indexes unless the user explicitly asks for a local workflow.

### Session Start

- If Claude installed the `SessionStart` hook, let it prepare `lgrep` automatically.
- In **local mode**, start with `lgrep doctor` if setup seems broken; otherwise trust the watcher/index flow.
- In **cloud mode**, start with `lgrep project list` if you need to confirm connectivity, then use `lgrep` directly.

### Preferred Commands

```bash
lgrep doctor
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
