#!/bin/sh

# Worktree bootstrap for lgrep development.
# Preferred usage:
#   . ./init.sh

INIT_SH_SOURCED=0
if (return 0 2>/dev/null); then
  INIT_SH_SOURCED=1
fi

init_print() {
  printf 'init.sh: %s\n' "$1"
}

init_fail() {
  printf 'init.sh: %s\n' "$1" >&2
  return 1
}

resolve_dir() {
  target_dir="$1"
  if [ -d "$target_dir" ]; then
    (
      cd "$target_dir" || exit 1
      pwd -P
    )
    return $?
  fi

  (
    cd "$REPO_ROOT/$target_dir" || exit 1
    pwd -P
  )
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    init_fail "Missing required command: $1" || return 1
  fi
}

check_node_version() {
  NODE_VERSION="$(node -p "process.versions.node")" || return 1
  if ! node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 18 || (major === 18 && minor >= 17) ? 0 : 1);" >/dev/null 2>&1; then
    init_fail "Node.js >= 18.17 is required (found $NODE_VERSION)" || return 1
  fi
}

acquire_lock() {
  lock_dir="$1"
  wait_notice_printed=0

  while ! mkdir "$lock_dir" 2>/dev/null; do
    if [ -f "$lock_dir/pid" ]; then
      lock_pid="$(cat "$lock_dir/pid" 2>/dev/null)"
      if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
        rm -rf "$lock_dir"
        continue
      fi
    fi

    if [ "$wait_notice_printed" -eq 0 ]; then
      init_print "Waiting for shared dependency bootstrap lock..."
      wait_notice_printed=1
    fi
    sleep 1
  done

  printf '%s\n' "$$" > "$lock_dir/pid"
}

release_lock() {
  lock_dir="$1"
  if [ -d "$lock_dir" ]; then
    rm -rf "$lock_dir"
  fi
}

is_empty_directory() {
  dir_path="$1"
  if [ ! -d "$dir_path" ]; then
    return 1
  fi
  if find "$dir_path" -mindepth 1 -maxdepth 1 | read -r _; then
    return 1
  fi
  return 0
}

