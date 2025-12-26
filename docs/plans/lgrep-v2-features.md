# lgrep v2 Feature Implementation Plan

## Overview

This plan addresses the feedback to make lgrep **strictly better than grep for every query**. The implementation is organized into four phases:

1. **High-Impact Commands** (code intelligence features)
2. **Speed/UX Improvements** (daemon, auto-detect, instant queries)
3. **Claude Code Integration** (MCP server)
4. **Natural Language Interface** (the killer feature)

---

## Phase 1: High-Impact Commands

These commands leverage existing infrastructure (code-intel tables, graph operations) with minimal new complexity.

### 1.1 `lgrep dead` - Find Dead Code

**Purpose:** Find functions with zero callers (unused code)

**Algorithm:**
```
1. Get all symbols from index (functions, methods)
2. Get all call edges from index
3. Build set of all callee IDs/names from calls
4. Filter symbols where:
   - Symbol is function/method
   - Symbol is NOT exported (or include exports with --include-exports)
   - Symbol is NOT in callee set
5. Return dead symbols with file:line
```

**Key files to modify:**
- `src/cli/commands/dead.ts` (new)
- `src/cli/index.ts` (add command)

**Test cases:**
- Function with callers (not dead)
- Function without callers (dead)
- Exported function (excluded by default, included with flag)
- Main/entry point functions (excluded)

**Estimated complexity:** Low (reuses existing getCalls, getSymbols)

---

### 1.2 `lgrep similar "fn"` - Find Similar Code

**Purpose:** Find duplicate/similar code patterns for refactoring

**Algorithm:**
```
1. Find symbol by name
2. Get code chunk for that symbol
3. Embed the chunk
4. Search for similar vectors (excluding self)
5. Filter by similarity threshold (default 0.85)
6. Group by file, return with similarity scores
```

**Options:**
- `--threshold <0-1>` - Similarity threshold (default 0.85)
- `--limit <n>` - Max results (default 10)
- `--include-self` - Include the original in results

**Key files to modify:**
- `src/cli/commands/similar.ts` (new)
- `src/cli/index.ts` (add command)

**Dependencies:** Existing embedding + search infrastructure

**Estimated complexity:** Medium (new command, but reuses embeddings)

---

### 1.3 `lgrep cycles` - Detect Circular Dependencies

**Purpose:** Find circular import dependencies (architecture health)

**Algorithm:**
```
1. Get all dependencies from index
2. Build directed graph: file → [imported files]
3. Run Tarjan's SCC algorithm OR DFS with back-edge detection
4. Report all cycles with:
   - Cycle members (file paths)
   - Cycle length
   - Specific import lines
```

**Output format:**
```
Circular dependencies found: 3

Cycle 1 (3 files):
  src/api/user.ts:5 → src/api/auth.ts
  src/api/auth.ts:8 → src/api/session.ts
  src/api/session.ts:12 → src/api/user.ts

Cycle 2 (2 files):
  src/utils/a.ts:3 → src/utils/b.ts
  src/utils/b.ts:7 → src/utils/a.ts
```

**Key files to modify:**
- `src/cli/commands/cycles.ts` (new)
- `src/cli/index.ts` (add command)

