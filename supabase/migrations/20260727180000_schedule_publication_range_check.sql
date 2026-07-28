-- Guard the schedule_publications week range invariant.
--
-- Every row in production drifted to an 8-day span (Mon..Mon) because the
-- client serialized a local-midnight week-end token with toISOString(), which
-- reads UTC fields. The client is fixed; this constraint stops the invariant
-- from drifting silently again.
--
-- NOT VALID is deliberate: it enforces the rule on every new write while
-- leaving the 44 historical rows untouched, matching the decision not to
-- backfill. The bound is `<= 6` rather than `= 6` so a future partial-week
-- publish stays legal; only the spill is forbidden.

ALTER TABLE public.schedule_publications
  ADD CONSTRAINT schedule_publications_week_range_valid
  CHECK (
    week_end_date >= week_start_date
    AND week_end_date - week_start_date <= 6
  )
  NOT VALID;
