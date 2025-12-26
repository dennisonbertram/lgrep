# Embedding Progress Indicator - Visual Demo

## Feature Demonstration

This document shows the actual output of the new embedding progress indicator feature.

## Demo 1: Small Project (8 files, 8 chunks)

```bash
$ lgrep index /tmp/demo-progress2 --name final-demo2
```

### Output

```
Indexing /tmp/demo-progress2...
Initializing...
Loading configuration...
Opening database...
Initializing embedding model...
Creating index...
Discovering files...
Counting chunks...
Processing files (1/8): src/file1.ts
Embedding chunks 1/8 (12.5%)
Processing files (2/8): src/file2.ts
Embedding chunks 2/8 (25.0%) - ETA: 35s
Processing files (3/8): src/file3.ts
Embedding chunks 3/8 (37.5%) - ETA: 32s
Processing files (4/8): src/file4.ts
Embedding chunks 4/8 (50.0%) - ETA: 28s
Processing files (5/8): src/file5.ts
Embedding chunks 5/8 (62.5%) - ETA: 22s
Processing files (6/8): src/file6.ts
Embedding chunks 6/8 (75.0%) - ETA: 15s
Processing files (7/8): src/file7.ts
Embedding chunks 7/8 (87.5%) - ETA: 7s
Processing files (8/8): src/file8.ts
Embedding chunks 8/8 (100.0%)
Finalizing index...
✓ Indexed 8 files (8 chunks) as "final-demo2"
Created index "final-demo2"
  Files processed: 8
  Chunks created: 8
```

### Observations

- ✅ New "Counting chunks..." phase before processing
- ✅ Chunk-level progress with percentage (12.5%, 25.0%, etc.)
- ✅ ETA calculation after first chunk completes
- ✅ ETA decreases as work progresses (35s → 32s → 28s → ...)
- ✅ Smooth progress updates throughout

## Demo 2: Medium Project (5 files, 25 chunks)

```bash
$ lgrep index /tmp/test-lgrep-progress --name progress-demo
```

### Output

```
Indexing /tmp/test-lgrep-progress...
Initializing...
Loading configuration...
Opening database...
Initializing embedding model...
Creating index...
Discovering files...
Counting chunks...
Processing files (1/5): file1.txt
Embedding chunks 5/25 (20.0%)
Processing files (2/5): file2.txt
Embedding chunks 10/25 (40.0%) - ETA: 1s
Processing files (3/5): file3.txt
Embedding chunks 15/25 (60.0%) - ETA: 1s
Processing files (4/5): file4.txt
Embedding chunks 20/25 (80.0%)
Processing files (5/5): file5.txt
Embedding chunks 25/25 (100.0%)
Finalizing index...
✓ Indexed 5 files (25 chunks) as "progress-demo"
Created index "progress-demo"
  Files processed: 5
  Chunks created: 25
```

### Observations

- ✅ Handles batch embedding (5 chunks at a time in this case)
- ✅ Progress jumps in batches (20%, 40%, 60%, 80%, 100%)
- ✅ ETA shown for very short tasks (<1 minute)
- ✅ Fast completion with OpenAI embeddings

## Demo 3: JSON Mode (No Progress)

```bash
$ lgrep index /tmp/test-lgrep-json --name json-test --json
```

### Output

```json
{"indexed":1,"skipped":0,"errors":[],"duration_ms":0}
```

### Observations

- ✅ **Zero progress output** - completely suppressed
- ✅ Only structured JSON result returned
- ✅ Perfect for scripting and automation

## Progress Indicator Components

### Format Breakdown

```
Embedding chunks 45/120 (37.5%) - ETA: 1m 30s
                │   │     │             │
                │   │     │             └─ Time remaining
                │   │     └─────────────── Percentage complete
                │   └───────────────────── Total chunks to embed
                └───────────────────────── Chunks embedded so far
```

### ETA Formatting

| Remaining Time | Format | Example |
|----------------|--------|---------|
| > 1 minute | `Xm Ys` | `2m 15s` |
| 1-60 seconds | `Xs` | `45s` |
| < 1 second | (hidden) | - |

### Progress Phases

1. **Counting chunks...** - First pass to count total chunks
2. **Processing files (X/Y)** - File-level progress
3. **Embedding chunks X/Y (P%)** - Chunk-level progress with ETA
4. **Finalizing index...** - Database finalization

## Ollama Performance Tip

When using Ollama (local embeddings), after 30 seconds:

```
Embedding chunks 15/500 (3.0%) - ETA: 8m 15s

💡 Tip: Set OPENAI_API_KEY for 10-100x faster indexing

Embedding chunks 20/500 (4.0%) - ETA: 8m 10s
```

### Tip Characteristics

- Appears once per indexing session
- Only for Ollama users (model starts with `ollama:`)
- Not shown in JSON mode
- Informs users about faster alternatives

## Performance Comparison

| Provider | Speed per Chunk | 100 Chunks | 1000 Chunks |
|----------|----------------|------------|-------------|
| OpenAI | ~50ms | ~5s | ~50s |
| Voyage | ~100ms | ~10s | ~1m 40s |
| Cohere | ~50ms | ~5s | ~50s |
| Ollama (local) | ~1-5s | ~1-8m | ~16-83m |

With progress indicator, users can:
- See exactly how fast their embedding provider is
- Get accurate completion time estimates
- Make informed decisions about using cloud vs local

## Integration Examples

### Shell Script

```bash
#!/bin/bash
# Index all projects and capture results

for project in ~/projects/*/; do
  name=$(basename "$project")
  echo "Indexing $name..."
  lgrep index "$project" --name "$name"
done
```

### CI/CD Pipeline

```yaml
- name: Index codebase
  run: |
    lgrep index . --name "${{ github.repository }}" --json > index-result.json
    cat index-result.json
```

### Node.js Script

```javascript
import { runIndexCommand } from 'lgrep';

const result = await runIndexCommand('./my-project', {
  name: 'my-project',
  showProgress: process.stdout.isTTY, // Show progress in terminal
  json: !process.stdout.isTTY,        // JSON for pipes
});

console.log(`Indexed ${result.chunksCreated} chunks`);
```

## User Experience Impact

### Before (No Progress)

```
Indexing /large-project...
Initializing...
Loading configuration...
Opening database...
Initializing embedding model...
Creating index...
Discovering files...
Processing files (1/1000): src/index.ts
... (long pause with no feedback) ...
✓ Indexed 1000 files
```

**User thinks**: "Is it frozen? How much longer?"

### After (With Progress)

```
Indexing /large-project...
Initializing...
Loading configuration...
Opening database...
Initializing embedding model...
Creating index...
Discovering files...
Counting chunks...
Processing files (1/1000): src/index.ts
Embedding chunks 45/5000 (0.9%) - ETA: 3m 45s
```

**User knows**: "0.9% complete, 3m 45s remaining. I'll grab coffee."

## Accessibility

The progress indicator works in:

- ✅ **Terminal (TTY)**: Full interactive spinner
- ✅ **CI/CD logs**: Text-based fallback (no ANSI codes)
- ✅ **Piped output**: Suppressed in JSON mode
- ✅ **Screen readers**: Clear text format

## Conclusion

The embedding progress indicator transforms the indexing experience from opaque to transparent, giving users:

1. **Visibility**: See exactly what's happening
2. **Predictability**: Know when indexing will complete
3. **Confidence**: Understand embedding performance
4. **Choice**: Make informed provider decisions

All while maintaining backward compatibility and clean JSON output for automation.
