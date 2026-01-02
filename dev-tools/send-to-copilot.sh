#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

prompt="$(
  cd "$ROOT_DIR"
  node dev-tools/next-task.js --copy "$@"
)"

if command -v copilot >/dev/null 2>&1; then
  # Pass prompt as flag to seed interactive Copilot session while keeping TTY stdin.
  (
    cd "$ROOT_DIR"
    copilot -i "$prompt"
  )
else
  printf '%s\n' "$prompt"
  printf '\n[info] GitHub Copilot CLI not found in PATH. Prompt printed (and copied if supported).\n' >&2
fi
