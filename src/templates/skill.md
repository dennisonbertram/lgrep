---
name: mgrep-search
description: "Local semantic code search with automatic context building. Use when searching code, understanding codebases, building context for tasks, or finding where functionality is implemented. Trigger phrases: 'search for code', 'find where', 'understand this codebase', 'how does X work', 'build context for', 'what files handle', 'show me the implementation of'."
---

# mgrep - Local Semantic Code Search

## Overview

mgrep is a privacy-first local semantic search tool that helps you quickly find and understand code. It uses local embeddings (via Ollama) to provide mixedbread.ai-quality semantic search without sending your code to the cloud.

**Use mgrep when you need to:**
- Search for code by meaning, not just keywords
- Understand how a codebase works
- Build context for implementing a feature
- Find where specific functionality is implemented
- Locate relevant files for a task
- Understand dependencies and call graphs

## Quick Start

### Starting the Watcher

The watcher automatically keeps your index up-to-date as files change:

```bash
mgrep watch /path/to/project --name project-name
```

**Auto-start**: The SessionStart hook automatically starts a watcher for your current directory if one isn't already running.

### Stopping the Watcher

```bash
mgrep stop project-name
```

## Core Commands

### Search

**Semantic search** - Find code by meaning:
```bash
mgrep search "user authentication flow" --index project-name
```

**Code intelligence** - Find usages and definitions:
```bash
# Find all usages of a function
mgrep search --usages "authenticateUser" --index project-name

# Find where a symbol is defined
mgrep search --definition "UserAuth" --index project-name

# Find all symbols of a type
mgrep search --type function --index project-name
```

**Options:**
- `--limit N` - Maximum results (default: 10)
- `--diversity 0.0-1.0` - Balance diversity vs relevance (default: 0.7)
- `--json` - JSON output for programmatic use

### Context Builder

Build optimal file context for a task:
```bash
mgrep context "implement password reset" --index project-name
```

This intelligently explores the codebase, selects relevant files within a token budget, and can generate an implementation plan.

**Options:**
- `--limit N` - Max files to include (default: 15)
- `--max-tokens N` - Token budget (default: 32000)
- `--depth N` - Graph traversal depth (default: 2)
- `--summary-only` - Exclude code snippets
- `--no-approach` - Skip approach suggestions
- `--format json|markdown` - Output format

### Index Management

**Create index:**
```bash
mgrep index /path/to/project --name project-name
```

**Update incrementally:**
```bash
mgrep index /path/to/project --name project-name --update
```

**Force rebuild:**
```bash
mgrep index /path/to/project --name project-name --force
```

**List indexes:**
```bash
mgrep list
```

**Delete index:**
```bash
mgrep delete project-name
```

### Code Analysis

Analyze code structure without searching:
```bash
mgrep analyze /path/to/project --symbols --deps --calls
```

**Options:**
- `--symbols` - List all symbols (functions, classes, etc.)
- `--deps` - Show dependency graph
- `--calls` - Show call graph
- `--tree` - Output full AST tree
- `--file path` - Analyze single file only

## Workflows

### 1. Understanding a New Codebase

```bash
# Start watcher
mgrep watch . --name myproject

# Search for authentication
mgrep search "authentication" --index myproject

# Find user-related functions
mgrep search --type function --index myproject | grep -i user

# Build context for adding a feature
mgrep context "add email verification" --index myproject
```

### 2. Finding Implementation Details

```bash
# Semantic search
mgrep search "payment processing" --index myproject

# Find where a function is used
mgrep search --usages "processPayment" --index myproject

# Find the definition
mgrep search --definition "PaymentService" --index myproject
```

### 3. Building Context for a Task

```bash
# Use context builder for optimal file selection
mgrep context "refactor database queries" \
  --index myproject \
  --limit 20 \
  --max-tokens 50000

# Or manual search + analysis
mgrep search "database query" --index myproject
mgrep analyze . --deps | grep database
```

### 4. Debugging and Tracing

```bash
# Find all calls to a function
mgrep search --usages "logError" --index myproject

# Analyze call graph
mgrep analyze . --calls

# Find error handling patterns
mgrep search "error handling try catch" --index myproject
```

## Setup

### First-Time Setup

```bash
# Install Ollama and pull required models
mgrep setup

# Or skip summarization model (faster)
mgrep setup --skip-summarization
```

### Configuration

View or set configuration:
```bash
# View all settings
mgrep config

# Set a value
mgrep config model mxbai-embed-large

# JSON output
mgrep config --json
```

## Output Formats

All commands support `--json` for programmatic use:

```bash
mgrep search "query" --index myproject --json
mgrep list --json
mgrep context "task" --index myproject --json
```

## Tips

1. **Start watchers early** - The SessionStart hook does this automatically
2. **Use context builder** - It's smarter than manual file selection
3. **Leverage code intelligence** - `--usages` and `--definition` are powerful
4. **Adjust diversity** - Lower (0.0-0.5) for more variety, higher (0.7-1.0) for precision
5. **Incremental updates** - Use `--update` to skip unchanged files
6. **JSON output** - Pipe to `jq` for filtering: `mgrep search "query" -i proj --json | jq`

## Integration with Claude Code

The install command sets up:
1. A skill that teaches Claude when and how to use mgrep
2. A SessionStart hook that auto-starts watchers
3. Optional project-specific instructions in CLAUDE.md

This enables Claude to automatically use mgrep for code exploration and context building.
