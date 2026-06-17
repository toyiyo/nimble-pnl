-- Fix: deleting a published shift fails with
--   "insert or update on table schedule_change_logs violates foreign key
--    constraint schedule_change_logs_shift_id_fkey" (SQLSTATE 23503)
--
-- Root cause
-- ----------
-- The AFTER DELETE trigger log_shift_changes -> log_shift_change() (added in
-- 20251123000000_schedule_publishing.sql) logs deletions of published shifts by
-- inserting an audit row into schedule_change_logs with shift_id = OLD.id.
-- Because the trigger fires AFTER DELETE, the shift row is already gone, so the
-- INSERT's foreign-key check (schedule_change_logs_shift_id_fkey -> shifts.id)
-- finds no matching shift and aborts the whole DELETE.
--
-- ON DELETE SET NULL on that FK does NOT prevent this: SET NULL only nullifies
-- pre-existing child rows when the parent is deleted; it does not rescue a child
-- row that the trigger inserts *after* the parent is already gone. The insert is
-- validated like any other insert, and the referenced shift no longer exists.
--
-- This made every direct delete of a *published* shift fail (planner "remove
-- shift" / delete-this-occurrence / bulk delete all call
-- `supabase.from('shifts').delete()` with no locked/published guard). Deleting
-- *unpublished* shifts was unaffected because the trigger only logs published ones.
--
-- Fix
-- ---
-- An audit/event log must not hold an *enforced* FK to the table whose deletions
-- it records -- the deletion record inherently points at a row that no longer
-- exists. Convert shift_id to a soft reference by dropping the FK constraint.
--
--   * The shift_id column and idx_schedule_change_logs_shift_id index remain, so
--     change logs are still queryable by shift_id.
--   * For deletions, shift_id is now RETAINED (instead of being nulled), which is
--     strictly better for an audit trail; before_data already snapshots the full
--     shift row (row_to_json(OLD)).
--   * No app code embeds shifts through schedule_change_logs (only employee is
--     embedded), so dropping the PostgREST relationship breaks nothing.

ALTER TABLE public.schedule_change_logs
  DROP CONSTRAINT IF EXISTS schedule_change_logs_shift_id_fkey;

COMMENT ON COLUMN public.schedule_change_logs.shift_id IS
  'Soft reference to the shift this change concerns. Intentionally NOT a foreign '
  'key: a ''deleted'' audit row must retain the id of a shift that no longer '
  'exists. Join to shifts manually and tolerate missing rows.';
