#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAST_FILE="$ROOT_DIR/dev-tools/.last_task_id"
STATUS="fixed"
NOTES=()

usage() {
  cat <<'EOF'
Usage: dev-tools/mark-last-task.sh [--status fixed|in_progress|blocked|open] [--note "text"]...

Reads the last dispatched task ID from dev-tools/.last_task_id and marks it via mark-task.js.
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --status) STATUS="$2"; shift 2;;
    --note) NOTES+=("$2"); shift 2;;
    -h|--help) usage;;
    *) usage;;
  esac
done

if [[ ! -f "$LAST_FILE" ]]; then
  echo "[error] No last task id found at $LAST_FILE. Dispatch an item first." >&2
  exit 1
fi

ID="$(cat "$LAST_FILE" | tr -d ' \t\r\n')"
if [[ -z "$ID" ]]; then
  echo "[error] Last task id file is empty." >&2
  exit 1
fi

ARGS=(--id "$ID" --status "$STATUS")
for n in "${NOTES[@]}"; do
  ARGS+=(--note "$n")
done

node "$ROOT_DIR/dev-tools/mark-task.js" "${ARGS[@]}"
