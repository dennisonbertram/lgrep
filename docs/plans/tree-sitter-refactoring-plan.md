# Tree-Sitter Integration Refactoring Plan

**Created:** 2025-12-20
**Status:** Ready for Implementation
**Estimated Effort:** 31 hours (~1 week)
**Priority:** Critical before v1.0 release

---

## Executive Summary

The tree-sitter integration works but has critical architectural issues that will cause problems at scale:
- Race conditions in parser reuse
- Memory leaks from unreleased trees
- 3x performance overhead from triple parsing
- Extension constants duplicated in 4 files
- 21% code that can be simplified

This plan addresses all issues in priority order.

---

## Phase 1: Critical Fixes (9 hours)

### 1.1 Centralize Language Registry (2 hours)

**Problem:** Extension constants duplicated in 4 files - adding a language requires 4+ changes.

**Files to modify:**
- Create: `src/core/ast/languages.ts`
- Update: `src/core/ast/tree-sitter/parser.ts`
- Update: `src/core/ast/analyzer.ts`
- Update: `src/core/chunker.ts`
- Update: `src/cli/commands/index.ts`

**Implementation:**

```typescript
// src/core/ast/languages.ts
export interface LanguageDefinition {
  name: string;
  extensions: readonly string[];
  parser: 'babel' | 'solidity' | 'tree-sitter';
  treeSitterGrammar?: string;
}

export const LANGUAGES: readonly LanguageDefinition[] = [
  { name: 'JavaScript', extensions: ['.js', '.jsx'], parser: 'babel' },
  { name: 'TypeScript', extensions: ['.ts', '.tsx'], parser: 'babel' },
  { name: 'Solidity', extensions: ['.sol'], parser: 'solidity' },
  { name: 'Go', extensions: ['.go'], parser: 'tree-sitter', treeSitterGrammar: 'go' },
  { name: 'Rust', extensions: ['.rs'], parser: 'tree-sitter', treeSitterGrammar: 'rust' },
  { name: 'Python', extensions: ['.py'], parser: 'tree-sitter', treeSitterGrammar: 'python' },
  { name: 'C', extensions: ['.c', '.h'], parser: 'tree-sitter', treeSitterGrammar: 'c' },
  { name: 'C++', extensions: ['.cpp', '.cc', '.cxx', '.hpp'], parser: 'tree-sitter', treeSitterGrammar: 'cpp' },
  { name: 'Java', extensions: ['.java'], parser: 'tree-sitter', treeSitterGrammar: 'java' },
] as const;

export const ALL_CODE_EXTENSIONS = LANGUAGES.flatMap(l => l.extensions);

export const TREE_SITTER_EXTENSIONS = LANGUAGES
  .filter(l => l.parser === 'tree-sitter')
  .flatMap(l => l.extensions);

export function getLanguage(extension: string): LanguageDefinition | undefined {
  return LANGUAGES.find(l => l.extensions.includes(extension));
}

export function getParserType(extension: string): 'babel' | 'solidity' | 'tree-sitter' | null {
  return getLanguage(extension)?.parser ?? null;
}

export function getTreeSitterGrammar(extension: string): string | undefined {
  const lang = getLanguage(extension);
  return lang?.parser === 'tree-sitter' ? lang.treeSitterGrammar : undefined;
}

export function isSupportedExtension(extension: string): boolean {
  return ALL_CODE_EXTENSIONS.includes(extension);
}
```

**Tests to add:**
- `src/core/ast/languages.test.ts`

**Acceptance criteria:**
- [ ] Single source of truth for all extensions
- [ ] Adding a new language = 1 file change
- [ ] All existing tests pass

---

### 1.2 Add Parse Tree Caching (3 hours)

**Problem:** Each file is parsed 3 times (symbols, calls, dependencies).

**Files to modify:**
- `src/core/ast/tree-sitter/parser.ts`
- `src/core/ast/analyzer.ts`

**Implementation:**

