#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

prompt="$(
  cd "$ROOT_DIR"
  TARGET_NAME=CODEX node dev-tools/next-task.js --copy "$@"
)"

if command -v codex >/dev/null 2>&1; then
  # Pass prompt as positional arg to keep TTY stdin.
  codex "$prompt"
else
  printf '%s\n' "$prompt"
  printf '\n[info] Codex CLI not found in PATH. Prompt printed (and copied if supported).\n' >&2
fi
