#!/bin/bash
# PostToolUse hook: auto-fix lint issues after Edit/Write on TS/TSX files
# Reads tool_input JSON from stdin, extracts file_path, runs eslint --fix

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Exit silently if no file path
[ -z "$FILE_PATH" ] && exit 0

# Only process TypeScript files
case "$FILE_PATH" in
  *.ts|*.tsx)
    npx eslint --fix "$FILE_PATH" 2>/dev/null || true
    ;;
esac

exit 0