```typescript
// src/core/ast/tree-sitter/parser.ts

import { createHash } from 'node:crypto';

interface CachedTree {
  hash: string;
  tree: Tree;
  language: string;
}

const treeCache = new Map<string, CachedTree>();
const MAX_CACHE_SIZE = 50;

export async function parseCode(
  code: string,
  extension: string,
  options?: { useCache?: boolean }
): Promise<Tree | null> {
  const grammarName = getTreeSitterGrammar(extension);
  if (!grammarName) return null;

  // Check cache
  if (options?.useCache !== false) {
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
    const cacheKey = `${extension}:${hash}`;
    const cached = treeCache.get(cacheKey);
    if (cached && cached.language === grammarName) {
      return cached.tree;
    }
  }

  try {
    const parser = await getParserForLanguage(grammarName);
    const tree = parser.parse(code) as Tree;

    // Cache the result
    if (options?.useCache !== false) {
      const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
      const cacheKey = `${extension}:${hash}`;

      // LRU eviction
      if (treeCache.size >= MAX_CACHE_SIZE) {
        const firstKey = treeCache.keys().next().value;
        const evicted = treeCache.get(firstKey);
        if (evicted?.tree && typeof (evicted.tree as any).delete === 'function') {
          (evicted.tree as any).delete();
        }
        treeCache.delete(firstKey);
      }

      treeCache.set(cacheKey, { hash, tree, language: grammarName });
    }

    return tree;
  } catch (error) {
    return null;
  }
}

export function clearTreeCache(): void {
  for (const cached of treeCache.values()) {
    if (cached.tree && typeof (cached.tree as any).delete === 'function') {
      (cached.tree as any).delete();
    }
  }
  treeCache.clear();
}
```

**Acceptance criteria:**
- [ ] Same file parsed once regardless of extraction count
- [ ] Cache respects memory limits (LRU eviction)
- [ ] Trees are properly freed on eviction
- [ ] 66% reduction in parse operations

---

### 1.3 Fix Parser Race Condition (2 hours)

**Problem:** Single parser instance mutated with `setLanguage()` - concurrent calls will conflict.

**Files to modify:**
- `src/core/ast/tree-sitter/parser.ts`

**Implementation:**

```typescript
// src/core/ast/tree-sitter/parser.ts

// Replace single parser with per-language pool
const parserPool = new Map<string, unknown>();

async function getParserForLanguage(grammarName: string): Promise<unknown> {
  if (!parserPool.has(grammarName)) {
    const TreeSitterModule = await import('tree-sitter');
    const Parser = TreeSitterModule.default;
    const parser = new Parser();
    const grammar = await loadGrammar(grammarName);
    parser.setLanguage(grammar);
    parserPool.set(grammarName, parser);
  }
  return parserPool.get(grammarName)!;
}

// Rename existing loadLanguage to loadGrammar for clarity
async function loadGrammar(grammarName: string): Promise<unknown> {
  // ... existing switch statement
}
```

**Acceptance criteria:**
- [ ] Each language has its own parser instance
- [ ] No mutation of shared state during parse
- [ ] Concurrent parsing of different languages works correctly

---

### 1.4 Fix Memory Leak (2 hours)

**Problem:** Parsed trees consume native memory that V8 doesn't track. Without cleanup, long-running processes OOM.

**Files to modify:**
- `src/core/ast/tree-sitter/symbol-extractor.ts`
- `src/core/ast/tree-sitter/call-extractor.ts`
- `src/core/ast/tree-sitter/dependency-extractor.ts`
- `src/core/ast/analyzer.ts`

**Implementation:**

```typescript
// In each tree-sitter extractor, add cleanup:

export async function extractSymbolsTreeSitter(...): Promise<CodeSymbol[]> {
  const tree = await parseCode(code, extension);
  if (!tree) return [];

  try {
    // ... existing extraction logic
    return symbols;
  } finally {
    // Don't delete if using cache - cache handles cleanup
    // Only delete if tree was created without cache
  }
}

// In analyzer.ts - clear cache after project analysis
export async function analyzeProject(...): Promise<AnalyzeResult> {
  try {
    // ... existing logic
    return result;
  } finally {
    clearTreeCache(); // Clean up all cached trees
  }
}
```

