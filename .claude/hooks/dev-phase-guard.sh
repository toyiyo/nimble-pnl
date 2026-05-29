#!/bin/bash
# Stop hook: soft guard for the /dev (development-workflow) pipeline.
#
# If a progress.md exists in the current working directory and is NOT marked
# "## Status: Complete" or "Ready for merge", emit a non-blocking systemMessage
# reminding that the workflow may be incomplete before the turn ends.
#
# This is a SOFT warning by design: it always exits 0 and never sets
# continue:false / decision:block, so it can never trap a session. It only
# fires while a /dev task is in flight (progress.md present) — normal chat
# sessions with no progress.md are unaffected.

PROGRESS="progress.md"

# No /dev task in flight (or already cleaned up in Phase 10) -> stay silent.
[ -f "$PROGRESS" ] || exit 0

# Pull the "## Status:" line, lowercase it for matching.
STATUS_LC=$(grep -iE '^##[[:space:]]*Status:' "$PROGRESS" 2>/dev/null | head -1 | tr '[:upper:]' '[:lower:]')

case "$STATUS_LC" in
  *complete*|*"ready for merge"*)
    exit 0 ;;  # Task finished -> no warning.
esac

# Incomplete: emit a non-blocking reminder. Static JSON keeps this dependency-
# free and immune to escaping issues from progress.md contents.
cat <<'JSON'
{"systemMessage": "/dev workflow may be incomplete: progress.md is not marked '## Status: Complete' or 'Ready for merge'. Before treating this task as done, confirm Phase 8 (tests/typecheck/lint/build) and Phase 9d (review-comment triage) actually ran. Ref: .claude/skills/development-workflow.md", "suppressOutput": true}
JSON
exit 0