**Estimated complexity:** Medium (Tarjan's algorithm implementation)

---

### 1.4 `lgrep unused-exports` - Find Unused Exports

**Purpose:** Exports never imported anywhere (API cleanup)

**Algorithm:**
```
1. Get all exported symbols from index (isExported: true)
2. Get all dependencies with imported names
3. Build set of all imported names across all files
4. Filter exports where:
   - Export name NOT in imported names set
   - NOT a default export used implicitly
   - NOT an entry point (package.json exports, main)
5. Return unused exports with file:line
```

**Options:**
- `--include-default` - Include default exports
- `--ignore-entry-points` - Skip package.json exports

**Key files to modify:**
- `src/cli/commands/unused-exports.ts` (new)
- `src/cli/index.ts` (add command)

**Estimated complexity:** Medium (cross-referencing symbols + dependencies)

---

### 1.5 `lgrep breaking "fn"` - Breaking Change Detection

**Purpose:** Detect if signature change breaks callers (safe refactoring)

**Algorithm:**
```
1. Find symbol by name
2. Parse current signature (parameters, types)
3. Get all callers via existing callers command
4. For each caller:
   - Get call site AST
   - Extract argument count and types (if available)
   - Compare with signature
5. Report:
   - Compatible calls (argument count matches)
   - Potentially breaking calls (argument count mismatch)
   - Unknown calls (can't determine)
```

**Options:**
- `--new-signature "fn(a, b, c)"` - Compare against proposed signature
- `--strict` - Flag any caller without explicit types

**Key files to modify:**
- `src/cli/commands/breaking.ts` (new)
- `src/core/ast/signature-analyzer.ts` (new - parse signatures)
- `src/cli/index.ts` (add command)

**Estimated complexity:** High (signature parsing, type analysis)

---

### 1.6 `lgrep rename "old" "new" --preview` - Smart Rename

**Purpose:** Smart rename with impact preview (refactoring)

**Algorithm:**
```
1. Find all symbols matching "old" name
2. Get all callers for each symbol
3. Build rename map:
   - Symbol definition sites
   - All call sites
   - Import/export statements
4. Generate preview:
   - List all files affected
   - Show diff preview for each change
5. With --apply:
   - Execute rename via edit operations
   - Verify no new errors introduced
```

**Options:**
- `--preview` - Show changes without applying (default)
- `--apply` - Execute the rename
- `--scope <file-pattern>` - Limit rename to matching files
- `--dry-run` - Validate but don't apply

**Key files to modify:**
- `src/cli/commands/rename.ts` (new)
- `src/core/refactor/rename.ts` (new - rename logic)
- `src/cli/index.ts` (add command)

**Estimated complexity:** High (file editing, validation)

---

## Phase 2: Speed/UX Improvements

### 2.1 Daemon Mode for Instant Queries

**Current state:** Daemon exists for file watching (`daemon/manager.ts`, `daemon/worker.ts`)

**Enhancement:**
- Keep index loaded in memory
- Expose query interface via IPC (Unix socket or named pipe)
- First query cold-starts daemon, subsequent queries instant

**Implementation:**
```
lgrep-daemon (background process):
  - Loads index into memory on start
  - Listens on ~/.lgrep/sock/<index-name>.sock
  - Handles: search, callers, impact, etc.
  - Auto-updates on file changes

lgrep CLI:
  - Check if daemon running for index
  - If yes: send query via IPC (fast path)
  - If no: spawn daemon, wait for ready, query
```

**Key files to modify:**
- `src/daemon/server.ts` (new - IPC server)
- `src/daemon/client.ts` (new - IPC client)
- `src/daemon/manager.ts` (extend for query daemon)
- `src/cli/commands/*.ts` (add daemon fast path)

**Estimated complexity:** High (IPC, process lifecycle)

---

### 2.2 Auto-Detect Index from .lgrep.json

**Current state:** `--index` required or auto-detect from directory

**Enhancement:**
- Create `.lgrep.json` in project root during `lgrep index`
- Auto-detect by walking up directory tree
- No need to remember `--index`

**Config file format:**
```json
{
  "indexName": "my-project",
  "rootPath": "/absolute/path/to/project",
  "created": "2024-01-15T10:30:00Z",
  "model": "mxbai-embed-large"
}
```

**Key files to modify:**
- `src/cli/commands/index.ts` (write .lgrep.json)
- `src/cli/utils/auto-detect.ts` (enhance detection)

**Estimated complexity:** Low (config file management)

---

### 2.3 Default Watch Mode

**Current state:** Manual `lgrep watch` required

**Enhancement:**
- First `lgrep index` auto-starts watcher
- `lgrep index --no-watch` to disable
- Watchers survive terminal close (already daemon-based)

**Key files to modify:**
- `src/cli/commands/index.ts` (auto-start watch)
- `src/daemon/manager.ts` (ensure daemon persistence)

**Estimated complexity:** Low (behavioral change)

---

## Phase 3: Claude Code Integration (MCP Server)

### 3.1 MCP Server Implementation

**Purpose:** Claude can call lgrep tools directly without bash

**Architecture:**
```
lgrep-mcp-server (background process):
  ├── Wraps all lgrep commands as MCP tools
  ├── Returns structured JSON responses
  ├── Handles multiple concurrent requests
  └── Integrates with Claude Code's MCP discovery
```

**MCP Tools to expose:**
```typescript
tools: {
  "lgrep_search": { query: string, index?: string, limit?: number },
  "lgrep_callers": { symbol: string, index?: string },
  "lgrep_impact": { symbol: string, index?: string },
  "lgrep_deps": { module: string, index?: string },
  "lgrep_analyze": { path: string, mode: "symbols" | "calls" | "deps" },
  "lgrep_context": { task: string, index?: string, budget?: number },
  "lgrep_dead": { index?: string, includeExports?: boolean },
  "lgrep_similar": { symbol: string, threshold?: number },
  "lgrep_cycles": { index?: string },
  "lgrep_unused_exports": { index?: string },
  "lgrep_breaking": { symbol: string, newSignature?: string },
  "lgrep_rename": { oldName: string, newName: string, preview?: boolean }
}
```

**Key files to create:**
- `src/mcp/server.ts` (MCP server implementation)
- `src/mcp/tools.ts` (tool definitions)
- `src/mcp/handlers.ts` (request handlers)

**Installation:**
```bash
lgrep install-mcp  # Adds to Claude Code's MCP config
```

**Estimated complexity:** Medium (MCP protocol, JSON-RPC)

---

### 3.2 Auto-Context for Claude Code

**Purpose:** Auto-run `lgrep impact` when user asks "refactor X"

**Implementation via skill:**
- Enhance existing `install` command
- Create SessionStart hook that detects refactoring intent
- Auto-inject context into prompts

**Skill trigger patterns:**
```
"refactor X" → lgrep impact X
"rename X" → lgrep callers X + lgrep impact X
"find callers of X" → lgrep callers X
"what uses X" → lgrep callers X
"dead code" → lgrep dead
"circular deps" → lgrep cycles
```

**Key files to modify:**
- `src/cli/commands/install.ts` (enhance skill)
- Create skill file with pattern matching

**Estimated complexity:** Medium (skill authoring, pattern matching)

---

## Phase 4: Natural Language Interface

### 4.1 Intent-to-Command Mapping

**Purpose:** One command that understands intent

**Usage:**
```bash
lgrep "what calls awardBadge"        # → runs callers
lgrep "what happens if I change X"   # → runs impact
lgrep "find dead code in contracts/" # → runs dead
lgrep "show me the call graph"       # → runs analyze --calls
lgrep "similar to validateUser"      # → runs similar
lgrep "circular dependencies"        # → runs cycles
```

**Implementation:**
```
1. Embed the natural language query
2. Match against intent embeddings OR use LLM classification
3. Extract entity (function name, path, etc.)
4. Map to command + options
5. Execute and return results
```

**Options:**
- `--explain` - Show which command was inferred
- `--confirm` - Ask before executing

**Two approaches:**

**A. Pattern + Embedding approach (fast, no LLM):**
```typescript
const intents = [
  { pattern: /what (calls|uses|invokes)/i, command: 'callers', extract: 'symbol' },
  { pattern: /impact|blast radius|what breaks/i, command: 'impact', extract: 'symbol' },
  { pattern: /dead code|unused|not called/i, command: 'dead', extract: 'path?' },
  { pattern: /similar|duplicate|like/i, command: 'similar', extract: 'symbol' },
  { pattern: /circular|cycle/i, command: 'cycles', extract: 'none' },
  { pattern: /rename/i, command: 'rename', extract: 'oldNew' },
  // ... more patterns
]
```

**B. LLM classification approach (smart, requires API):**
```typescript
const systemPrompt = `You are a code intelligence router. Given a natural language query about code, output JSON with the command and parameters.

Commands: search, callers, impact, deps, dead, similar, cycles, unused-exports, breaking, rename, analyze

Example: "what calls validateUser" → {"command": "callers", "symbol": "validateUser"}
Example: "find dead code in src/api" → {"command": "dead", "path": "src/api"}
`
```

**Hybrid approach (recommended):**
1. Try pattern matching first (instant, no API)
2. Fall back to LLM for complex queries
3. Cache LLM classifications for repeated patterns

**Key files to create:**
- `src/cli/commands/nl.ts` (natural language handler)
- `src/core/intent/patterns.ts` (pattern matchers)
- `src/core/intent/classifier.ts` (LLM classifier)

**Estimated complexity:** Medium-High (NL parsing, entity extraction)

---

## Implementation Order

### Sprint 1: Foundation (Week 1-2)
1. ✅ Explore codebase (done)
2. `lgrep dead` - Simple, high value
3. `lgrep cycles` - Graph algorithm, medium value
4. Auto-detect `.lgrep.json` - UX improvement

### Sprint 2: Code Intelligence (Week 3-4)
5. `lgrep unused-exports` - Complements dead code
6. `lgrep similar` - Leverages embeddings
7. Default watch mode - UX improvement

### Sprint 3: Refactoring Tools (Week 5-6)
8. `lgrep breaking` - Signature analysis
9. `lgrep rename --preview` - Complex but high value

### Sprint 4: Integration (Week 7-8)
10. MCP server - Claude Code integration
11. Enhanced skill with auto-context

### Sprint 5: Polish (Week 9-10)
12. Daemon query mode - Speed improvement
13. Natural language interface - The killer feature

---

## Testing Strategy

Each new command needs:
1. **Unit tests** - Core algorithm logic
2. **Integration tests** - Full command flow with temp directories
3. **Cross-language tests** - TypeScript, Solidity, Go, Python samples

Test file pattern: `src/cli/commands/<command>.test.ts`

---

## Success Metrics

| Feature | Success Criteria |
|---------|------------------|
| `dead` | Finds actual dead code, no false positives for entry points |
| `cycles` | Detects all circular deps in test fixtures |
| `similar` | Returns semantically similar code above threshold |
| `unused-exports` | Correctly excludes package.json exports |
| `breaking` | Identifies argument count mismatches |
| `rename` | Applies correct edits, no syntax errors |
| Daemon | <100ms query latency after first cold start |
| MCP | All tools callable from Claude Code |
| NL | >90% accuracy on common query patterns |

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Tarjan's algorithm complexity | Well-documented, test with complex graphs |
| Signature parsing edge cases | Start with TypeScript, expand to other languages |
| IPC cross-platform issues | Use Node.js built-in IPC, test on Mac/Linux |
| LLM costs for NL interface | Use local Ollama, pattern matching first |
| MCP protocol changes | Pin MCP SDK version, monitor updates |

---

## Files Changed Summary

### New Files
- `src/cli/commands/dead.ts`
- `src/cli/commands/similar.ts`
- `src/cli/commands/cycles.ts`
- `src/cli/commands/unused-exports.ts`
- `src/cli/commands/breaking.ts`
- `src/cli/commands/rename.ts`
- `src/cli/commands/nl.ts`
- `src/core/refactor/rename.ts`
- `src/core/ast/signature-analyzer.ts`
- `src/core/intent/patterns.ts`
- `src/core/intent/classifier.ts`
- `src/daemon/server.ts`
- `src/daemon/client.ts`
- `src/mcp/server.ts`
- `src/mcp/tools.ts`
- `src/mcp/handlers.ts`

### Modified Files
- `src/cli/index.ts` (add commands)
- `src/cli/utils/auto-detect.ts` (enhance detection)
- `src/cli/commands/index.ts` (write .lgrep.json, auto-watch)
- `src/daemon/manager.ts` (extend for query daemon)
- `src/cli/commands/install.ts` (enhance skill)