**Acceptance criteria:**
- [ ] Memory usage stable over long runs
- [ ] No orphaned native tree-sitter objects
- [ ] Cache cleanup on analysis completion

---

## Phase 2: Performance Improvements (8 hours)

### 2.1 Parallel File Processing (4 hours)

**Problem:** Files analyzed sequentially despite being async - wastes 75% of CPU.

**Files to modify:**
- `src/core/ast/analyzer.ts`

**Implementation:**

```typescript
// src/core/ast/analyzer.ts

const DEFAULT_CONCURRENCY = 10;

export async function analyzeProject(
  rootPath: string,
  options: AnalyzeOptions & { concurrency?: number } = {}
): Promise<AnalyzeResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // ... file discovery logic ...

  // Process in parallel batches
  const results: FileAnalysis[] = [];

  for (let i = 0; i < filesToAnalyze.length; i += concurrency) {
    const batch = filesToAnalyze.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(file =>
        analyzeFile(file, rootPath).catch(err => ({
          filePath: file,
          relativePath: relative(rootPath, file),
          extension: extname(file),
          contentHash: '',
          symbols: [],
          dependencies: [],
          calls: [],
          errors: [err.message],
          analyzedAt: new Date().toISOString(),
        }))
      )
    );
    results.push(...batchResults);
  }

  // Aggregate results
  return aggregateResults(results, options);
}
```

**Acceptance criteria:**
- [ ] 10x speedup on multi-core systems
- [ ] Configurable concurrency limit
- [ ] Graceful error handling per file

---

### 2.2 Optimize Tree Traversal (2 hours)

**Problem:** `findNodesByTypes` uses O(n×t) linear search and recursive traversal.

**Files to modify:**
- `src/core/ast/tree-sitter/parser.ts`

**Implementation:**

```typescript
// Replace recursive with iterative, use Set for O(1) lookup

export function findNodesByTypes(
  root: SyntaxNode,
  types: string[]
): SyntaxNode[] {
  const typeSet = new Set(types);
  const results: SyntaxNode[] = [];
  const stack: SyntaxNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (typeSet.has(node.type)) {
      results.push(node);
    }

    // Add children in reverse order for correct traversal
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }

  return results;
}

// Remove duplicate findNodes function - merge into findNodesByTypes
export function findNodes(root: SyntaxNode, type: string): SyntaxNode[] {
  return findNodesByTypes(root, [type]);
}
```

**Acceptance criteria:**
- [ ] O(n) traversal instead of O(n×t)
- [ ] No stack overflow on deep trees
- [ ] 3-5x faster on large files

---

### 2.3 Add Proper TypeScript Types (2 hours)

**Problem:** `unknown` and `any` everywhere loses compile-time safety.

**Files to modify:**
- Create: `src/core/ast/tree-sitter/types.ts`
- Update: `src/core/ast/tree-sitter/parser.ts`

**Implementation:**

```typescript
// src/core/ast/tree-sitter/types.ts

export interface TreeSitterParser {
  setLanguage(language: TreeSitterLanguage): void;
  parse(input: string): Tree;
}

export interface TreeSitterLanguage {
  // Opaque type from grammar modules
}

export interface Tree {
  rootNode: SyntaxNode;
  delete?(): void;
}

export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  childCount: number;
  child(index: number): SyntaxNode | null;
  childForFieldName(name: string): SyntaxNode | null;
  children: SyntaxNode[];
  parent: SyntaxNode | null;
}
```

**Acceptance criteria:**
- [ ] No `any` casts in parser.ts
- [ ] No `unknown` types for tree-sitter objects
- [ ] TypeScript catches API misuse at compile time

---

## Phase 3: Code Simplification (8 hours)

### 3.1 Inline Dispatcher Wrappers (4 hours)

