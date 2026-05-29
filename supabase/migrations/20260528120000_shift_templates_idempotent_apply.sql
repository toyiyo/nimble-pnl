-- Idempotent "Apply suggested shifts": a partial unique index lets the client
-- upsert with ON CONFLICT DO NOTHING so re-applying a week is a silent no-op.
-- Scoped to active templates only (soft-deleted rows must not block re-creation).
--
-- Column order: restaurant_id first for multi-tenant selectivity (most selective
-- prefix is the restaurant, then position narrows further, then the time window).
--
-- Note: ON CONFLICT can target this partial index by repeating its WHERE predicate:
--   ON CONFLICT (restaurant_id, position, start_time, end_time, days)
--   WHERE is_active = true DO NOTHING
--
-- `days` IS part of the key: each suggested block targets one day (days = {dow}),
-- so the same role + time window on different days (e.g. Server 17:00-22:00 on
-- Fri {5} and Sat {6}) must be distinct rows. Excluding `days` would silently
-- drop every day after the first via ON CONFLICT DO NOTHING.

DROP INDEX IF EXISTS public.uq_shift_templates_active_slot;

CREATE UNIQUE INDEX uq_shift_templates_active_slot
  ON public.shift_templates (restaurant_id, position, start_time, end_time, days)
  WHERE is_active = true;
