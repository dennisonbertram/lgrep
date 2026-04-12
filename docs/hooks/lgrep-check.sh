#!/usr/bin/env bash
# lgrep SessionStart hook
# Local mode: clean stale state and start a watcher when useful.
# Cloud mode: verify the hosted query path is reachable and remind agents to use lgrep first.

set -e

CWD=$(pwd)

if ! command -v lgrep >/dev/null 2>&1; then
  exit 0
fi

PROJECT_MARKERS=(
  ".git"
  "package.json"
  "deno.json"
  "Cargo.toml"
  "pyproject.toml"
  "setup.py"
  "requirements.txt"
  "go.mod"
  "Gemfile"
  "pom.xml"
  "build.gradle"
  "build.gradle.kts"
  "composer.json"
  "build.zig"
  "foundry.toml"
  "hardhat.config.js"
  "hardhat.config.ts"
  "truffle-config.js"
  "CMakeLists.txt"
  "Makefile"
  "meson.build"
  "*.csproj"
  "*.sln"
  "Package.swift"
  "mix.exs"
  "build.sbt"
  "deps.edn"
  "stack.yaml"
  "cabal.project"
  "pubspec.yaml"
  "Project.toml"
  "main.tf"
  "flake.nix"
)

is_project_dir() {
  for marker in "${PROJECT_MARKERS[@]}"; do
    if [[ "$marker" == *"*"* ]]; then
      if compgen -G "$CWD/$marker" >/dev/null 2>&1; then
        return 0
      fi
    elif [ -e "$CWD/$marker" ]; then
      return 0
    fi
  done
  return 1
}

STORAGE_MODE=$(lgrep config storageMode 2>/dev/null || echo "local")
SERVER_URL=$(lgrep config serverUrl 2>/dev/null || echo "")

if [ "$STORAGE_MODE" != "local" ]; then
  if [ -n "$SERVER_URL" ]; then
    if lgrep project list --json >/dev/null 2>&1; then
      BRANCH=$(git -C "$CWD" branch --show-current 2>/dev/null || true)
      if [ -n "$BRANCH" ]; then
        echo "🔍 lgrep: Hosted mode ready for branch \"$BRANCH\". Use lgrep before rg; project/worktree auto-detection will be used when possible."
      else
        echo "🔍 lgrep: Hosted mode ready. Use lgrep before rg for repo discovery and context."
      fi
    else
      echo "⚠️  lgrep: Hosted mode is configured but the remote service could not be reached. Run 'lgrep doctor' if hosted reads fail."
    fi
  fi
  exit 0
fi

if ! is_project_dir; then
  exit 0
fi

MAX_CONCURRENT_BUILDING=1
MAX_TOTAL_WATCHERS=3

CLEANED=$(lgrep clean --zombies --failed --json 2>/dev/null | jq -r '.data.deleted // 0' 2>/dev/null || echo "0")
if [ "${CLEANED:-0}" -gt 0 ]; then
  echo "🧹 lgrep: Auto-cleaned $CLEANED stale index(es)"
fi

DOCTOR_OUTPUT=$(lgrep doctor --json 2>/dev/null || echo '{}')
EMBED_STATUS=$(echo "$DOCTOR_OUTPUT" | jq -r '.data.checks[]? | select(.name == "Embedding provider") | .status' 2>/dev/null)

if [ "$EMBED_STATUS" = "error" ] || [ -z "$EMBED_STATUS" ]; then
  echo "⚠️  lgrep: No embedding provider configured. Run 'lgrep init' for guided setup."
  exit 0
fi

INDEXES=$(lgrep list --json 2>/dev/null || echo '{"indexes":[]}')
IS_INDEXED=$(echo "$INDEXES" | jq -r --arg cwd "$CWD" '.indexes[]? | select(.path == $cwd) | .name' 2>/dev/null | head -1)

if [ -n "$IS_INDEXED" ]; then
  exit 0
fi

BUILDING_COUNT=$(echo "$INDEXES" | jq '[.indexes[]? | select(.status == "building")] | length' 2>/dev/null || echo "0")
if [ "$BUILDING_COUNT" -ge "$MAX_CONCURRENT_BUILDING" ]; then
  echo "lgrep: Skipping local startup indexing because $BUILDING_COUNT index(es) are already building."
  exit 0
fi

WATCHER_COUNT=$(echo "$INDEXES" | jq '[.indexes[]? | select(.status == "watching")] | length' 2>/dev/null || echo "0")
if [ "$WATCHER_COUNT" -ge "$MAX_TOTAL_WATCHERS" ]; then
  echo "lgrep: Skipping local startup indexing because $WATCHER_COUNT watcher(s) are already running."
  exit 0
fi

INDEX_NAME=$(basename "$CWD")
NAME_EXISTS=$(echo "$INDEXES" | jq -r --arg name "$INDEX_NAME" '.indexes[]? | select(.name == $name) | .name' 2>/dev/null | head -1)

if [ -n "$NAME_EXISTS" ]; then
  INDEX_NAME="${INDEX_NAME}-$(echo "$CWD" | md5sum | cut -c1-8 2>/dev/null || echo "$CWD" | md5 | cut -c1-8)"
fi

echo "🔍 lgrep: Local mode starting watcher for $(basename "$CWD"). Use lgrep before rg for discovery and context."
lgrep watch "$CWD" --name "$INDEX_NAME" >/dev/null 2>&1 &

exit 0
