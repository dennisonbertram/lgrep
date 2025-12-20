## lgrep - Local Semantic Code Search

**Use lgrep for code exploration, refactoring analysis, and context building.**

### When to Use

- Searching for code by meaning (not just text matching)
- Understanding how the codebase works
- Building context for implementing features
- Finding dead code, unused exports, or circular dependencies
- Analyzing the impact of refactoring changes
- Locating relevant files for a task

### Natural Language Queries

Use `lgrep intent` for natural language queries:

```bash
lgrep intent "what calls awardBadge"        # → finds callers
lgrep intent "what happens if I change X"   # → shows impact
lgrep intent "find dead code"               # → detects unused functions
lgrep intent "show circular dependencies"   # → finds cycles
```

### Quick Commands

```bash
# Search semantically (auto-detects index from current directory)
lgrep search "user authentication"

# Find usages and definitions
lgrep search --usages "functionName"
lgrep search --definition "ClassName"

# Build context for a task
lgrep context "implement feature X"

# Find who calls a function
lgrep callers myFunction

# Analyze change impact
lgrep impact myFunction

# Find dead code (functions with zero callers)
lgrep dead

# Find unused exports
lgrep unused-exports

# Detect circular dependencies
lgrep cycles

# Find similar/duplicate code
lgrep similar

# Preview rename impact
lgrep rename oldName newName --preview

# Check for breaking signature changes
lgrep breaking

# List available indexes
lgrep list
```

### Best Practices

1. **Use natural language** - `lgrep intent` understands what you want
2. **Auto-detection works** - Commands detect the right index from your directory
3. **Check impact before refactoring** - Use `lgrep impact` before changing functions
4. **Find dead code regularly** - Use `lgrep dead` to keep the codebase clean
5. **Context builder first** - Use `lgrep context` for optimal file selection
6. **JSON output** - Use `--json` for programmatic processing

### Background Daemon

lgrep runs a background watcher daemon for each indexed project:

```bash
# Check what's running
lgrep list

# Start watcher for current directory (auto-names from folder)
lgrep watch .

# Start with custom name
lgrep watch /path/to/project --name myproject

# Stop a watcher
lgrep stop myproject
```

**Note**: The SessionStart hook auto-starts watchers when you open a project.
If searches return no results, check `lgrep list` to verify the watcher is running.
