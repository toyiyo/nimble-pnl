# Supabase Deploy Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically deploy Supabase migrations and edge functions to production when merging to main.

**Architecture:** A single GitHub Actions workflow (`deploy-supabase.yml`) triggers on push to main. It uses the Supabase CLI to sequentially push migrations then deploy all edge functions. A one-time baseline script syncs the migration history table before the pipeline goes live.

**Tech Stack:** GitHub Actions, Supabase CLI v2.65.5, Bash

---

### Task 1: Create the Deploy Workflow

**Files:**
- Create: `.github/workflows/deploy-supabase.yml`

**Step 1: Create the workflow file**

```yaml
name: Deploy Supabase

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: 2.65.5

      - name: Link Supabase project
        run: supabase link --project-ref ncdujvdgqtaunuyigflp
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}

      - name: Push database migrations
        run: supabase db push
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}

      - name: Deploy edge functions
        run: supabase functions deploy
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Deployment summary
        if: success()
        run: |
          echo "## Deployment Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "- **Commit:** ${{ github.sha }}" >> $GITHUB_STEP_SUMMARY
          echo "- **Branch:** ${{ github.ref_name }}" >> $GITHUB_STEP_SUMMARY
          echo "- **Migrations:** Pushed successfully" >> $GITHUB_STEP_SUMMARY
          echo "- **Edge Functions:** Deployed successfully" >> $GITHUB_STEP_SUMMARY
```

**Step 2: Validate the YAML syntax locally**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-supabase.yml'))"`
Expected: No output (valid YAML)

If python yaml module not available, use: `npx yaml-lint .github/workflows/deploy-supabase.yml` or just visually inspect.

**Step 3: Commit**

```bash
git add .github/workflows/deploy-supabase.yml
git commit -m "ci: add Supabase production deploy workflow"
```

---

### Task 2: Create the Baseline Migration Script

This is a one-time script the user runs before enabling the pipeline. It reads all local migration filenames, compares against what's in production's `schema_migrations` table, and inserts any missing entries.

**Files:**
- Create: `scripts/baseline-migrations.sh`

**Step 1: Create the baseline script**

```bash
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
```

**Step 2: Make the script executable**

Run: `chmod +x scripts/baseline-migrations.sh`

**Step 3: Commit**

```bash
git add scripts/baseline-migrations.sh
git commit -m "ci: add one-time migration baseline script"
```

---

### Task 3: Add GitHub Secrets Documentation

Update the project README or create a deploy doc so secrets setup is documented.

**Files:**
- Create: `docs/DEPLOYMENT.md`

**Step 1: Create deployment documentation**

```markdown
# Supabase Deployment

## Automatic Deployment

Merging to `main` triggers automatic deployment of:
- **Database migrations** via `supabase db push`
- **Edge functions** via `supabase functions deploy`

The workflow is defined in `.github/workflows/deploy-supabase.yml`.

## Required GitHub Secrets

Set these in **Settings > Secrets and variables > Actions**:

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token | [Supabase Dashboard > Account > Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_DB_PASSWORD` | Production database password | Set during project creation, or reset in Dashboard > Settings > Database |

## First-Time Setup (Baseline)

Before the pipeline can run, you must sync the migration history table:

1. Install the Supabase CLI: `npm i -g supabase`
2. Set environment variables:
   ```bash
   export SUPABASE_ACCESS_TOKEN=your_token
   export SUPABASE_DB_PASSWORD=your_password
   ```
3. Link to production: `supabase link --project-ref ncdujvdgqtaunuyigflp`
4. Run the baseline script: `bash scripts/baseline-migrations.sh`
5. Verify: The script will confirm the migration count matches.

After this, add the GitHub secrets and the pipeline is live.

## Manual Re-deploy

If a deploy fails and you've fixed the issue (or it was transient):

1. Go to **Actions > Deploy Supabase** in GitHub
2. Click **Run workflow** > select `main` branch > **Run workflow**

## Edge Function Secrets

Function environment variables (API keys, etc.) are NOT deployed by this pipeline. Manage them via:
- **Dashboard:** Project > Edge Functions > Select function > Secrets
- **CLI:** `supabase secrets set KEY=value --project-ref ncdujvdgqtaunuyigflp`

## Troubleshooting

### Migration fails
- Check the GitHub Actions log for the specific SQL error
- Fix the migration locally, commit, and merge to main (will re-trigger deploy)
- If a migration was partially applied, you may need to manually fix the production DB

### Function deploy fails
- Usually a TypeScript compilation error
- Check the Actions log for the function name and error
- Fix locally, commit, and merge (or use manual re-deploy)

### Pipeline not triggering
- Verify the workflow file exists on `main` branch
- Check that GitHub Actions is enabled for the repository
- Check Settings > Actions > General > Workflow permissions
```

**Step 2: Commit**

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: add Supabase deployment guide"
```

---

### Task 4: Final Verification

**Step 1: Review all created files**

Run: `ls -la .github/workflows/deploy-supabase.yml scripts/baseline-migrations.sh docs/DEPLOYMENT.md`
Expected: All three files exist.

**Step 2: Validate workflow YAML**

Run: `npx action-validator .github/workflows/deploy-supabase.yml 2>/dev/null || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-supabase.yml')); print('Valid YAML')"`

**Step 3: Validate bash script syntax**

Run: `bash -n scripts/baseline-migrations.sh && echo "Valid bash"`
Expected: "Valid bash"

**Step 4: Review git log**

Run: `git log --oneline -5`
Expected: 3 new commits (workflow, baseline script, docs)
