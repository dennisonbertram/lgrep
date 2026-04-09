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
mkdir -p "$TEST_HOME" "$TEST_USER_HOME" "$TEST_PROJECT"

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

  if [[ -n "$DATABASE_PORT" ]] && docker logs "$CONTAINER_NAME" 2>&1 | grep -q "database system is ready to accept connections"; then
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

INIT_JSON="$(run_json init --mode cloud --database-url-env LGREP_DATABASE_URL --integrate none --skip-index --yes --json)"
node --input-type=module -e '
  const payload = JSON.parse(process.argv[1]);
  if (!payload.success || payload.mode !== "cloud") {
    console.error(payload);
    process.exit(1);
  }
' "$INIT_JSON"

DOCTOR_JSON="$(run_json doctor --json)"
node --input-type=module -e '
  const payload = JSON.parse(process.argv[1]).data;
  if (!payload.success) {
    console.error(payload);
    process.exit(1);
  }
  const cloudCheck = payload.checks.find((check) => check.name === "Cloud database");
  if (!cloudCheck || cloudCheck.status !== "ok") {
    console.error(payload.checks);
    process.exit(1);
  }
' "$DOCTOR_JSON"

LIST_BEFORE_JSON="$(run_json list --json)"
node --input-type=module -e '
  const payload = JSON.parse(process.argv[1]);
  if (!Array.isArray(payload.indexes) || payload.indexes.length !== 0) {
    console.error(payload);
    process.exit(1);
  }
' "$LIST_BEFORE_JSON"

INDEX_JSON="$(run_json index "$TEST_PROJECT" --name docker-cloud-smoke --json)"
node --input-type=module -e '
  const payload = JSON.parse(process.argv[1]);
  if (payload.indexed !== 2 || !Array.isArray(payload.errors) || payload.errors.length !== 0) {
    console.error(payload);
    process.exit(1);
  }
' "$INDEX_JSON"

LIST_AFTER_JSON="$(run_json list --json)"
node --input-type=module -e '
  const payload = JSON.parse(process.argv[1]);
  if (!Array.isArray(payload.indexes) || payload.indexes.length !== 1 || payload.indexes[0].name !== "docker-cloud-smoke") {
    console.error(payload);
    process.exit(1);
  }
' "$LIST_AFTER_JSON"

DEFINITION_JSON="$(run_json search --definition greetUser -i docker-cloud-smoke --json)"
node --input-type=module -e '
  const payload = JSON.parse(process.argv[1]);
  if (payload.count !== 1 || !payload.definitions?.[0]?.file?.endsWith("/auth.ts")) {
    console.error(payload);
    process.exit(1);
  }
' "$DEFINITION_JSON"

USAGES_JSON="$(run_json search --usages greetUser -i docker-cloud-smoke --json)"
node --input-type=module -e '
  const payload = JSON.parse(process.argv[1]);
  if (payload.count !== 1 || !payload.usages?.[0]?.file?.endsWith("/app.ts")) {
    console.error(payload);
    process.exit(1);
  }
' "$USAGES_JSON"

echo "Cloud smoke passed against Postgres on port $DATABASE_PORT"
