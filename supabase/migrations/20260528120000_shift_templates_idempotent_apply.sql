-- Idempotent "Apply suggested shifts": a partial unique index lets the client
-- upsert with ON CONFLICT DO NOTHING so re-applying a week is a silent no-op.
-- Scoped to active templates only (soft-deleted rows must not block re-creation).
--
-- Column order: restaurant_id first for multi-tenant selectivity (most selective
-- prefix is the restaurant, then position narrows further, then the time window).
--
-- Note: the upsert uses a bare ON CONFLICT DO NOTHING (no target), which catches
-- any unique violation including this partial index.
--
-- `days` AND `area` are both part of the key:
--   * days: the same role + time on different days (Fri {5} vs Sat {6}) are distinct.
--   * area: real operators run multiple concepts in one restaurant (e.g. a food
--     court with "Cold Stone" and "Wetzel's"); identical role/time/days in
--     different areas are legitimately distinct templates and must NOT collide.
-- area is nullable, so COALESCE(area,'') is used: NULL-area rows (e.g. Apply-
-- created suggested shifts) still conflict with each other (idempotent) while
-- staying distinct from named-area templates.

DROP INDEX IF EXISTS public.uq_shift_templates_active_slot;

CREATE UNIQUE INDEX uq_shift_templates_active_slot
  ON public.shift_templates (restaurant_id, position, start_time, end_time, days, (COALESCE(area, '')))
  WHERE is_active = true;