**Problem:** 3 extractor files are just dispatchers adding indirection.

**Files to modify:**
- `src/core/ast/analyzer.ts`
- Deprecate: `src/core/ast/symbol-extractor.ts` (keep for backwards compat)
- Deprecate: `src/core/ast/call-extractor.ts`
- Deprecate: `src/core/ast/dependency-extractor.ts`

**Implementation:**

Move dispatch logic directly into `analyzeFile()`:

```typescript
// src/core/ast/analyzer.ts

import { extractSymbolsTreeSitter } from './tree-sitter/symbol-extractor.js';
import { extractCallsTreeSitter } from './tree-sitter/call-extractor.js';
import { extractDependenciesTreeSitter } from './tree-sitter/dependency-extractor.js';
import { getParserType } from './languages.js';

export async function analyzeFile(filePath: string, rootPath: string): Promise<FileAnalysis> {
  const code = await readFile(filePath, 'utf-8');
  const extension = extname(filePath);
  const relativePath = relative(rootPath, filePath);
  const parserType = getParserType(extension);

  let symbols: CodeSymbol[] = [];
  let dependencies: CodeDependency[] = [];
  let calls: CallEdge[] = [];

  switch (parserType) {
    case 'tree-sitter':
      symbols = await extractSymbolsTreeSitter(code, filePath, relativePath, extension);
      calls = (await extractCallsTreeSitter(code, filePath, extension)).map(c => convertCall(c, filePath, relativePath));
      dependencies = (await extractDependenciesTreeSitter(code, filePath, extension)).map(d => convertDependency(d, filePath));
      break;

    case 'solidity':
      symbols = await extractSoliditySymbols(code, filePath, relativePath);
      calls = (await extractSolidityCalls(code, filePath)).map(c => convertCall(c, filePath, relativePath));
      dependencies = (await extractSolidityDependencies(code, filePath)).map(d => convertDependency(d, filePath));
      break;

    case 'babel':
      symbols = await extractBabelSymbols(code, filePath, relativePath, extension);
      calls = (await extractBabelCalls(code, filePath)).map(c => convertCall(c, filePath, relativePath));
      dependencies = (await extractBabelDependencies(code, filePath)).map(d => convertDependency(d, filePath));
      break;
  }

  return { filePath, relativePath, extension, symbols, dependencies, calls, ... };
}
```

**Acceptance criteria:**
- [ ] Clear data flow visible in one file
- [ ] -240 LOC reduction
- [ ] All tests still pass

---

### 3.2 Merge Duplicate Functions (2 hours)

**Problem:** `findNodes` and `findNodesByTypes` are nearly identical.

**Files to modify:**
- `src/core/ast/tree-sitter/parser.ts`

**Implementation:**

```typescript
// Keep only findNodesByTypes, make findNodes a simple wrapper
export function findNodesByTypes(root: SyntaxNode, types: string[]): SyntaxNode[] {
  // ... iterative implementation from 2.2
}

export function findNodes(root: SyntaxNode, type: string): SyntaxNode[] {
  return findNodesByTypes(root, [type]);
}
```

**Acceptance criteria:**
- [ ] Single implementation for tree walking
- [ ] -15 LOC

---

### 3.3 Remove Dead Code (2 hours)

**Problem:** Unused features, incomplete implementations, empty error handlers.

**Files to audit:**
- All tree-sitter extractors
- `src/core/ast/analyzer.ts`

**Items to remove/fix:**
1. `argumentCount: 0` - either implement or remove from interface
2. `isExported: false, isDefaultExport: false` - make optional for tree-sitter
3. Empty `catch (error) { return []; }` - add logging or remove try/catch
4. Redundant validation checks after `parseCode()` already validates

**Acceptance criteria:**
- [ ] No half-implemented features
- [ ] Errors are logged, not swallowed
- [ ] -50 LOC

---

## Phase 4: Testing & Documentation (6 hours)

### 4.1 Add Performance Benchmarks (2 hours)

