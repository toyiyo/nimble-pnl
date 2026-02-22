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
