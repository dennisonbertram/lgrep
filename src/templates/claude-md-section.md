## mgrep - Local Semantic Code Search

**Use mgrep for code exploration and context building.**

### When to Use

- Searching for code by meaning
- Understanding how the codebase works
- Building context for implementing features
- Finding where functionality is implemented
- Locating relevant files for a task

### Quick Commands

```bash
# Search semantically
mgrep search "user authentication" --index PROJECT_NAME

# Find usages
mgrep search --usages "functionName" --index PROJECT_NAME

# Find definition
mgrep search --definition "ClassName" --index PROJECT_NAME

# Build context for a task
mgrep context "implement feature X" --index PROJECT_NAME

# List available indexes
mgrep list
```

### Best Practices

1. **Use the watcher** - Keep indexes up-to-date automatically
2. **Context builder first** - Use `mgrep context` for optimal file selection
3. **Leverage code intelligence** - `--usages` and `--definition` are powerful
4. **Adjust search diversity** - Use `--diversity` to balance variety vs precision
5. **JSON output** - Use `--json` for programmatic processing

### Integration

The SessionStart hook automatically starts a watcher for the current directory.
Check running watchers with `mgrep list`.
