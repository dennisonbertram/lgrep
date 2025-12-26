---
name: lgrep-search
description: "Local semantic code search with automatic context building and refactoring analysis. Use when searching code, understanding codebases, building context for tasks, finding dead code, analyzing refactoring impact, or detecting circular dependencies. Trigger phrases: 'search for code', 'find where', 'understand this codebase', 'how does X work', 'build context for', 'what files handle', 'show me the implementation of', 'what calls', 'find dead code', 'unused exports', 'circular dependencies', 'refactor', 'rename', 'impact of changing'."
---

# lgrep - Local Semantic Code Search

## Overview

lgrep is a privacy-first local semantic search tool that helps you quickly find, understand, and analyze code. It uses local embeddings (via Ollama) to provide semantic search without sending your code to the cloud.

**Use lgrep when you need to:**
- Search for code by meaning, not just keywords
- Understand how a codebase works
- Build context for implementing a feature
- Find where specific functionality is implemented
- Find dead code (functions with zero callers)
- Detect circular import dependencies
- Find unused exports
- Analyze the impact of refactoring changes
- Preview rename operations
- Locate relevant files for a task

## Quick Start

### Starting the Watcher

The watcher automatically keeps your index up-to-date as files change:

```bash
lgrep watch /path/to/project --name project-name
```

**Auto-start**: The SessionStart hook automatically starts a watcher for your current directory if one isn't already running.

### Stopping the Watcher

```bash
lgrep stop project-name
```

## Core Commands

### Search

**Semantic search** - Find code by meaning:
```bash
lgrep search "user authentication flow" --index project-name
```

**Code intelligence** - Find usages and definitions:
```bash
# Find all usages of a function
lgrep search --usages "authenticateUser" --index project-name

# Find where a symbol is defined
lgrep search --definition "UserAuth" --index project-name

# Find all symbols of a type
lgrep search --type function --index project-name
```

**Options:**
- `--limit N` - Maximum results (default: 10)
- `--diversity 0.0-1.0` - Balance diversity vs relevance (default: 0.7)
- `--json` - JSON output for programmatic use

### Context Builder

Build optimal file context for a task:
```bash
lgrep context "implement password reset" --index project-name
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
lgrep index /path/to/project --name project-name
```

**Update incrementally:**
```bash
lgrep index /path/to/project --name project-name --update
```

**Force rebuild:**
```bash
lgrep index /path/to/project --name project-name --force
```

**List indexes:**
```bash
lgrep list
```

**Delete index:**
```bash
lgrep delete project-name
```

### Code Analysis

Analyze code structure without searching:
```bash
lgrep analyze /path/to/project --symbols --deps --calls
```

**Options:**
- `--symbols` - List all symbols (functions, classes, etc.)
- `--deps` - Show dependency graph
- `--calls` - Show call graph
- `--tree` - Output full AST tree
- `--file path` - Analyze single file only

### Natural Language Intent

Use natural language to run the right command automatically:
```bash
lgrep intent "what calls awardBadge"        # → runs callers
lgrep intent "what happens if I change X"   # → runs impact
lgrep intent "find dead code in contracts/" # → runs dead
lgrep intent "show circular dependencies"   # → runs cycles
```

### Code Health Commands

**Find dead code** (functions with zero callers):
```bash
lgrep dead --index myproject
```

**Find unused exports** (exports never imported):
```bash
lgrep unused-exports --index myproject
```

**Detect circular dependencies**:
```bash
lgrep cycles --index myproject
```

**Find similar/duplicate code**:
```bash
lgrep similar --index myproject
```

### Refactoring Commands

**Analyze change impact** (blast radius):
```bash
lgrep impact myFunction --index myproject
```

**Find all callers of a function**:
```bash
lgrep callers myFunction --index myproject
```

**Preview rename operation**:
```bash
lgrep rename oldName newName --preview --index myproject
```

**Check for breaking signature changes**:
```bash
lgrep breaking --index myproject
```

### Additional Analysis Commands

**View dependency graph**:
```bash
lgrep graph --index myproject
```

**Get codebase statistics**:
```bash
lgrep stats --index myproject
```

**Explain a symbol or file**:
```bash
lgrep explain myFunction --index myproject
```

## AUTO-CONTEXT TRIGGERS

**CRITICAL: When the user mentions these patterns, AUTOMATICALLY run the corresponding lgrep commands FIRST to gather context, THEN answer their question.**

