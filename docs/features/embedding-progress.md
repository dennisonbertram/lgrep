# Embedding Progress Indicator

## Overview

The `lgrep index` command now includes chunk-level progress tracking during the embedding phase, providing real-time feedback on indexing progress with ETA calculation.

## Features

### 1. Chunk-Level Progress

Shows the number of chunks embedded out of the total, with a percentage:

```
Embedding chunks 45/120 (37.5%) - ETA: 1m 30s
```

### 2. ETA Calculation

Calculates estimated time to completion based on average time per chunk:
- For ETAs > 1 minute: Shows `Xm Ys` format (e.g., `2m 15s`)
- For ETAs < 1 minute: Shows `Xs` format (e.g., `45s`)
- Updates dynamically as embedding progresses

### 3. Ollama Performance Tip

When using local Ollama embeddings (slower), after 30 seconds of embedding, shows:

```
💡 Tip: Set OPENAI_API_KEY for 10-100x faster indexing
```

This tip:
- Only shows once per indexing session
- Only shows when model starts with `ollama:`
- Does not show in JSON mode

### 4. JSON Mode Compatibility

Progress output is fully suppressed when using `--json` flag, ensuring clean structured output for programmatic consumption.

## Implementation Details

### Progress Tracking Flow

1. **Counting Phase**: Before processing files, counts total chunks across all files
2. **Embedding Phase**: Tracks chunks embedded after each batch
3. **Progress Updates**: Updates spinner with current progress and ETA
4. **Tip Display**: Shows performance tip for Ollama users after 30s

### Key Components

#### Progress Callback

```typescript
const onProgress = (chunksProcessed: number) => {
  embeddedChunks += chunksProcessed;
  const percentage = ((embeddedChunks / totalChunksToEmbed) * 100).toFixed(1);
  // Calculate ETA and update spinner
};
```

#### Process File Integration

The `processFile` function accepts an optional `onProgress` callback that's called after each embedding batch:

```typescript
async function processFile(
  file: WalkResult,
  embedClient: EmbeddingClient,
  cache: Cache,
  chunkSize: number,
  chunkOverlap: number,
  embedBatchSize: number,
  onProgress?: (chunksProcessed: number) => void
): Promise<DocumentChunk[]>
```

### Performance Characteristics

- **Fast providers** (OpenAI, Voyage, Cohere): ~50-100ms per chunk
  - Progress updates are smooth and frequent
  - ETA stabilizes quickly (after ~10-20 chunks)

- **Slow providers** (Ollama local): ~1-5s per chunk
  - Progress updates every batch (default: 10 chunks)
  - ETA becomes reliable after ~30s
  - Tip displays to inform users about faster alternatives

## Examples

### Basic Usage

```bash
lgrep index ./my-project
```

Output:
```
Indexing ./my-project...
Initializing...
Loading configuration...
Opening database...
Initializing embedding model...
Creating index...
Discovering files...
Counting chunks...
Processing files (1/50): src/index.ts
Embedding chunks 5/250 (2.0%)
Processing files (2/50): src/utils.ts
Embedding chunks 10/250 (4.0%) - ETA: 2m 30s
...
Embedding chunks 250/250 (100.0%)
Finalizing index...
✓ Indexed 50 files (250 chunks) as "my-project"
```

### With Ollama (Shows Tip)

```bash
lgrep config model "ollama:mxbai-embed-large"
lgrep index ./large-project
```

After 30 seconds:
```
Embedding chunks 15/500 (3.0%) - ETA: 8m 15s

💡 Tip: Set OPENAI_API_KEY for 10-100x faster indexing

Embedding chunks 20/500 (4.0%) - ETA: 8m 10s
...
```

### JSON Mode (No Progress)

```bash
lgrep index ./my-project --json
```

Output (structured only):
```json
{"indexed":50,"skipped":0,"errors":[],"duration_ms":45231}
```

## Testing

The feature is covered by comprehensive tests in `src/cli/commands/index.test.ts`:

- ✅ Chunk-level progress tracking
- ✅ ETA calculation
- ✅ JSON mode suppression
- ✅ showProgress flag integration

All tests pass and the feature is production-ready.

## Configuration

No additional configuration is needed. The progress indicator:
- Activates automatically when `showProgress` is true (default)
- Respects the current embedding model setting
- Works with all embedding providers (OpenAI, Cohere, Voyage, Ollama)

## Future Enhancements

Potential improvements for future versions:

1. **Parallel file processing**: Track progress across concurrent file operations
2. **Progress bar visualization**: Use a visual progress bar instead of text
3. **Configurable tip timing**: Allow users to configure when/if tips are shown
4. **Network retry tracking**: Show when retries occur during embedding
