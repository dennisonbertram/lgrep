#!/usr/bin/env bash
# lgrep SessionStart hook
# Auto-starts watcher for current directory if not already running
# Resource-aware: limits concurrent indexing
# Auto-cleans zombies and failed indexes on startup

set -e

# Get current directory
CWD=$(pwd)

# === RESOURCE LIMITS ===
MAX_CONCURRENT_BUILDING=1  # Only allow 1 index to build at a time
MAX_TOTAL_WATCHERS=3       # Maximum total watchers running

# === AUTO-CLEANUP ON STARTUP ===
# Clean zombies and failed indexes silently
if command -v lgrep &> /dev/null; then
  CLEANED=$(lgrep clean --zombies --failed --json 2>/dev/null | jq -r '.data.deleted // 0' 2>/dev/null || echo "0")
  if [ "$CLEANED" -gt 0 ]; then
    echo "🧹 lgrep: Auto-cleaned $CLEANED stale index(es)"
  fi
fi

# Only index if this looks like a project (has common project markers)
PROJECT_MARKERS=(
  # Version control
  ".git"
  # JavaScript/TypeScript
  "package.json"
  "deno.json"
  # Rust
  "Cargo.toml"
  # Python
  "pyproject.toml"
  "setup.py"
  "requirements.txt"
  # Go
  "go.mod"
  # Ruby
  "Gemfile"
  # Java/Kotlin
  "pom.xml"
  "build.gradle"
  "build.gradle.kts"
  # PHP
  "composer.json"
  # Zig
  "build.zig"
  # Solidity/Foundry/Hardhat
  "foundry.toml"
  "hardhat.config.js"
  "hardhat.config.ts"
  "truffle-config.js"
  # C/C++
  "CMakeLists.txt"
  "Makefile"
  "meson.build"
  # .NET
  "*.csproj"
  "*.sln"
  # Swift
  "Package.swift"
  # Elixir
  "mix.exs"
  # Scala
  "build.sbt"
  # Clojure
  "deps.edn"
  # Haskell
  "stack.yaml"
  "cabal.project"
  # Dart/Flutter
  "pubspec.yaml"
  # Julia
  "Project.toml"
  # Terraform
  "main.tf"
  # Nix
  "flake.nix"
)

IS_PROJECT=false
for marker in "${PROJECT_MARKERS[@]}"; do
  if [[ "$marker" == *"*"* ]]; then
    # Glob pattern - use compgen
    if compgen -G "$CWD/$marker" > /dev/null 2>&1; then
      IS_PROJECT=true
      break
    fi
  elif [ -e "$CWD/$marker" ]; then
    IS_PROJECT=true
    break
  fi
done

if [ "$IS_PROJECT" = false ]; then
  exit 0
fi

# Check if lgrep is installed
if ! command -v lgrep &> /dev/null; then
  exit 0
fi

# Check if embedding provider is configured
DOCTOR_OUTPUT=$(lgrep doctor --json 2>/dev/null || echo '{}')
EMBED_STATUS=$(echo "$DOCTOR_OUTPUT" | jq -r '.data.checks[]? | select(.name == "Embedding provider") | .status' 2>/dev/null)

if [ "$EMBED_STATUS" = "error" ] || [ -z "$EMBED_STATUS" ]; then
  echo "⚠️  lgrep: No embedding provider configured. Run 'lgrep doctor' for details."
  echo "   Set OPENAI_API_KEY or run 'lgrep setup' for local Ollama."
  exit 0
fi

# Get list of indexes
INDEXES=$(lgrep list --json 2>/dev/null || echo '{"indexes":[]}')

# Check if current directory is already indexed or has active watcher
IS_INDEXED=$(echo "$INDEXES" | jq -r --arg cwd "$CWD" '.indexes[]? | select(.path == $cwd) | .name' 2>/dev/null | head -1)

if [ -n "$IS_INDEXED" ]; then
  # Already indexed
  exit 0
fi

# === RESOURCE CHECKS ===
# Count currently building indexes
BUILDING_COUNT=$(echo "$INDEXES" | jq '[.indexes[]? | select(.status == "building")] | length' 2>/dev/null || echo "0")

if [ "$BUILDING_COUNT" -ge "$MAX_CONCURRENT_BUILDING" ]; then
  echo "lgrep: Skipping - $BUILDING_COUNT index(es) already building (limit: $MAX_CONCURRENT_BUILDING)"
  exit 0
fi

# Count active watchers
WATCHER_COUNT=$(echo "$INDEXES" | jq '[.indexes[]? | select(.status == "watching")] | length' 2>/dev/null || echo "0")

if [ "$WATCHER_COUNT" -ge "$MAX_TOTAL_WATCHERS" ]; then
  echo "lgrep: Skipping - $WATCHER_COUNT watcher(s) already running (limit: $MAX_TOTAL_WATCHERS)"
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