| User Says | Auto-run | Why |
|-----------|----------|-----|
| "refactor X" / "change X" | `lgrep impact X && lgrep callers X` | Show blast radius and all call sites |
| "rename X to Y" | `lgrep rename X Y --preview` | Preview all locations that need updating |
| "what calls X" | `lgrep callers X` | Find all call sites with file:line |
| "what breaks if I change X" | `lgrep impact X` | Show transitive dependencies |
| "unused code" / "dead code" | `lgrep dead` | Find functions with zero callers |
| "unused exports" | `lgrep unused-exports` | Find exports never imported |
| "circular dependencies" | `lgrep cycles` | Detect circular import chains |
| "similar code" / "duplicate code" | `lgrep similar` | Find code duplication |
| "optimize imports" / "clean up" | `lgrep dead && lgrep unused-exports` | Find removable code |
| "architecture overview" | `lgrep stats && lgrep graph` | Show metrics and structure |

### Pattern Matching Examples

**Example 1: Refactoring Request**
```
User: "I want to refactor the authenticateUser function"

Your workflow:
1. Run: lgrep impact authenticateUser
2. Run: lgrep callers authenticateUser
3. Analyze output to see what files/functions depend on it
4. THEN provide refactoring advice with full context
```

**Example 2: Rename Request**
```
User: "Can I rename oldName to newName?"

Your workflow:
1. Run: lgrep rename oldName newName --preview
2. Review all locations that would need updating
3. THEN advise on safety and show exact files to change
```

**Example 3: Code Quality Check**
```
User: "Are there any unused exports in this codebase?"

Your workflow:
1. Run: lgrep unused-exports
2. Run: lgrep dead (for completeness)
3. THEN present findings with recommendations
```

### Proactive Usage Guidelines

**DO automatically run lgrep when:**
- User asks about impact, callers, or dependencies
- User mentions refactoring, renaming, or changing code
- User asks about code quality, dead code, or unused exports
- User wants to understand architecture or structure
- User asks "what breaks if..." or "what uses..."

**DON'T wait for explicit permission** - lgrep is a read-only analysis tool designed for automatic use.

**Pattern recognition tips:**
- Keywords: refactor, rename, change, impact, blast radius, callers, unused, dead, circular, duplicate
- Questions: "what if", "what calls", "what breaks", "what depends on"
- Quality: "clean up", "optimize", "remove unused", "find dead code"

## Workflows

### 1. Understanding a New Codebase

```bash
# Start watcher
lgrep watch . --name myproject

# Search for authentication
lgrep search "authentication" --index myproject

# Find user-related functions
lgrep search --type function --index myproject | grep -i user

# Build context for adding a feature
lgrep context "add email verification" --index myproject
```

### 2. Finding Implementation Details

```bash
# Semantic search
lgrep search "payment processing" --index myproject

# Find where a function is used
lgrep search --usages "processPayment" --index myproject

# Find the definition
lgrep search --definition "PaymentService" --index myproject
```

### 3. Building Context for a Task

```bash
# Use context builder for optimal file selection
lgrep context "refactor database queries" \
  --index myproject \
  --limit 20 \
  --max-tokens 50000

# Or manual search + analysis
lgrep search "database query" --index myproject
lgrep analyze . --deps | grep database
```

### 4. Debugging and Tracing

```bash
# Find all calls to a function
lgrep search --usages "logError" --index myproject

# Analyze call graph
lgrep analyze . --calls

# Find error handling patterns
lgrep search "error handling try catch" --index myproject
```

## Setup

### First-Time Setup

```bash
# Install Ollama and pull required models
lgrep setup

# Or skip summarization model (faster)
lgrep setup --skip-summarization
```

### Configuration

View or set configuration:
```bash
# View all settings
lgrep config

# Set a value
lgrep config model mxbai-embed-large

# JSON output
lgrep config --json
```

## Output Formats

All commands support `--json` for programmatic use:

```bash
lgrep search "query" --index myproject --json
lgrep list --json
lgrep context "task" --index myproject --json
```

## Tips

1. **Start watchers early** - The SessionStart hook does this automatically
2. **Use context builder** - It's smarter than manual file selection
3. **Leverage code intelligence** - `--usages` and `--definition` are powerful
4. **Adjust diversity** - Lower (0.0-0.5) for more variety, higher (0.7-1.0) for precision
5. **Incremental updates** - Use `--update` to skip unchanged files
6. **JSON output** - Pipe to `jq` for filtering: `lgrep search "query" -i proj --json | jq`

## Integration with Claude Code

The install command sets up:
1. A skill that teaches Claude when and how to use lgrep
2. A SessionStart hook that auto-starts watchers
3. Optional project-specific instructions in CLAUDE.md

This enables Claude to automatically use lgrep for code exploration and context building.
