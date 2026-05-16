#!/usr/bin/env bash
# Run Codex adversarial review on the current branch diff.
# Usage: codex-adversarial-review.sh [base-branch]
#
# Invoked by /dev workflow Phase 7a in parallel with four Claude
# code-review sub-agents. Brings a non-Claude model (via Codex CLI)
# into the review fan-out to defeat "Claude grading its own homework".
#
# Exits 0 with `::skip::` if the codex CLI is missing or its binary is
# unreachable — adversarial review is best-effort. The four Claude
# reviewers still run.
#
# Output: dev-tools/codex-review-output.md (raw Codex stdout).

set -euo pipefail

BASE="${1:-main}"

if ! command -v codex >/dev/null 2>&1; then
  echo "::skip:: codex CLI not on PATH — install with: brew install --cask codex && codex login"
  exit 0
fi

# Some Homebrew installs leave a dangling symlink at /opt/homebrew/bin/codex.
# Treat that as "missing" too rather than letting the script die mid-pipe.
if ! codex --version >/dev/null 2>&1; then
  echo "::skip:: codex CLI present on PATH but not executable — try: brew reinstall --cask codex"
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

DIFF=$(git diff "origin/${BASE}...HEAD" 2>/dev/null || git diff "${BASE}...HEAD")

# Find the matching design doc for today, if any.
DESIGN_DOC=$(find docs/superpowers/specs -maxdepth 2 -name "$(date +%Y-%m-%d)-*-design.md" -print -quit 2>/dev/null || true)
DESIGN_CONTEXT=""
if [ -n "${DESIGN_DOC:-}" ] && [ -f "$DESIGN_DOC" ]; then
  DESIGN_CONTEXT=$(cat "$DESIGN_DOC")
fi

PROMPT=$(cat <<EOF
You are reviewing code written by Claude Sonnet, deployed into a
multi-tenant restaurant-management React/Supabase app. Find ONE concrete
bug, security issue, or correctness flaw a self-reviewing Claude would
miss.

Be specific: cite file:line and the failure mode. If you genuinely cannot
find a concrete issue, say "No adversarial finding." — do not invent
findings.

Output format (one per finding):
  ::finding:: severity=<critical|major|minor> file=<path> line=<n>
  <one-paragraph description of the bug and the trigger>

Design context:
${DESIGN_CONTEXT:-(none provided)}

---
Diff:
${DIFF}
EOF
)

mkdir -p dev-tools
codex exec "$PROMPT" > dev-tools/codex-review-output.md
echo "Codex adversarial review written to dev-tools/codex-review-output.md"
