# Focus Backfill Cron Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reschedule the `focus-backfill-sync` pg_cron job with `timeout_milliseconds := 120000` (was 5000).

**Architecture:** One idempotent SQL migration reschedules the cron. One pgTAP file pins the new command text. No TypeScript changes.

**Tech Stack:** PostgreSQL, pg_cron, pg_net, pgTAP.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-01-focus-backfill-cron-timeout-design.md`.
- Keep the schedule `*/5 * * * *`, the URL, the headers, and the body identical to the current job.
- Do not change the `focus-bulk-sync` job.
- Write all prose in STE-aligned English.
- Stage explicit paths only. Never run `git add -A`.

---

### Task 1: Migration + pgTAP test

**Files:**
- Create: `supabase/migrations/20260901120000_focus_backfill_cron_timeout.sql`
- Test: `supabase/tests/52_focus_backfill_cron_timeout.sql`

**Interfaces:**
- Consumes: the `focus-backfill-sync` and `focus-bulk-sync` rows in `cron.job`, created by `supabase/migrations/20260703120000_focus_backfill_reliability.sql` and `supabase/migrations/20260704200320_focus_sync_frequency.sql`.
- Produces: a rescheduled `focus-backfill-sync` job with a 120 s pg_net timeout.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/52_focus_backfill_cron_timeout.sql`:

```sql
-- Tests for the focus-backfill-sync cron timeout raise
-- Migration: 20260901120000_focus_backfill_cron_timeout.sql
--
-- Test plan (6 tests):
--  1  focus-backfill-sync keeps the 5-minute schedule
--  2  focus-backfill-sync uses timeout_milliseconds := 120000
--  3  focus-backfill-sync no longer uses timeout_milliseconds := 5000
--  4  focus-backfill-sync keeps the hardcoded production URL
--  5  focus-bulk-sync keeps timeout_milliseconds := 5000 (unchanged)
--  6  focus-bulk-sync keeps the generate_series fan-out (unchanged)

BEGIN;
SELECT plan(6);

-- Test 1: the schedule is unchanged.
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-backfill-sync'),
  '*/5 * * * *',
  'focus-backfill-sync keeps the 5-minute schedule'
);

-- Test 2: the pg_net timeout now covers a full backfill run (50-90 s observed).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync')
    ILIKE '%timeout_milliseconds := 120000%',
  'focus-backfill-sync uses timeout_milliseconds := 120000'
);

-- Test 3: the old 5 s timeout is gone. It aborted every run and the pg_net
-- retry started a duplicate worker (vendor HTTP 400, cosmetic last_error).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync')
    NOT ILIKE '%timeout_milliseconds := 5000%',
  'focus-backfill-sync no longer uses timeout_milliseconds := 5000'
);

-- Test 4: the hardcoded URL survives the reschedule (GUC URLs no-op on Supabase).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync')
    ILIKE '%https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-backfill-sync%',
  'focus-backfill-sync keeps the hardcoded production URL'
);

-- Test 5: focus-bulk-sync is out of scope and keeps its 5 s timeout.
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync')
    ILIKE '%timeout_milliseconds := 5000%',
  'focus-bulk-sync keeps timeout_milliseconds := 5000'
);

-- Test 6: focus-bulk-sync keeps its intentional generate_series fan-out.
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync')
    ILIKE '%generate_series%',
  'focus-bulk-sync keeps the generate_series fan-out'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run db:reset && npm run test:db`
Expected: FAIL on tests 2 and 3 in file 52 (the job still carries `timeout_milliseconds := 5000`). Tests 1, 4, 5, 6 pass.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260901120000_focus_backfill_cron_timeout.sql`:

```sql
-- =====================================================
-- Raise the focus-backfill-sync cron timeout to 120 s
-- Design: docs/superpowers/specs/2026-09-01-focus-backfill-cron-timeout-design.md
--
-- The 5 s pg_net timeout aborted every backfill run (50-90 s observed).
-- The pg_net retry then started a duplicate edge worker. Two workers
-- requested the same business date; the vendor returned HTTP 400 to one;
-- that worker wrote a cosmetic last_error on the connection row.
-- 120 s covers the slowest observed run and stays below the Supabase
-- request idle timeout (150 s).
--
-- WARNING: cron.unschedule + cron.schedule assigns a new jobid.
-- Key monitoring on jobname = 'focus-backfill-sync', not on the old id 28.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-backfill-sync') THEN
    PERFORM cron.unschedule('focus-backfill-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-backfill-sync',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-backfill-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run db:reset && npm run test:db`
Expected: PASS — all 6 tests in file 52, and no regression in files 48, 49, 51.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260901120000_focus_backfill_cron_timeout.sql supabase/tests/52_focus_backfill_cron_timeout.sql
git commit -m "fix(focus): raise the backfill cron timeout to 120 s"
```
