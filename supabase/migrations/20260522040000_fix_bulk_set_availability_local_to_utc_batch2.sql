-- Production hotfix #2: a second bulk-set batch landed AFTER PR #509 merged,
-- because a user submitted the BulkSetAvailabilitySheet from a browser tab
-- whose JS bundle predated the fix. Same corruption pattern as the original
-- batch (see 20260522000000_fix_bulk_set_availability_local_to_utc.sql) —
-- restaurant-local wall-clock times were written into UTC TIME columns.
--
-- This migration converts the second batch (140 rows, restaurant
-- 7c0c76e3-e770-401b-a2a9-c1edd407efed, created at 2026-05-22 02:34:28.820209+00)
-- using each row's created_at date as the DST anchor — identical SQL pattern
-- to the prior fix so behavior is consistent.
--
-- Dry-run verification (before applying):
--   10:00:00-22:30:00  → 15:00:00-03:30:00   (80 rows, 10a-10:30p CDT)
--   10:00:00-23:30:00  → 15:00:00-04:30:00   (60 rows, 10a-11:30p CDT)
--
-- Scope is intentionally narrow (single restaurant + exact transaction
-- timestamp + value-shape guard) so the migration is idempotent: replaying
-- it cannot touch already-corrected rows. Supabase only runs each migration
-- once, but the value guard prevents corruption if someone manually re-runs
-- the file in psql.
--
-- Value-shape guard: real UTC-stored 10am-10:30p Chicago shifts have
-- start_time >= 15:00 (CDT) or 16:00 (CST). The bad pattern is
-- start_time < 14:00 AND end_time >= 17:00 (both look like raw local).

BEGIN;

UPDATE employee_availability ea
SET
  start_time = (
    (
      (ea.created_at::date::timestamp + ea.start_time)
      AT TIME ZONE r.timezone
    ) AT TIME ZONE 'UTC'
  )::time,
  end_time = (
    (
      (ea.created_at::date::timestamp + ea.end_time)
      AT TIME ZONE r.timezone
    ) AT TIME ZONE 'UTC'
  )::time
FROM restaurants r
WHERE ea.restaurant_id = r.id
  AND ea.restaurant_id = '7c0c76e3-e770-401b-a2a9-c1edd407efed'
  AND ea.created_at = '2026-05-22 02:34:28.820209+00'::timestamptz
  AND ea.is_available = true
  AND r.timezone IS NOT NULL
  AND r.timezone <> 'UTC'
  -- value-shape guard: only rows that still look like raw local input
  AND ea.start_time >= '06:00:00'::time
  AND ea.start_time <  '14:00:00'::time
  AND ea.end_time   >= '17:00:00'::time;

COMMIT;
