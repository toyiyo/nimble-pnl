#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

prompt="$(
  cd "$ROOT_DIR"
  TARGET_NAME=CLAUDE node dev-tools/next-task.js --copy "$@"
)"

# Check for Claude CLI in multiple possible locations
if command -v claude >/dev/null 2>&1; then
  # Pass prompt as positional arg to keep TTY stdin.
  claude "$prompt"
elif [ -x "$HOME/.local/bin/claude" ]; then
  # User's local bin (found on this system)
  "$HOME/.local/bin/claude" "$prompt"
elif [ -x "/usr/local/bin/claude" ]; then
  # Common Homebrew location on macOS
  /usr/local/bin/claude "$prompt"
elif [ -x "/opt/homebrew/bin/claude" ]; then
  # Apple Silicon Homebrew location
  /opt/homebrew/bin/claude "$prompt"
else
  printf '%s\n' "$prompt"
  printf '\n[info] Claude CLI not found in PATH or common installation locations.\n' >&2
  printf '       Prompt printed above (and copied if supported).\n' >&2
  printf '       Try: brew install claude\n' >&2
  printf '       Or check: which claude\n' >&2
fi