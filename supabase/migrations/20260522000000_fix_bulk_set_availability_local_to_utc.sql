-- Production hotfix: bulk-set employee_availability rows from 2026-05-22
-- were saved as restaurant-local wall-clock times, but every reader on this
-- column (AvailabilityDialog, TeamAvailabilityGrid, EmployeePortal,
-- generate-schedule edge function) interprets start_time / end_time as UTC.
-- Result: a Chicago restaurant storing 10:00-22:30 (intended local) renders
-- back as 05:00-17:30 CDT and the scheduler skips required slots.
--
-- This migration converts the 140 broken rows in restaurant
-- 7c0c76e3-e770-401b-a2a9-c1edd407efed (America/Chicago, 20 employees) from
-- local wall-clock to UTC, anchored to each row's created_at date so the DST
-- offset matches what the writer would have produced.
--
-- Forward-only writer fix lives in src/lib/availabilityTimeUtils.ts and is
-- called by BulkSetAvailabilitySheet + EmployeeDialog in the same release.
--
-- Scope is intentionally narrow (single restaurant + exact transaction
-- timestamp) so the migration is idempotent in practice: there are no other
-- rows that match this WHERE clause, even if the migration is replayed.

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
  AND ea.created_at = '2026-05-22 00:02:03.311703+00'::timestamptz
  AND ea.is_available = true
  AND r.timezone IS NOT NULL
  AND r.timezone <> 'UTC';

COMMIT;