**Files to create:**
- `benchmarks/tree-sitter-parse.ts`
- `benchmarks/analyzer-throughput.ts`

**Implementation:**

```typescript
// benchmarks/tree-sitter-parse.ts
import { parseCode } from '../src/core/ast/tree-sitter/parser.js';

async function benchmark() {
  const testCases = [
    { name: 'Small Go file', code: smallGoCode, ext: '.go' },
    { name: 'Large Rust file', code: largeRustCode, ext: '.rs' },
    // ...
  ];

  for (const { name, code, ext } of testCases) {
    const iterations = 100;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      await parseCode(code, ext);
    }

    const elapsed = performance.now() - start;
    console.log(`${name}: ${(elapsed / iterations).toFixed(2)}ms avg`);
  }
}
```

**Acceptance criteria:**
- [ ] Baseline performance documented
- [ ] CI can detect performance regressions

---

### 4.2 Update Documentation (2 hours)

**Files to update:**
- `README.md` - add supported languages section
- Create: `docs/architecture/tree-sitter-integration.md`

**Content:**
- Supported languages and extensions
- How to add a new language
- Performance characteristics
- Architecture diagram

---

### 4.3 Add Integration Tests (2 hours)

**Files to create:**
- `src/core/ast/tree-sitter/integration.test.ts`

**Tests to add:**
- Parse all supported languages
- Concurrent parsing of mixed languages
- Large file handling (10K+ LOC)
- Memory usage under load

---

## Implementation Schedule

| Week | Phase | Tasks | Hours |
|------|-------|-------|-------|
| 1 Mon-Tue | 1.1-1.2 | Language registry + Parse caching | 5h |
| 1 Wed | 1.3-1.4 | Parser pool + Memory leak fix | 4h |
| 1 Thu-Fri | 2.1 | Parallel processing | 4h |
| 2 Mon | 2.2-2.3 | Tree traversal + Types | 4h |
| 2 Tue-Wed | 3.1 | Inline dispatchers | 4h |
| 2 Thu | 3.2-3.3 | Merge functions + Remove dead code | 4h |
| 2 Fri | 4.1-4.3 | Tests + Docs | 6h |

**Total: 31 hours**

---

## Success Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Parse operations per file | 3 | 1 | 66% reduction |
| Concurrent safety | No | Yes | Race conditions eliminated |
| Memory leaks | Yes | No | Stable memory usage |
| Files to change for new lang | 4+ | 1 | 75% reduction |
| Lines of code | 3174 | ~2500 | 21% reduction |
| Large repo analysis time | 90s | 9s | 10x faster |

---

## Rollback Plan

Each phase is independently deployable. If issues arise:

1. **Phase 1:** Revert to duplicated constants, disable caching
2. **Phase 2:** Reduce concurrency to 1, revert to recursive traversal
3. **Phase 3:** Keep wrapper files, don't inline

All changes should have feature flags where possible for gradual rollout.

---

## Appendix: File Change Summary

### New Files
- `src/core/ast/languages.ts`
- `src/core/ast/tree-sitter/types.ts`
- `benchmarks/tree-sitter-parse.ts`
- `benchmarks/analyzer-throughput.ts`
- `docs/architecture/tree-sitter-integration.md`

### Modified Files
- `src/core/ast/tree-sitter/parser.ts` (major refactor)
- `src/core/ast/tree-sitter/symbol-extractor.ts` (cleanup)
- `src/core/ast/tree-sitter/call-extractor.ts` (cleanup)
- `src/core/ast/tree-sitter/dependency-extractor.ts` (cleanup)
- `src/core/ast/analyzer.ts` (inline dispatch, parallel processing)
- `src/core/chunker.ts` (use languages.ts)
- `src/cli/commands/index.ts` (use languages.ts)

### Deprecated Files (keep for backwards compat)
- `src/core/ast/symbol-extractor.ts`
- `src/core/ast/call-extractor.ts`
- `src/core/ast/dependency-extractor.ts`
