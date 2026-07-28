-- Guard the schedule_publications week range invariant.
--
-- Every row in production drifted to an 8-day span (Mon..Mon) because the
-- client serialized a local-midnight week-end token with toISOString(), which
-- reads UTC fields. The client is fixed; this guard stops the invariant from
-- drifting silently again.
--
-- A trigger, NOT a CHECK constraint. A CHECK (even NOT VALID) is re-evaluated
-- against the full new row on EVERY update, not just updates that touch the
-- checked columns — so it would reject
--   UPDATE schedule_publications SET open_shifts_broadcast_at = ...
-- on any of the 44 pre-existing 8-day rows. That is exactly what
-- broadcast-open-shifts does when a manager re-broadcasts open shifts for an
-- already-published week, and the invariant is not what that write is about.
--
-- Scoping the update trigger to the two date columns keeps the historical rows
-- writable (matching the decision not to backfill) while still rejecting any
-- new write that would produce a spilled span. The bound is `<= 6` rather than
-- `= 6` so a future partial-week publish stays legal; only the spill is
-- forbidden.

CREATE OR REPLACE FUNCTION public.assert_schedule_publication_week_range()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.week_end_date < NEW.week_start_date
     OR NEW.week_end_date - NEW.week_start_date > 6 THEN
    RAISE EXCEPTION
      'schedule_publications week range must span 0..6 days, got % .. % (% days)',
      NEW.week_start_date,
      NEW.week_end_date,
      NEW.week_end_date - NEW.week_start_date
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.assert_schedule_publication_week_range() IS
  'Rejects schedule_publications rows whose week_start_date..week_end_date span '
  'is negative or longer than 6 days (a Mon..Sun week is 6). Raises 23514 to '
  'match the CHECK-constraint SQLSTATE callers would otherwise see.';

DROP TRIGGER IF EXISTS schedule_publications_week_range_insert
  ON public.schedule_publications;

CREATE TRIGGER schedule_publications_week_range_insert
  BEFORE INSERT ON public.schedule_publications
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_schedule_publication_week_range();

DROP TRIGGER IF EXISTS schedule_publications_week_range_update
  ON public.schedule_publications;

-- `UPDATE OF` narrows to statements that mention the date columns; the WHEN
-- clause narrows further to statements that actually change them. Together they
-- leave broadcast-stamping (and any other non-date update) on legacy rows alone.
CREATE TRIGGER schedule_publications_week_range_update
  BEFORE UPDATE OF week_start_date, week_end_date
  ON public.schedule_publications
  FOR EACH ROW
  WHEN (
    NEW.week_start_date IS DISTINCT FROM OLD.week_start_date
    OR NEW.week_end_date IS DISTINCT FROM OLD.week_end_date
  )
  EXECUTE FUNCTION public.assert_schedule_publication_week_range();
