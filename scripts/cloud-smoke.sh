#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_PATH="$ROOT_DIR/dist/cli/index.js"

if [[ ! -f "$CLI_PATH" ]]; then
  echo "Built CLI not found at $CLI_PATH"
  echo "Run: npm run build"
  exit 1
fi

CONTAINER_NAME="lgrep-cloud-smoke-$$-$(date +%s)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lgrep-cloud-smoke.XXXXXX")"
TEST_HOME="$TMP_ROOT/lgrep-home"
TEST_USER_HOME="$TMP_ROOT/home"
TEST_PROJECT="$TMP_ROOT/project"
JSON_DIR="$TMP_ROOT/json"
mkdir -p "$TEST_HOME" "$TEST_USER_HOME" "$TEST_PROJECT"
mkdir -p "$JSON_DIR"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
}

trap cleanup EXIT

docker run -d --rm \
  --name "$CONTAINER_NAME" \
  -e DEBIAN_FRONTEND=noninteractive \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=lgrep_cloud \
  -p 127.0.0.1::5432 \
  postgres:15 \
  bash -lc 'apt-get update && apt-get install -y --no-install-recommends postgresql-15-pgvector && export PATH="/usr/lib/postgresql/15/bin:$PATH" && exec docker-entrypoint.sh postgres' \
  >/dev/null

DATABASE_PORT=""
for _ in $(seq 1 120); do
  PORT_LINE="$(docker port "$CONTAINER_NAME" 5432/tcp 2>/dev/null || true)"
  if [[ -n "$PORT_LINE" ]]; then
    DATABASE_PORT="${PORT_LINE##*:}"
  fi

  CONTAINER_LOGS="$(docker logs "$CONTAINER_NAME" 2>&1 || true)"

  if [[ -n "$DATABASE_PORT" ]] && grep -q "database system is ready to accept connections" <<<"$CONTAINER_LOGS"; then
    if docker exec "$CONTAINER_NAME" bash -lc 'export PATH="/usr/lib/postgresql/15/bin:$PATH"; pg_isready -U postgres -d lgrep_cloud' >/dev/null 2>&1; then
      break
    fi
  fi

  sleep 2
done

if [[ -z "$DATABASE_PORT" ]] || ! docker exec "$CONTAINER_NAME" bash -lc 'export PATH="/usr/lib/postgresql/15/bin:$PATH"; pg_isready -U postgres -d lgrep_cloud' >/dev/null 2>&1; then
  echo "Cloud smoke Postgres failed to become ready"
  docker logs "$CONTAINER_NAME" || true
  exit 1
fi

cat > "$TEST_PROJECT/auth.ts" <<'EOF'
export function greetUser(name: string): string {
  return `Hello, ${name}`;
}

export function validateUser(name: string): boolean {
  return name.trim().length > 0;
}
EOF

cat > "$TEST_PROJECT/app.ts" <<'EOF'
import { greetUser, validateUser } from './auth';

export function runApp(name: string): string {
  if (!validateUser(name)) {
    throw new Error('Invalid user');
  }

  return greetUser(name);
}
EOF

DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${DATABASE_PORT}/lgrep_cloud"
COMMON_ENV=(
  env
  "HOME=$TEST_USER_HOME"
  "LGREP_HOME=$TEST_HOME"
  "LGREP_DATABASE_URL=$DATABASE_URL"
  "LGREP_TEST_EMBEDDINGS=1"
)

run_json() {
  "${COMMON_ENV[@]}" node "$CLI_PATH" "$@"
}

run_json init --mode cloud --database-url-env LGREP_DATABASE_URL --integrate none --skip-index --yes --json >"$JSON_DIR/init.json"
python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    payload = json.load(fh)
if not payload.get("success") or payload.get("mode") != "cloud":
    print(payload, file=sys.stderr)
    raise SystemExit(1)
' "$JSON_DIR/init.json"

run_json doctor --json >"$JSON_DIR/doctor.json"
python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    payload = json.load(fh)["data"]
if not payload.get("success"):
    print(payload, file=sys.stderr)
    raise SystemExit(1)
cloud_check = next((check for check in payload.get("checks", []) if check.get("name") == "Cloud database"), None)
if not cloud_check or cloud_check.get("status") != "ok":
    print(payload.get("checks"), file=sys.stderr)
    raise SystemExit(1)
' "$JSON_DIR/doctor.json"

run_json list --json >"$JSON_DIR/list-before.json"
python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    payload = json.load(fh)
if not isinstance(payload.get("indexes"), list) or len(payload["indexes"]) != 0:
    print(payload, file=sys.stderr)
    raise SystemExit(1)
' "$JSON_DIR/list-before.json"

run_json index "$TEST_PROJECT" --name docker-cloud-smoke --json >"$JSON_DIR/index.json"
python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    payload = json.load(fh)
if payload.get("indexed") != 2 or not isinstance(payload.get("errors"), list) or len(payload["errors"]) != 0:
    print(payload, file=sys.stderr)
    raise SystemExit(1)
' "$JSON_DIR/index.json"

run_json list --json >"$JSON_DIR/list-after.json"
python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    payload = json.load(fh)
indexes = payload.get("indexes")
if not isinstance(indexes, list) or len(indexes) != 1 or indexes[0].get("name") != "docker-cloud-smoke":
    print(payload, file=sys.stderr)
    raise SystemExit(1)
' "$JSON_DIR/list-after.json"

run_json search --definition greetUser -i docker-cloud-smoke --json >"$JSON_DIR/definition.json"
python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    payload = json.load(fh)
definitions = payload.get("definitions") or []
if payload.get("count") != 1 or not definitions or not definitions[0].get("file", "").endswith("/auth.ts"):
    print(payload, file=sys.stderr)
    raise SystemExit(1)
' "$JSON_DIR/definition.json"

run_json search --usages greetUser -i docker-cloud-smoke --json >"$JSON_DIR/usages.json"
python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    payload = json.load(fh)
usages = payload.get("usages") or []
if payload.get("count") != 1 or not usages or not usages[0].get("file", "").endswith("/app.ts"):
    print(payload, file=sys.stderr)
    raise SystemExit(1)
' "$JSON_DIR/usages.json"

echo "Cloud smoke passed against Postgres on port $DATABASE_PORT"
