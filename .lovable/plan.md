

## Clean up weekly_brief_failure items and remove the dead-letter INSERT

### Problem
The `process_weekly_brief_queue()` function's dead-letter logic inserts noisy `weekly_brief_failure` items into `ops_inbox_item`. These are not useful to surface in the Ops Inbox -- the failure is already logged in `weekly_brief_job_log`.

### Changes

**1. Delete existing `weekly_brief_failure` rows (data cleanup)**
Run a DELETE to remove all existing rows with `kind = 'weekly_brief_failure'` from `ops_inbox_item`.

**2. Migration: Remove the dead-letter INSERT from `process_weekly_brief_queue()`**
Update the function to simply mark the job as `'failed'` in `weekly_brief_job_log` (which it already does) without also inserting into `ops_inbox_item`. The INSERT block and surrounding IF will be removed.

**3. Migration: Remove `weekly_brief_failure` from the kind check constraint**
Revert the constraint back to the original five allowed values since nothing will insert that kind anymore.

**4. Update TypeScript types**
Remove `weekly_brief_failure` from the generated types to keep them in sync.

### Risk
Low -- only removes an unwanted side-effect. Failure tracking remains in `weekly_brief_job_log`.

