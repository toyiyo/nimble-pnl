#!/usr/bin/env bash
#
# verify-schedule-perf.sh — local-Supabase end-to-end measurement.
# Invoked by /dev Phase 6 (Verify). Captures p95 + max from 5 runs and
# writes a "Perf result" block to .perf-result.md for the PR description.
#
# Timing source: python3 (millisecond resolution).
# Rationale: macOS ships BSD date which does NOT support %N (nanoseconds).
# python3 -c 'import time; print(int(time.time()*1000))' works on every
# macOS version this project supports (10.15+) without requiring GNU coreutils.
#
# Prereqs: npm run db:start && npm run functions:serve in another terminal.
# Requires a known restaurant_id with realistic data. Pass via env var
# PERF_RESTAURANT_ID and a week_start via PERF_WEEK_START.

set -euo pipefail

REST_ID="${PERF_RESTAURANT_ID:-}"
WEEK="${PERF_WEEK_START:-2026-06-08}"
LOCAL_URL="${LOCAL_FUNCTIONS_URL:-http://localhost:54321/functions/v1/generate-schedule}"
RUNS="${PERF_RUNS:-5}"

if [[ -z "$REST_ID" ]]; then
  echo "PERF_RESTAURANT_ID is required (a restaurant with realistic data)." >&2
  exit 1
fi

# Capture an anon JWT for the restaurant; the user manually supplies via SUPABASE_USER_JWT.
if [[ -z "${SUPABASE_USER_JWT:-}" ]]; then
  echo "SUPABASE_USER_JWT is required (token for a user with owner/manager role on \$PERF_RESTAURANT_ID)." >&2
  exit 1
fi

# Verify python3 is available for ms-resolution timing
if ! command -v python3 &>/dev/null; then
  echo "python3 is required for millisecond timing (not found in PATH)." >&2
  exit 1
fi

durations=()
for i in $(seq 1 "$RUNS"); do
  echo "[perf] run $i/$RUNS"
  START_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
  # --fail-with-body: exit non-zero on 4xx/5xx and surface the body so we
  # don't measure error responses as if they were successful runs.
  curl -sS --fail-with-body -X POST "$LOCAL_URL" \
    -H "Authorization: Bearer $SUPABASE_USER_JWT" \
    -H "Content-Type: application/json" \
    -d "{\"restaurant_id\":\"$REST_ID\",\"week_start\":\"$WEEK\",\"locked_shift_ids\":[],\"excluded_employee_ids\":[]}" \
    > /dev/null
  END_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
  ELAPSED_MS=$(( END_MS - START_MS ))
  durations+=("$ELAPSED_MS")
  echo "  ${ELAPSED_MS}ms"
done

# Compute p95 + max. Nearest-rank: ceil(n * 0.95) - 1, clamped to valid range.
# Plain `n * 95 / 100` returned the max for small n (e.g. n=5 → idx 4 = max).
sorted=($(printf '%s\n' "${durations[@]}" | sort -n))
p95_idx=$(( (${#sorted[@]} * 95 + 99) / 100 - 1 ))
if (( p95_idx < 0 )); then p95_idx=0; fi
if (( p95_idx >= ${#sorted[@]} )); then p95_idx=$(( ${#sorted[@]} - 1 )); fi
p95="${sorted[$p95_idx]}"
# Use explicit last-index expression for Bash 3.x portability (macOS default);
# ${arr[-1]} negative-index syntax requires Bash 4.3+.
max="${sorted[${#sorted[@]}-1]}"

cat > .perf-result.md <<EOF
## Perf result (local Supabase, $RUNS runs)

- Sample durations (ms): ${durations[*]}
- **p95: ${p95}ms**
- **max: ${max}ms**
- Target: end-to-end (no-prefs) p95 < 5000ms, max < 10000ms
EOF

echo
cat .perf-result.md

# Fail loudly if we miss the no-prefs target
if (( p95 > 5000 )); then
  echo "PERF MISS — p95 ${p95}ms exceeds 5000ms target" >&2
  exit 2
fi
