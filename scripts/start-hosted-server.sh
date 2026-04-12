#!/usr/bin/env bash
set -euo pipefail

: "${LGREP_DATABASE_URL:?LGREP_DATABASE_URL must be set}"

export LGREP_PROFILE="${LGREP_PROFILE:-cloud}"
export LGREP_SERVER_PORT="${PORT:-8420}"

if ! node dist/cli/index.js init \
  --mode cloud \
  --profile "$LGREP_PROFILE" \
  --integrate none \
  --skip-index \
  --yes \
  --database-url-env LGREP_DATABASE_URL \
  >/tmp/lgrep-init.log 2>&1; then
  cat /tmp/lgrep-init.log >&2 || true
  exit 1
fi

cat /tmp/lgrep-init.log

exec node dist/cli/index.js server start --port "$LGREP_SERVER_PORT"
