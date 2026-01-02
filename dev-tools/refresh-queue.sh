#!/usr/bin/env bash

# Aggregate review feedback into dev-tools/review_queue.json in one command.
# Requires: node, git, and optionally gh (for PR comments) and curl (for Sonar).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Load optional .env.local for shared configuration (ignored by git via *.local).
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  source "$ROOT_DIR/.env.local"
  set +a
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

PR_NUMBER=""
SONAR_HOST="${SONAR_HOST:-}"
SONAR_TOKEN="${SONAR_TOKEN:-}"
# Fallback to SONAR_PROJECT if SONAR_PROJECT_KEY is not set; both may be unset.
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-${SONAR_PROJECT:-}}"
LINT_CMD="${LINT_CMD:-npm run lint -- --format json}"
TEST_CMD="${TEST_CMD:-}"
DEFAULT_TESTS=()
SKIP_GH=0
SKIP_SONAR=0
SKIP_PROBLEMS=0
SKIP_TESTS=0
SONAR_BRANCH=""
SONAR_EXTRA=""

usage() {
  cat <<'EOF'
Usage: dev-tools/refresh-queue.sh [--pr 123] [--skip-gh] [--skip-sonar] [--skip-problems] [--tests "npm test"] [--lint-cmd "npm run lint -- --format json"]

Env vars:
  SONAR_HOST, SONAR_TOKEN, SONAR_PROJECT_KEY (or SONAR_PROJECT) for Sonar ingest.
  LINT_CMD can override the problems command (default: npm run lint -- --format json).
  TEST_CMD can run a test command that outputs JSON; use {out} placeholder for output path (e.g., "npm test -- --reporter=json --outputFile {out}").
  SONAR_BRANCH can be set to override branch queries; SONAR_EXTRA can append query params.

Examples:
  dev-tools/refresh-queue.sh --pr 45 --tests "npm run lint" --tests "npm test"
  SKIP_SONAR=1 dev-tools/refresh-queue.sh --pr 45
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) PR_NUMBER="$2"; shift 2;;
    --skip-gh) SKIP_GH=1; shift;;
    --skip-sonar) SKIP_SONAR=1; shift;;
    --skip-problems) SKIP_PROBLEMS=1; shift;;
    --skip-tests) SKIP_TESTS=1; shift;;
    --tests) DEFAULT_TESTS+=("$2"); shift 2;;
    --lint-cmd) LINT_CMD="$2"; shift 2;;
    --test-cmd) TEST_CMD="$2"; shift 2;;
    --sonar-branch) SONAR_BRANCH="$2"; shift 2;;
    --sonar-extra) SONAR_EXTRA="$2"; shift 2;;
    -h|--help) usage;;
    *) usage;;
  esac
done

if [[ $SKIP_GH -eq 0 && -z "$PR_NUMBER" ]]; then
  echo "[error] --pr is required unless --skip-gh is set." >&2
  exit 1
fi

owner_repo() {
  local url
  url="$(git -C "$ROOT_DIR" config --get remote.origin.url || true)"
  url="${url%.git}"
  url="${url#*github.com[:/]}"
  echo "$url"
}

OWNER_REPO="$(owner_repo)"
if [[ -z "$OWNER_REPO" && $SKIP_GH -eq 0 ]]; then
  echo "[error] Could not derive owner/repo from git remote. Use --skip-gh or set git remote." >&2
  exit 1
fi

GH_FILE_REVIEWS="$TMP_DIR/github-comments-reviews.json"
GH_FILE_ISSUES="$TMP_DIR/github-comments-issues.json"
SONAR_FILE="$TMP_DIR/sonar.json"
PROB_FILE="$TMP_DIR/problems.json"
TEST_FILE="$TMP_DIR/tests.json"

