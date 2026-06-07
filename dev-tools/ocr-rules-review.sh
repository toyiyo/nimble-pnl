#!/usr/bin/env bash
# Deterministic, $0, no-LLM half of the ocr-rules reviewer.
#
# Produces a "REVIEW BRIEF" on stdout with three sections:
#   (1) Changed files list
#   (2) Deduped ocr rule packs matched to those files
#   (3) Unified diff of the changes
#
# Usage:
#   ocr-rules-review.sh [BASE_REF]
#
#   With BASE_REF  : reviews git diff BASE_REF...HEAD (branch diff).
#   Without BASE_REF: reviews the working tree (staged + unstaged + untracked).
#
# This script is the deterministic, $0, no-LLM half of the ocr-rules reviewer.
# The LLM step that consumes this output lives in .claude/agents/ocr-rules-reviewer.md.
#
# Graceful degradation: if `ocr` is not on PATH, prints Changed files + Diff
# sections with a fallback header and exits 0. Never hard-fails on missing ocr.
#
# Compatible with bash 3.2+ (macOS default) — no associative arrays used.

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

BASE_REF="${1:-}"

# ── 1. Collect changed files and diff ──────────────────────────────────────────

if [ -n "$BASE_REF" ]; then
  CHANGED_FILES=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || git diff --name-only "${BASE_REF}..HEAD" 2>/dev/null || true)
  DIFF=$(git diff "${BASE_REF}...HEAD" 2>/dev/null || git diff "${BASE_REF}..HEAD" 2>/dev/null || true)
else
  # Working tree: staged + unstaged modifications, plus untracked files.
  CHANGED_FILES=$(
    {
      git diff --name-only 2>/dev/null || true
      git diff --name-only --cached 2>/dev/null || true
      git ls-files --others --exclude-standard 2>/dev/null || true
    } | sort -u
  )
  DIFF=$(git diff 2>/dev/null || true)
  # Include staged changes in the diff.
  STAGED_DIFF=$(git diff --cached 2>/dev/null || true)
  if [ -n "$STAGED_DIFF" ]; then
    DIFF="${DIFF}
${STAGED_DIFF}"
  fi
fi

# ── 2. Print section 1: Changed files ─────────────────────────────────────────

echo "## Changed files"
echo ""
if [ -z "$CHANGED_FILES" ]; then
  echo "(no changed files)"
else
  while IFS= read -r f; do
    [ -n "$f" ] && echo "- $f"
  done <<< "$CHANGED_FILES"
fi
echo ""

# ── 3. Collect and dedupe ocr rule packs ──────────────────────────────────────

OCR_OK=false
if command -v ocr >/dev/null 2>&1; then
  # Smoke-test: make sure the binary actually runs.
  if ocr --version >/dev/null 2>&1; then
    OCR_OK=true
  fi
fi

echo "## ocr rule packs (deduped)"
echo ""

if [ "$OCR_OK" = "false" ]; then
  echo "(ocr unavailable — apply CLAUDE.md conventions)"
else
  # Dedupe by Pattern: header using a temp file for seen-set (bash 3.2 compatible).
  SEEN_FILE=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$SEEN_FILE'" EXIT

  FOUND_ANY=false

  while IFS= read -r file; do
    [ -z "$file" ] && continue
    # ocr rules check may fail on non-existent (deleted) files — skip gracefully.
    RAW_OUTPUT=$(ocr rules check "$file" 2>/dev/null || true)
    [ -z "$RAW_OUTPUT" ] && continue

    # Extract the Pattern: line (e.g. "Pattern: **/*.{ts,js,tsx,jsx}")
    PATTERN=$(printf '%s\n' "$RAW_OUTPUT" | grep '^Pattern:' | head -1 || true)
    [ -z "$PATTERN" ] && PATTERN="Pattern: (unknown)"

    # Check if we've seen this pattern before (grep returns 0 if found, 1 if not).
    if ! grep -qxF "$PATTERN" "$SEEN_FILE" 2>/dev/null; then
      printf '%s\n' "$PATTERN" >> "$SEEN_FILE"
      FOUND_ANY=true

      echo "### $PATTERN"
      echo ""
      # Print the Rule block: everything between the separator lines.
      IN_RULE=false
      while IFS= read -r line; do
        if [[ "$line" == "────"* ]]; then
          if [ "$IN_RULE" = "false" ]; then
            IN_RULE=true
          else
            IN_RULE=false
          fi
          continue
        fi
        if [ "$IN_RULE" = "true" ]; then
          echo "$line"
        fi
      done <<< "$RAW_OUTPUT"
      echo ""
    fi
  done <<< "$CHANGED_FILES"

  if [ "$FOUND_ANY" = "false" ]; then
    echo "(no rule packs matched — no changed files or ocr returned no output)"
  fi
fi

echo ""

# ── 4. Print section 3: Diff ──────────────────────────────────────────────────

echo "## Diff"
echo ""
if [ -z "$DIFF" ]; then
  echo "(no diff)"
else
  printf '%s\n' "$DIFF"
fi
