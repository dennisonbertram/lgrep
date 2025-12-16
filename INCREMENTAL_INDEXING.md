# Incremental Indexing Feature

## Overview

Implemented incremental indexing for the lgrep CLI to skip unchanged files during reindexing via content hash comparison. This significantly improves reindexing performance by only re-embedding files that have changed.

## Implementation

### Storage Layer (`src/storage/lance.ts`)

Added three new functions to support incremental indexing:

1. **`getFileContentHashes(db, handle)`**
   - Returns a Map of `filePath -> contentHash` for all files in the index
   - Used to compare current file states against indexed file states
   - Efficiently queries only file_path and content_hash columns

2. **`getChunksByFilePath(db, handle, filePath)`**
   - Retrieves all chunks for a specific file path
   - Returns chunks ordered by chunk index
   - Used for verification and debugging

3. **`deleteChunksByFilePath(db, handle, filePath)`**
   - Deletes all chunks associated with a specific file path
   - Returns the number of chunks deleted
   - Used when files are modified or deleted

### Index Command (`src/cli/commands/index.ts`)

Enhanced the `runIndexCommand` function with:

#### New Options
- `mode?: 'create' | 'update'` - Controls indexing behavior
  - `'create'` (default): Create new index, fails if index exists
  - `'update'`: Update existing index, fails if index doesn't exist

#### New Result Fields
- `filesSkipped`: Number of files with unchanged content hash
- `filesUpdated`: Number of files with modified content
- `filesAdded`: Number of new files added to index
- `filesDeleted`: Number of files removed from index

#### Incremental Logic

1. **On Update Mode**:
   - Load existing index and retrieve all file content hashes
   - Walk current files in directory
   - For each file:
     - Compute current content hash
     - Compare with stored hash
     - If unchanged: skip processing
     - If changed: delete old chunks, process new chunks
     - If new: process chunks
   - After processing, detect deleted files and remove their chunks

2. **Stats Tracking**:
   - Accurately tracks skipped, updated, added, and deleted files
   - Reports new chunks created
   - Shows detailed summary in success message

## Usage

### Initial Indexing
```bash
lgrep index /path/to/directory --name my-index
```

### Reindexing (Update Mode)
```bash
lgrep index /path/to/directory --name my-index --mode update
```

## Performance Benefits

- **Skip unchanged files**: No re-reading, re-chunking, or re-embedding for unchanged files
- **Hash-based comparison**: Fast SHA-256 hash comparison before processing
- **Selective updates**: Only processes files that actually changed
- **Deletion detection**: Automatically removes chunks for deleted files

## Test Coverage

### Storage Layer Tests (`src/storage/lance-incremental.test.ts`)
- 9 tests covering all three new storage functions
- Tests empty indexes, single files, multiple chunks per file
- Validates hash retrieval, chunk queries, and deletion operations

### Index Command Tests (`src/cli/commands/index-incremental.test.ts`)
- 11 tests covering incremental indexing scenarios:
  - Unchanged files are skipped
  - Changed files are re-indexed
  - New files are added
  - Deleted files are removed
  - Mixed operations (all scenarios in one reindex)
  - Mode parameter validation

### Integration Test (`src/cli/commands/index-integration.test.ts`)
- End-to-end workflow demonstration:
  1. Initial index of 3 files
  2. Reindex with no changes (all skipped)
  3. Modify 1 file, add 1 file, delete 1 file
  4. Reindex shows correct stats
  5. Reindex again (all skipped)

## Test Results

All 63 indexing-related tests pass:
- `src/storage/lance-incremental.test.ts`: 9 tests
- `src/cli/commands/index-incremental.test.ts`: 11 tests
- `src/cli/commands/index-integration.test.ts`: 1 test
- `src/cli/commands/index.test.ts`: 11 tests (backward compatibility)
- `src/storage/lance.test.ts`: 31 tests (backward compatibility)

## Files Modified

1. **`src/storage/lance.ts`**
   - Added `getFileContentHashes()` function
   - Added `getChunksByFilePath()` function
   - Added `deleteChunksByFilePath()` function

2. **`src/cli/commands/index.ts`**
   - Updated `IndexOptions` interface with `mode` field
   - Updated `IndexResult` interface with stats fields
   - Enhanced `runIndexCommand()` with incremental logic

## Files Created

1. **`src/storage/lance-incremental.test.ts`**
   - Tests for new storage layer functions

2. **`src/cli/commands/index-incremental.test.ts`**
   - Tests for incremental indexing command behavior

3. **`src/cli/commands/index-integration.test.ts`**
   - End-to-end integration test

4. **`INCREMENTAL_INDEXING.md`** (this file)
   - Feature documentation

## Example Output

### First Index
```
✓ Indexed 100 files (450 chunks) as "my-project"
```

### Reindex with No Changes
```
✓ Updated "my-project": 100 unchanged (0 new chunks)
```

### Reindex with Changes
```
✓ Updated "my-project": 95 unchanged, 3 updated, 2 added, 1 deleted (12 new chunks)
```

## Technical Notes

- Content hashes use SHA-256 for reliable change detection
- Hash comparison is done before file reading to minimize I/O
- Chunks are deleted before new ones are added to maintain consistency
- LanceDB delete operations use SQL-style predicates with proper escaping
- All operations maintain index metadata consistency
