#!/usr/bin/env bash
# lgrep SessionEnd hook
# Stops the watcher for current directory when Claude exits
# Does NOT stop if actively indexing (building status)

set -e

# Get current directory
CWD=$(pwd)

# Check if lgrep is installed
if ! command -v lgrep &> /dev/null; then
  exit 0
fi

# Get list of indexes
INDEXES=$(lgrep list --json 2>/dev/null || echo '{"indexes":[]}')

# Find watcher for current directory that is in "watching" status (not "building")
WATCHER_NAME=$(echo "$INDEXES" | jq -r --arg cwd "$CWD" '
  .indexes[]? |
  select(.path == $cwd and .status == "watching") |
  .name
' 2>/dev/null | head -1)

if [ -n "$WATCHER_NAME" ]; then
  # Stop the watcher
  lgrep stop "$WATCHER_NAME" &> /dev/null || true
  echo "lgrep: Stopped watcher for $(basename "$CWD")"
fi

exit 0
