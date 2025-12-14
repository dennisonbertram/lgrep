# JSON Output Guide

## Quick Start

Add the `--json` or `-j` flag to any mgrep command to get machine-readable JSON output.

```bash
# Search with JSON output
mgrep search "query" --index my-index --json

# Index with JSON output
mgrep index ./src --name my-index -j

# List indexes as JSON
mgrep list -j

# Delete index with JSON
mgrep delete my-index --json

# Get config as JSON
mgrep config -j
```

## Use Cases

### Scripting and Automation

Parse search results programmatically:

```bash
#!/bin/bash
RESULTS=$(mgrep search "TODO" --index myproject --json)
COUNT=$(echo "$RESULTS" | jq '.count')

if [ "$COUNT" -gt 0 ]; then
  echo "Found $COUNT TODOs"
  echo "$RESULTS" | jq -r '.results[].file' | sort | uniq
fi
```

### CI/CD Integration

Check for prohibited patterns:

```bash
# Find hardcoded credentials
mgrep search "password" --index src --json | \
  jq '.results[] | select(.score > 0.8) | .file' | \
  while read file; do
    echo "::error file=$file::Possible hardcoded credential"
  done
```

### Data Analysis

Export search results for analysis:

```bash
# Search and save to file
mgrep search "deprecated" --index codebase --json > deprecated.json

# Analyze with jq
cat deprecated.json | jq '[.results[] | {file: .file, line: .line, score: .score}]'
```

### Monitoring and Alerts

Track index status:

```bash
# Get index stats
INDEXES=$(mgrep list --json)
CHUNK_COUNT=$(echo "$INDEXES" | jq '[.indexes[].chunks] | add')

if [ "$CHUNK_COUNT" -lt 100 ]; then
  echo "Warning: Index may be incomplete"
fi
```

## JSON Schemas

### Search Results

```json
{
  "results": [
    {
      "file": "src/auth.ts",
      "chunk": "function authenticate(user, pass) { ... }",
      "score": 0.95,
      "line": 42
    }
  ],
  "query": "authentication",
  "count": 1
}
```

**Fields:**
- `results`: Array of matching chunks
- `query`: Original search query
- `count`: Number of results

**Result item fields:**
- `file`: Relative file path
- `chunk`: Content of the matching chunk
- `score`: Similarity score (0.0 to 1.0, higher is better)
- `line`: Starting line number

### Index Output

```json
{
  "indexed": 150,
  "skipped": 5,
  "errors": [],
  "duration_ms": 0
}
```

**Fields:**
- `indexed`: Number of files processed
- `skipped`: Number of files skipped
- `errors`: Array of error messages
- `duration_ms`: Processing duration (future)

### List Output

```json
{
  "indexes": [
    {
      "name": "my-project",
      "files": 150,
      "chunks": 847,
      "created": "2024-12-14T10:00:00.000Z"
    }
  ]
}
```

**Fields:**
- `indexes`: Array of index metadata
- `name`: Index name
- `files`: Number of files (currently 0)
- `chunks`: Number of indexed chunks
- `created`: ISO 8601 timestamp

### Delete Output

```json
{
  "deleted": "my-project",
  "success": true
}
```

**Fields:**
- `deleted`: Name of deleted index
- `success`: Boolean success indicator

### Config Output

```json
{
  "config": {
    "model": "mxbai-embed-large",
    "chunkSize": 512,
    "chunkOverlap": 50,
    "maxFileSize": 1048576,
    "excludes": "node_modules, .git",
    "secretExcludes": ".env, *.key"
  }
}
```

**Fields:**
- `config`: Object with all configuration values

### Error Output

```json
{
  "error": "Index \"my-project\" not found",
  "code": "NOT_FOUND"
}
```

**Fields:**
- `error`: Human-readable error message
- `code`: Machine-readable error code

**Error Codes:**
- `COMMAND_ERROR`: Generic command execution error
- `NOT_FOUND`: Resource (index, config key) not found
- `PATH_ERROR`: File or directory path does not exist
- `VALIDATION_ERROR`: Invalid input parameters

## Processing JSON Output

### Using jq

```bash
# Extract file paths from search results
mgrep search "bug" -i project --json | jq -r '.results[].file'

# Get top 3 results by score
mgrep search "important" -i project --json | \
  jq '.results | sort_by(-.score) | .[0:3]'

# Count results by file
mgrep search "function" -i project --json | \
  jq -r '.results[].file' | sort | uniq -c

# Filter by score threshold
mgrep search "critical" -i project --json | \
  jq '.results[] | select(.score > 0.8)'
```

### Using Python

```python
import json
import subprocess

# Run mgrep and parse JSON
result = subprocess.run(
    ['mgrep', 'search', 'TODO', '--index', 'src', '--json'],
    capture_output=True,
    text=True
)

data = json.loads(result.stdout)

# Process results
for item in data['results']:
    if item['score'] > 0.7:
        print(f"{item['file']}:{item['line']} - {item['chunk'][:50]}")
```

### Using Node.js

```javascript
const { execSync } = require('child_process');

// Run mgrep and parse JSON
const output = execSync(
  'mgrep search "async" --index myproject --json',
  { encoding: 'utf8' }
);

const data = JSON.parse(output);

// Group by file
const byFile = data.results.reduce((acc, item) => {
  acc[item.file] = acc[item.file] || [];
  acc[item.file].push(item);
  return acc;
}, {});

console.log(`Found ${data.count} results in ${Object.keys(byFile).length} files`);
```

## Exit Codes

Both JSON and text modes use the same exit codes:

- `0`: Success
- `1`: Error (see JSON `error` field or stderr for details)

## Best Practices

1. **Always parse the output**: Don't assume fixed positions or formats
2. **Check exit code**: Exit code 0 guarantees valid JSON output
3. **Handle empty results**: `results` array may be empty for searches
4. **Score interpretation**: Scores are relative; adjust thresholds per use case
5. **Error handling**: Always check for `error` field in JSON responses

## Combining with Other Tools

### Grep and JSON

```bash
# Find files with high-scoring matches
mgrep search "deprecated" -i project --json | \
  jq -r '.results[] | select(.score > 0.9) | .file' | \
  xargs grep -n "deprecated"
```

### Git and JSON

```bash
# Find recently modified files with specific content
RECENT=$(git diff --name-only HEAD~5)
mgrep search "refactor" -i project --json | \
  jq -r '.results[].file' | \
  grep -F "$RECENT"
```

### Watch and JSON

```bash
# Monitor index size
watch -n 60 'mgrep list --json | jq ".indexes[] | {name, chunks}"'
```

## Troubleshooting

### Invalid JSON Error

If you get "Unexpected token" errors:
1. Check exit code (`echo $?`)
2. Run without `--json` flag to see error message
3. Verify command syntax

### Empty Results

```json
{"results": [], "query": "...", "count": 0}
```

This is valid - no matches found. Not an error.

### Missing Fields

All schemas include required fields. If parsing fails:
1. Update mgrep to latest version
2. Check if using correct schema for command
3. Report as bug if fields are actually missing