if [[ $SKIP_GH -eq 0 ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "[warn] gh not found; skipping GitHub ingest." >&2
  else
    echo "[info] Fetching PR comments for $OWNER_REPO PR #$PR_NUMBER ..."
    gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/comments" --paginate > "$GH_FILE_REVIEWS"
    gh api "repos/$OWNER_REPO/issues/$PR_NUMBER/comments" --paginate > "$GH_FILE_ISSUES"
  fi
fi

if [[ $SKIP_SONAR -eq 0 ]]; then
  if [[ -z "$SONAR_HOST" || -z "$SONAR_TOKEN" || -z "$SONAR_PROJECT_KEY" ]]; then
    echo "[warn] SONAR_HOST/SONAR_TOKEN/SONAR_PROJECT_KEY not set; skipping Sonar ingest." >&2
    SKIP_SONAR=1
  elif ! command -v curl >/dev/null 2>&1; then
    echo "[warn] curl not found; skipping Sonar ingest." >&2
    SKIP_SONAR=1
  else
    echo "[info] Fetching Sonar issues for project $SONAR_PROJECT_KEY ..."
    query="componentKeys=$SONAR_PROJECT_KEY&statuses=OPEN,REOPENED"
    if [[ -n "$PR_NUMBER" ]]; then
      query="$query&pullRequest=$PR_NUMBER"
    elif [[ -n "$SONAR_BRANCH" ]]; then
      query="$query&branch=$SONAR_BRANCH"
    fi
    if [[ -n "$SONAR_EXTRA" ]]; then
      query="$query&$SONAR_EXTRA"
    fi
    curl -sS -u "$SONAR_TOKEN:" \
      "$SONAR_HOST/api/issues/search?$query" \
      -o "$SONAR_FILE"
  fi
fi

if [[ $SKIP_PROBLEMS -eq 0 ]]; then
  echo "[info] Running problems command: $LINT_CMD"
  if ! bash -lc "$LINT_CMD" >"$PROB_FILE"; then
    echo "[warn] Problems command returned non-zero; will ingest output if present." >&2
  fi
  [[ -s "$PROB_FILE" ]] || { echo "[warn] No problems output captured; skipping problems ingest." >&2; SKIP_PROBLEMS=1; }
fi

if [[ $SKIP_TESTS -eq 0 && -n "$TEST_CMD" ]]; then
  cmd="${TEST_CMD//\{out\}/$TEST_FILE}"
  echo "[info] Running test command: $cmd"
  if ! bash -lc "$cmd"; then
    echo "[warn] Test command returned non-zero; will ingest output if present." >&2
  fi
  [[ -s "$TEST_FILE" ]] || { echo "[warn] No test JSON captured; skipping test ingest." >&2; SKIP_TESTS=1; }
fi

INGEST_ARGS=()
[[ $SKIP_GH -eq 0 && -s "$GH_FILE_REVIEWS" ]] && INGEST_ARGS+=(--gh "$GH_FILE_REVIEWS")
[[ $SKIP_GH -eq 0 && -s "$GH_FILE_ISSUES" ]] && INGEST_ARGS+=(--gh "$GH_FILE_ISSUES")
[[ $SKIP_SONAR -eq 0 && -s "$SONAR_FILE" ]] && INGEST_ARGS+=(--sonar "$SONAR_FILE")
[[ $SKIP_PROBLEMS -eq 0 && -s "$PROB_FILE" ]] && INGEST_ARGS+=(--problems "$PROB_FILE")
[[ $SKIP_TESTS -eq 0 && -s "$TEST_FILE" ]] && INGEST_ARGS+=(--tests-json "$TEST_FILE")
[[ -n "$PR_NUMBER" ]] && INGEST_ARGS+=(--pr "$PR_NUMBER")
if [[ ${#DEFAULT_TESTS[@]-0} -gt 0 ]]; then
  for t in "${DEFAULT_TESTS[@]}"; do
    INGEST_ARGS+=(--tests "$t")
  done
fi

if [[ ${#INGEST_ARGS[@]} -eq 0 ]]; then
  echo "[warn] Nothing to ingest (all sources skipped or empty)." >&2
  exit 0
fi

echo "[info] Ingesting into queue..."
(cd "$ROOT_DIR" && node dev-tools/ingest-feedback.js "${INGEST_ARGS[@]}")

echo "[done] Queue refreshed."
