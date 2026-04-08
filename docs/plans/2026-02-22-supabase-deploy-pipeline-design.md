# Supabase Production Deploy Pipeline — Design

## Problem

Supabase branching doesn't work correctly because migrations have been out of sync. Migrations, edge functions, and other changes are deployed manually via the Supabase dashboard UI. This is error-prone and slow.

## Goal

After merging a PR to `main`, automatically deploy all Supabase artifacts (migrations + edge functions) to production. The pipeline must fail fast on errors and make failures visible.

## Approach

Single GitHub Actions workflow (`deploy-supabase.yml`) that triggers on push to `main`. Uses the Supabase CLI to push migrations and deploy functions sequentially.

## Design

### Workflow: `.github/workflows/deploy-supabase.yml`

**Triggers:**
- `push` to `main` (fires on PR merge)
- `workflow_dispatch` (manual re-run for failed deploys)

**GitHub Secrets Required:**
- `SUPABASE_ACCESS_TOKEN` — Supabase personal/service access token
- `SUPABASE_DB_PASSWORD` — production database password

**Project ID:** `ncdujvdgqtaunuyigflp` (hardcoded, not secret)

**Job: `deploy`**

Steps (sequential, fail-fast):

1. **Checkout** — `actions/checkout@v4`
2. **Setup Supabase CLI** — `supabase/setup-cli@v1` pinned to v2.65.5
3. **Link project** — `supabase link --project-ref <project-id>` using access token and DB password
4. **Push migrations** — `supabase db push` applies pending migrations. Skips already-applied ones via the `schema_migrations` table. Exits non-zero on any SQL error, stopping the pipeline.
5. **Deploy edge functions** — `supabase functions deploy` deploys all 75 functions. Exits non-zero if any function fails.

### Failure Handling

- Each step fails the entire workflow on error (default GitHub Actions behavior with `set -e`)
- If migrations fail, functions are NOT deployed (sequential dependency)
- GitHub sends email notifications on workflow failure (default behavior)
- Failed deploys can be re-triggered via `workflow_dispatch` without re-merging
- The commit SHA and workflow run URL are visible in the GitHub UI for debugging

### One-Time Baseline

Before enabling the pipeline, run a baseline script to sync production's `supabase_migrations.schema_migrations` table with all 357 existing migration files. This ensures `db push` only runs truly new migrations.

Script approach:
1. List all migration version timestamps from `supabase/migrations/` filenames
2. Query production `schema_migrations` table for existing entries
3. Insert any missing versions (marking them as already applied)
4. Verify count matches

This is a manual one-time operation run before the pipeline goes live.

### Edge Function Environment Variables

Function secrets/env vars are NOT managed by this pipeline. They are set via the Supabase dashboard or `supabase secrets set`. This is intentional — secrets should not be in git or CI logs.

### What This Does NOT Do

- No staging environment (can be added later)
- No approval gate (PR review is the quality gate)
- No config.toml deployment (auth/storage settings stay manual)
- No rollback automation (manual via dashboard or revert PR)
- No selective function deployment (deploys all 75 every time for consistency)

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `.github/workflows/deploy-supabase.yml` | Create | Deploy workflow |
| `scripts/baseline-migrations.sh` | Create | One-time baseline script |

## Success Criteria

- Merging a PR to `main` triggers automatic migration push and function deploy
- Any migration or function error stops the pipeline and is visible in GitHub Actions
- GitHub sends failure notifications
- Manual re-trigger via `workflow_dispatch` works without re-merging
