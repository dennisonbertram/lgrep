#!/usr/bin/env bash
# lgrep SessionStart hook
# Auto-starts a local watcher only when the active profile uses local storage

set -e

# Get current directory
CWD=$(pwd)

# Check if lgrep is installed
if ! command -v lgrep &> /dev/null; then
  exit 0
fi

# Cloud profiles use the shared remote index; do not auto-start local watchers.
STORAGE_MODE=$(lgrep config storageMode 2>/dev/null || echo "local")
if [ "$STORAGE_MODE" != "local" ]; then
  exit 0
fi

# Check if embedding provider is configured
DOCTOR_OUTPUT=$(lgrep doctor --json 2>/dev/null || echo '{}')
EMBED_STATUS=$(echo "$DOCTOR_OUTPUT" | jq -r '.data.checks[]? | select(.name == "Embedding provider") | .status' 2>/dev/null)

if [ "$EMBED_STATUS" = "error" ] || [ -z "$EMBED_STATUS" ]; then
  echo "⚠️  lgrep: No embedding provider configured. Run 'lgrep init' for guided setup."
  exit 0
fi

# Get list of indexes
INDEXES=$(lgrep list --json 2>/dev/null || echo '{"indexes":[]}')

# Check if current directory is already indexed
IS_INDEXED=$(echo "$INDEXES" | jq -r --arg cwd "$CWD" '.indexes[]? | select(.path == $cwd) | .name' 2>/dev/null | head -1)

if [ -n "$IS_INDEXED" ]; then
  # Already indexed
  exit 0
fi

# Derive index name from directory
INDEX_NAME=$(basename "$CWD")

# Check if index name already exists (for a different path)
NAME_EXISTS=$(echo "$INDEXES" | jq -r --arg name "$INDEX_NAME" '.indexes[]? | select(.name == $name) | .name' 2>/dev/null | head -1)

if [ -n "$NAME_EXISTS" ]; then
  # Name collision - use path-based name
  INDEX_NAME="${INDEX_NAME}-$(echo "$CWD" | md5sum | cut -c1-8 2>/dev/null || echo "$CWD" | md5 | cut -c1-8)"
fi

# Start watcher in background
echo "🔍 lgrep: Starting index for $(basename "$CWD")..."
lgrep watch "$CWD" --name "$INDEX_NAME" &> /dev/null &

exit 0
