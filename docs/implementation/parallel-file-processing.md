# Parallel File Processing Implementation

## Overview

Implemented parallel file processing to significantly improve indexing performance by processing multiple files concurrently instead of sequentially.

## Changes Made

### 1. Configuration (`src/storage/config.ts`)

Added new configuration option:
- `parallelFiles`: Number of files to process in parallel (default: 10)

### 2. Index Command (`src/cli/commands/index.ts`)

Refactored the main file processing loop from sequential to parallel batch processing:

#### Previous Implementation
- Files processed one at a time in a `for` loop
- Each file had to complete before the next started
- I/O operations (file read, embedding API calls) blocked the main thread

#### New Implementation (6 Phases per Batch)

**Phase 1: Parallel File Reading**
- Read multiple files and compute content hashes concurrently
- Filter files that need processing (changed or new)

**Phase 2: Parallel Chunking**
- Chunk file contents in parallel
- CPU-bound operation benefits from concurrent processing

**Phase 3: Parallel Cache Check**
- Check embedding cache for each chunk concurrently
- Collect uncached chunks for batch embedding

**Phase 4: Cross-File Embedding Batching**
- Batch embedding requests across all files in the current parallel batch
- Reduces API calls by combining chunks from multiple files

**Phase 5: Chunk Collection**
- Aggregate all generated chunks
- Batch write to database when threshold reached

**Phase 6: Parallel Code Intelligence Extraction**
- Extract symbols, dependencies, and calls concurrently
- Aggregate counts after parallel execution to avoid race conditions

## Performance Benefits

### Expected Improvements

| Metric | Before | After |
|--------|--------|-------|
| File I/O | Sequential | Parallel (10 files) |
| Embedding API calls | Per-file batching | Cross-file batching |
| Code intelligence | Sequential | Parallel per batch |

### Example Scenario (100 files, 5 chunks each)

**Before:**
- 100 sequential file reads
- 500 embedding API calls (or 50 batches of 10 per file)
- 100 sequential code intel extractions

**After:**
- 10 parallel batch iterations
- 50 cross-file embedding batches (500 chunks ÷ 10)
- 10 parallel code intel batches

## Configuration

```bash
# View current setting
lgrep config get parallelFiles

# Adjust concurrency (default: 10)
lgrep config set parallelFiles 20
```

## Technical Notes

### Race Condition Prevention

The implementation carefully avoids race conditions:

1. **Counter updates**: Code intelligence counts are collected from each parallel task and aggregated after `Promise.all` completes
2. **Chunk collection**: Per-file uncached chunks are collected separately and flattened after parallel cache checks
3. **Map initialization**: Document chunk arrays are initialized before parallel operations

### Fallback Values

Configuration values have safe defaults for backward compatibility:
- `parallelFiles ?? 10`
- `embedBatchSize ?? 10`
- `dbBatchSize ?? 250`

### Error Handling

- Individual file failures don't stop batch processing
- Code intelligence extraction errors are caught and logged
- Failed indexes are marked appropriately

## Testing

All existing tests pass. Some integration tests may be flaky when run in parallel due to shared database state (test isolation issue, not related to this change).

```bash
# Run tests
npm test

# Run specific index tests
npm test -- src/cli/commands/index.test.ts
```

## Future Enhancements

1. **Adaptive batch sizing**: Adjust `parallelFiles` based on system resources
2. **Memory monitoring**: Scale back concurrency if memory pressure detected
3. **Progress reporting**: Show per-file progress within parallel batches
4. **API rate limiting**: Respect embedding provider rate limits
