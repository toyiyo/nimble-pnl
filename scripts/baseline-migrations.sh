#!/usr/bin/env bash
set -euo pipefail

# Baseline Migration Script
# -------------------------
# One-time script to sync production's schema_migrations table
# with all local migration files. Run this BEFORE enabling the
# deploy pipeline so that `supabase db push` only runs new migrations.
#
# Prerequisites:
#   - psql installed (PostgreSQL client)
#   - SUPABASE_DB_URL env var set to your production database URL
#     Format: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
#     (Find this in Dashboard > Settings > Database > Connection string > URI)
#
# Usage:
#   export SUPABASE_DB_URL="postgresql://postgres.ncdujvdgqtaunuyigflp:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
#   bash scripts/baseline-migrations.sh

MIGRATIONS_DIR="supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: $MIGRATIONS_DIR not found. Run from project root."
  exit 1
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL env var is not set."
  echo "Set it to your production database connection string."
  echo "Find it in: Dashboard > Settings > Database > Connection string > URI"
  exit 1
fi

# Verify psql is available
if ! command -v psql &>/dev/null; then
  echo "ERROR: psql not found. Install PostgreSQL client first."
  echo "  macOS: brew install libpq"
  echo "  Ubuntu: sudo apt-get install postgresql-client"
  exit 1
fi

echo "=== Supabase Migration Baseline ==="
echo ""

# Step 1: Collect local migration versions (timestamp prefix before first underscore)
echo "Scanning local migrations..."
shopt -s nullglob
LOCAL_VERSIONS=()
for file in "$MIGRATIONS_DIR"/*.sql; do
  basename=$(basename "$file")
  version="${basename%%_*}"
  LOCAL_VERSIONS+=("$version")
done
shopt -u nullglob

if [ ${#LOCAL_VERSIONS[@]} -eq 0 ]; then
  echo "ERROR: No .sql migration files found in $MIGRATIONS_DIR"
  exit 1
fi
echo "Found ${#LOCAL_VERSIONS[@]} local migrations."

# Step 2: Get remote migration versions
echo "Fetching remote migration history..."
REMOTE_VERSIONS=$(psql "$SUPABASE_DB_URL" -t -A -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;" 2>/dev/null || true)

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
  psql "$SUPABASE_DB_URL" -c "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('$version') ON CONFLICT DO NOTHING;"
done

# Step 6: Verify
echo ""
echo "Verifying..."
FINAL_COUNT=$(psql "$SUPABASE_DB_URL" -t -A -c "SELECT COUNT(*) FROM supabase_migrations.schema_migrations;" 2>/dev/null || true)

if [ -z "$FINAL_COUNT" ] || ! [[ "$FINAL_COUNT" =~ ^[0-9]+$ ]]; then
  echo "WARNING: Could not retrieve final remote count. Verify the migration state manually."
  exit 1
fi

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
