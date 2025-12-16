#!/usr/bin/env bash
# lgrep SessionStart hook
# Auto-starts watcher for current directory if not already running

set -e

# Get current directory from stdin (passed by Claude Code)
CWD=$(pwd)

# Check if lgrep is installed
if ! command -v lgrep &> /dev/null; then
  # Silent exit - lgrep not installed
  exit 0
fi

# Get list of watchers
WATCHERS=$(lgrep list --json 2>/dev/null || echo '{"indexes":[]}')

# Check if current directory is already being watched
IS_WATCHING=$(echo "$WATCHERS" | jq -r --arg cwd "$CWD" '.indexes[] | select(.path == $cwd) | .name' | head -1)

if [ -n "$IS_WATCHING" ]; then
  # Already watching this directory
  exit 0
fi

# Derive index name from directory
INDEX_NAME=$(basename "$CWD")

# Check if index name already exists (watching a different path)
NAME_EXISTS=$(echo "$WATCHERS" | jq -r --arg name "$INDEX_NAME" '.indexes[] | select(.name == $name) | .name' | head -1)

if [ -n "$NAME_EXISTS" ]; then
  # Name collision - use path-based name
  INDEX_NAME="${INDEX_NAME}-$(echo "$CWD" | md5sum | cut -c1-8)"
fi

# Start watcher (silently)
lgrep watch "$CWD" --name "$INDEX_NAME" --json &> /dev/null || true

exit 0