resolve_link_target() {
  link_path="$1"
  link_target="$(readlink "$link_path")" || return 1

  case "$link_target" in
    /*)
      target_path="$link_target"
      ;;
    *)
      target_path="$(dirname "$link_path")/$link_target"
      ;;
  esac

  (
    cd "$target_path" || exit 1
    pwd -P
  )
}

link_node_modules() {
  if [ -L "$REPO_ROOT/node_modules" ]; then
    current_target="$(resolve_link_target "$REPO_ROOT/node_modules" 2>/dev/null || true)"
    if [ -n "$current_target" ] && [ "$current_target" = "$SHARED_NODE_MODULES" ]; then
      return 0
    fi
    rm "$REPO_ROOT/node_modules" || return 1
  elif [ -e "$REPO_ROOT/node_modules" ]; then
    if is_empty_directory "$REPO_ROOT/node_modules"; then
      rmdir "$REPO_ROOT/node_modules" || return 1
    else
      init_print "Keeping existing local node_modules directory at $REPO_ROOT/node_modules"
      return 0
    fi
  fi

  ln -s "$SHARED_NODE_MODULES" "$REPO_ROOT/node_modules" || return 1
}

write_env_file() {
  mkdir -p "$WORKTREE_STATE_DIR" "$LGREP_HOME" || return 1

  cat > "$ENV_FILE" <<EOF
#!/bin/sh
export LGREP_WORKTREE_ROOT="$REPO_ROOT"
export LGREP_HOME="$LGREP_HOME"
case ":\${PATH:-}:" in
  *:"$REPO_ROOT/node_modules/.bin":*)
    ;;
  *)
    export PATH="$REPO_ROOT/node_modules/.bin\${PATH:+:\$PATH}"
    ;;
esac
EOF
}

source_env_file() {
  # shellcheck disable=SC1090
  . "$ENV_FILE" || return 1
}

main() {
  require_command git || return 1
  require_command node || return 1
  require_command npm || return 1

  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    init_fail "Run this from inside the lgrep repository" || return 1
  }
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)" || {
    init_fail "Failed to resolve repository root" || return 1
  }

  GIT_COMMON_DIR_RAW="$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null)" || {
    init_fail "Failed to resolve git common dir" || return 1
  }
  GIT_COMMON_DIR="$(resolve_dir "$GIT_COMMON_DIR_RAW")" || {
    init_fail "Failed to resolve git common dir path" || return 1
  }

  if [ ! -f "$REPO_ROOT/package.json" ] || [ ! -f "$REPO_ROOT/package-lock.json" ]; then
    init_fail "Expected package.json and package-lock.json in $REPO_ROOT" || return 1
  fi

  check_node_version || {
    init_fail "Failed to validate Node.js version" || return 1
  }

  LOCK_HASH="$(node -e "const fs = require('fs'); const crypto = require('crypto'); const data = fs.readFileSync(process.argv[1]); process.stdout.write(crypto.createHash('sha256').update(data).digest('hex').slice(0, 12));" "$REPO_ROOT/package-lock.json")" || {
    init_fail "Failed to hash package-lock.json" || return 1
  }
  PLATFORM_KEY="$(node -p "process.platform + '-' + process.arch + '-node-' + process.versions.node")" || {
    init_fail "Failed to determine platform key" || return 1
  }

  SHARED_BASE="$GIT_COMMON_DIR/.lgrep-dev"
  INSTALL_KEY="$PLATFORM_KEY-$LOCK_HASH"
  SHARED_INSTALL_ROOT="$SHARED_BASE/npm/$INSTALL_KEY"
  SHARED_NODE_MODULES="$SHARED_INSTALL_ROOT/node_modules"
  WORKTREE_STATE_DIR="$REPO_ROOT/.worktree"
  LGREP_HOME="$WORKTREE_STATE_DIR/lgrep"
  ENV_FILE="$WORKTREE_STATE_DIR/env.sh"

  sync_shared_install || {
    init_fail "Shared npm bootstrap failed" || return 1
  }
  link_node_modules || {
    init_fail "Failed to prepare node_modules for this worktree" || return 1
  }
  write_env_file || {
    init_fail "Failed to write $ENV_FILE" || return 1
  }

  if [ "$INIT_SH_SOURCED" -eq 1 ]; then
    source_env_file || {
      init_fail "Failed to source $ENV_FILE" || return 1
    }
    init_print "Ready"
    init_print "LGREP_HOME=$LGREP_HOME"
    init_print "shared_node_modules=$SHARED_NODE_MODULES"
  else
    init_print "Environment prepared, but this shell was not updated because init.sh was executed instead of sourced."
    init_print "Run:"
    init_print "  . \"$ENV_FILE\""
  fi
}

sync_shared_install() {
  mkdir -p "$SHARED_BASE/npm" "$SHARED_BASE/npm-cache" "$SHARED_BASE/locks" || return 1

  LOCK_DIR="$SHARED_BASE/locks/$INSTALL_KEY.lock"
  acquire_lock "$LOCK_DIR" || return 1

  if [ ! -f "$SHARED_INSTALL_ROOT/.ready" ] || [ ! -d "$SHARED_NODE_MODULES" ]; then
    rm -rf "$SHARED_INSTALL_ROOT" || {
      release_lock "$LOCK_DIR"
      return 1
    }
    mkdir -p "$SHARED_INSTALL_ROOT" || {
      release_lock "$LOCK_DIR"
      return 1
    }

    cp "$REPO_ROOT/package.json" "$SHARED_INSTALL_ROOT/package.json" || {
      release_lock "$LOCK_DIR"
      return 1
    }
    cp "$REPO_ROOT/package-lock.json" "$SHARED_INSTALL_ROOT/package-lock.json" || {
      release_lock "$LOCK_DIR"
      return 1
    }
    if [ -f "$REPO_ROOT/.npmrc" ]; then
      cp "$REPO_ROOT/.npmrc" "$SHARED_INSTALL_ROOT/.npmrc" || {
        release_lock "$LOCK_DIR"
        return 1
      }
    fi

    init_print "Installing shared npm dependencies for $INSTALL_KEY"
    if ! npm ci \
      --prefix "$SHARED_INSTALL_ROOT" \
      --cache "$SHARED_BASE/npm-cache" \
      --legacy-peer-deps \
      --no-audit \
      --fund=false
    then
      release_lock "$LOCK_DIR"
      return 1
    fi

    printf '%s\n' "$INSTALL_KEY" > "$SHARED_INSTALL_ROOT/.ready" || {
      release_lock "$LOCK_DIR"
      return 1
    }
  fi

  release_lock "$LOCK_DIR"
}

main "$@" || {
  if [ "$INIT_SH_SOURCED" -eq 1 ]; then
    return 1
  fi
  exit 1
}
