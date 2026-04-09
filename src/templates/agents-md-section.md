## lgrep - Semantic Code Search

Use lgrep for repo exploration, context gathering, and refactor analysis before falling back to broad text search.

### When to Reach for It

- locating implementation by meaning
- finding definitions or usages
- tracing callers or blast radius
- building multi-file context for a task
- finding dead code, unused exports, similar code, or dependency cycles

### Storage-Aware Rules

- In **local mode**, `lgrep watch` is acceptable when automatic reindexing is useful.
- In **cloud mode**, prefer the configured remote index. Do not start local watchers or rebuild local indexes unless the user asks for that explicitly.

### Preferred Commands

```bash
lgrep doctor
lgrep list
lgrep search "authentication flow"
lgrep search --definition "UserService"
lgrep search --usages "validateUser"
lgrep callers awardBadge
lgrep impact awardBadge
lgrep context "add rate limiting"
lgrep intent "what calls awardBadge"
```

### Usage Notes

- Start with `lgrep intent` for natural-language questions.
- Use `lgrep context` before broad code changes.
- Use `lgrep impact` or `lgrep callers` before refactors and renames.
