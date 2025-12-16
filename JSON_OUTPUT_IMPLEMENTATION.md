# JSON Output Flag Implementation

## Overview
Added `--json` (short form: `-j`) flag to all lgrep CLI commands for machine-readable output.

## Implementation Summary

### Files Modified
1. **src/cli/commands/json-formatter.ts** (NEW)
   - Core JSON formatting logic
   - Type-safe output schemas for each command
   - Error formatting with error codes

2. **src/cli/commands/index.ts**
   - Added `json?: boolean` to `IndexOptions`
   - No output changes needed (returns structured data)

3. **src/cli/commands/search.ts**
   - Added `json?: boolean` to `SearchOptions`
   - No output changes needed (returns structured data)

4. **src/cli/commands/list.ts**
   - Added `json` parameter
   - Conditionally formats output as JSON

5. **src/cli/commands/delete.ts**
   - Added `json?: boolean` to `DeleteOptions`
   - Conditionally formats output as JSON

6. **src/cli/commands/config.ts**
   - Added `json` parameter
   - Conditionally formats output as JSON

7. **src/cli/index.ts**
   - Added `-j, --json` option to all commands
   - Wrapped outputs with `formatAsJson()` when flag is present
   - JSON-formatted errors when flag is present

### Test Files Created
1. **src/cli/commands/json-output.test.ts** (21 tests)
   - JSON formatter unit tests
   - Schema validation tests
   - Error handling tests

2. **src/cli/commands/json-flag-integration.test.ts** (15 tests)
   - Integration tests for all commands
   - Validates flag acceptance
   - Validates JSON output content

3. **src/cli/commands/json-cli-e2e.test.ts** (3 tests)
   - End-to-end workflow tests
   - Cross-command consistency tests

## JSON Schemas

### Search Command
```json
{
  "results": [
    {
      "file": "relative/path/to/file.ts",
      "chunk": "content of the chunk",
      "score": 0.95,
      "line": 10
    }
  ],
  "query": "search query",
  "count": 1
}
```

### Index Command
```json
{
  "indexed": 10,
  "skipped": 0,
  "errors": [],
  "duration_ms": 0
}
```

### List Command
```json
{
  "indexes": [
    {
      "name": "index-name",
      "files": 0,
      "chunks": 10,
      "created": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Delete Command
```json
{
  "deleted": "index-name",
  "success": true
}
```

### Config Command
```json
{
  "config": {
    "model": "mxbai-embed-large",
    "chunkSize": 512,
    "chunkOverlap": 50
  }
}
```

### Error Format
```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

Error codes:
- `COMMAND_ERROR` - Generic command error
- `NOT_FOUND` - Resource not found
- `PATH_ERROR` - Path does not exist
- `VALIDATION_ERROR` - Invalid input

## Usage Examples

### Search with JSON output
```bash
lgrep search "authentication" --index my-project --json
lgrep search "database" -i my-project -j  # short form
```

### Index with JSON output
```bash
lgrep index ./src --name my-project --json
lgrep index ./src -n my-project -j  # short form
```

### List with JSON output
```bash
lgrep list --json
lgrep list -j  # short form
```

### Delete with JSON output
```bash
lgrep delete my-project --json
lgrep delete my-project -j  # short form
```

### Config with JSON output
```bash
lgrep config --json
lgrep config model --json
lgrep config model new-model --json
```

## Behavior

### When `--json` flag is present:
1. All output goes to stdout as valid JSON
2. No progress spinners or colored output
3. Errors are formatted as JSON with error codes
4. Exit codes remain meaningful (0 = success, 1 = error)

### When `--json` flag is absent:
1. Human-readable text output
2. Progress indicators shown
3. Colored output (if terminal supports it)
4. Standard error messages

## Test Results

All tests pass:
- **21 tests** - JSON formatter unit tests
- **15 tests** - Flag integration tests
- **3 tests** - End-to-end workflow tests

Total: **39 tests** for JSON output functionality

## TDD Compliance

This implementation followed strict Test-Driven Development:

1. **RED**: Wrote failing tests first
   - Created comprehensive test suite before implementation
   - Tests initially failed because modules didn't exist

2. **GREEN**: Implemented minimal code to pass tests
   - Created `json-formatter.ts` module
   - Updated command functions to accept `json` flag
   - Wired up CLI to use JSON formatting

3. **VERIFY**: All tests pass
   - 100% of JSON-related tests passing
   - No regression in existing functionality
   - Type-safe implementation

## Notes

- JSON output is always valid and parseable with `JSON.parse()`
- Special characters in strings are properly escaped
- Number types are preserved (not stringified)
- Arrays and booleans maintain correct types
- No emoji or special formatting in JSON mode
- Consistent schema across all commands
