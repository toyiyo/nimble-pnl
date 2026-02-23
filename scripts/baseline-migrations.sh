#!/usr/bin/env bash
set -euo pipefail

# Baseline Migration Script
# -------------------------
# One-time script to register all local migration versions in production's
# schema_migrations table. Non-destructive: only inserts missing versions.
#
# This does NOT run any SQL migrations — it only tells Supabase which
# migrations are already applied so `supabase db push` skips them.
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
#
# Alternative: Run scripts/baseline-migrations.sql directly in the Supabase SQL Editor.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/baseline-migrations.sql"

if [ ! -f "$SQL_FILE" ]; then
  echo "ERROR: $SQL_FILE not found."
  exit 1
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL env var is not set."
  echo "Set it to your production database connection string."
  echo "Find it in: Dashboard > Settings > Database > Connection string > URI"
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql not found. Install PostgreSQL client first."
  echo "  macOS: brew install libpq"
  echo "  Ubuntu: sudo apt-get install postgresql-client"
  exit 1
fi

echo "=== Supabase Migration Baseline ==="
echo ""
echo "This will register all local migration versions in production's schema_migrations table."
echo "Non-destructive: only inserts missing versions, leaves existing entries intact."
echo ""
read -p "Proceed? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "Running baseline SQL..."
psql "$SUPABASE_DB_URL" -f "$SQL_FILE"

echo ""
echo "Done. Run 'supabase migration list' to verify all versions are tracked."
