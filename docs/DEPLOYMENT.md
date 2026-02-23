# Supabase Deployment

## Automatic Deployment

Merging to `main` triggers automatic deployment of:
- **Database migrations** via `supabase db push`
- **Edge functions** via `supabase functions deploy`

The workflow only triggers when files under `supabase/` or the workflow file itself change. Frontend-only PRs skip the deploy. Use **Manual Re-deploy** below to trigger a deploy for any commit.

The workflow is defined in `.github/workflows/deploy-supabase.yml`.

## Required GitHub Secrets

Set these in **Settings > Secrets and variables > Actions**:

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token | [Supabase Dashboard > Account > Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_DB_PASSWORD` | Production database password | Set during project creation, or reset in Dashboard > Settings > Database |
| `SUPABASE_PROJECT_ID` | Production project reference ID | Dashboard URL: `supabase.com/dashboard/project/<project-id>` |

## Migration Baseline

The production `schema_migrations` table has been synced with all local migration versions (completed Feb 2026 via `scripts/baseline-migrations.sql`). `supabase db push` now correctly skips already-applied migrations and only runs new ones.

If migrations ever get out of sync again, regenerate and run `scripts/baseline-migrations.sql` in the Supabase SQL Editor. The script is non-destructive (insert-only, skips existing entries).

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
- The workflow only runs when `supabase/**` files change. Frontend-only PRs won't trigger it — use **Manual Re-deploy** if needed
- Verify the workflow file exists on `main` branch
- Check that GitHub Actions is enabled for the repository
- Check Settings > Actions > General > Workflow permissions
