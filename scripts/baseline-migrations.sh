#!/usr/bin/env bash
set -euo pipefail

# Baseline Migration Script
# -------------------------
# One-time script to sync production's schema_migrations table
# with all local migration files. Run this BEFORE enabling the
# deploy pipeline so that `supabase db push` only runs new migrations.
#
# Prerequisites:
#   - SUPABASE_ACCESS_TOKEN env var set
#   - SUPABASE_DB_PASSWORD env var set
#   - Supabase CLI installed and linked to production project
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=your_token
#   export SUPABASE_DB_PASSWORD=your_password
#   supabase link --project-ref ncdujvdgqtaunuyigflp
#   bash scripts/baseline-migrations.sh

MIGRATIONS_DIR="supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: $MIGRATIONS_DIR not found. Run from project root."
  exit 1
fi

echo "=== Supabase Migration Baseline ==="
echo ""

# Step 1: Collect local migration versions (timestamp prefix before first underscore)
echo "Scanning local migrations..."
LOCAL_VERSIONS=()
for file in "$MIGRATIONS_DIR"/*.sql; do
  basename=$(basename "$file")
  version="${basename%%_*}"
  LOCAL_VERSIONS+=("$version")
done
echo "Found ${#LOCAL_VERSIONS[@]} local migrations."

# Step 2: Get remote migration versions
echo "Fetching remote migration history..."
REMOTE_VERSIONS=$(supabase db execute --sql "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;" 2>/dev/null | grep -E '^\s*[0-9]+' | tr -d ' ' || true)

if [ -z "$REMOTE_VERSIONS" ]; then
  echo "WARNING: No remote migrations found (empty schema_migrations table)."
  REMOTE_COUNT=0
else
  REMOTE_COUNT=$(echo "$REMOTE_VERSIONS" | wc -l | tr -d ' ')
fi
echo "Found $REMOTE_COUNT remote migrations."

# Step 3: Find missing versions
MISSING=()
for version in "${LOCAL_VERSIONS[@]}"; do
  if ! echo "$REMOTE_VERSIONS" | grep -qx "$version"; then
    MISSING+=("$version")
  fi
done

echo ""
echo "Missing from remote: ${#MISSING[@]} migrations."

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "Nothing to do. Remote is already in sync."
  exit 0
fi

# Step 4: Confirm before inserting
echo ""
echo "The following versions will be inserted into schema_migrations:"
for v in "${MISSING[@]}"; do
  echo "  - $v"
done
echo ""
read -p "Proceed? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

# Step 5: Insert missing versions
echo ""
echo "Inserting missing migrations..."
for version in "${MISSING[@]}"; do
  echo "  Inserting $version..."
  supabase db execute --sql "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('$version') ON CONFLICT DO NOTHING;"
done

# Step 6: Verify
echo ""
echo "Verifying..."
FINAL_COUNT=$(supabase db execute --sql "SELECT COUNT(*) FROM supabase_migrations.schema_migrations;" 2>/dev/null | grep -E '^\s*[0-9]+' | tr -d ' ')
echo "Remote migration count: $FINAL_COUNT"
echo "Local migration count: ${#LOCAL_VERSIONS[@]}"

if [ "$FINAL_COUNT" -eq "${#LOCAL_VERSIONS[@]}" ]; then
  echo ""
  echo "SUCCESS: Migration history is now in sync."
else
  echo ""
  echo "WARNING: Counts don't match. Check for migrations in remote that don't exist locally."
  echo "Remote has $FINAL_COUNT, local has ${#LOCAL_VERSIONS[@]}."
fi
