-- Idempotent "Apply suggested shifts": a partial unique index lets the client
-- upsert with ON CONFLICT DO NOTHING so re-applying a week is a silent no-op.
-- Scoped to active templates only (soft-deleted rows must not block re-creation).
--
-- Column order: restaurant_id first for multi-tenant selectivity (most selective
-- prefix is the restaurant, then position narrows further, then the time window).
--
-- Note: ON CONFLICT can target this partial index by repeating its WHERE predicate:
--   ON CONFLICT (restaurant_id, position, start_time, end_time)
--   WHERE is_active = true DO NOTHING
--
-- The `days` array is intentionally excluded from the key: a single slot may
-- serve multiple days, and per-day differences are rare for AI suggestions.

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_templates_active_slot
  ON public.shift_templates (restaurant_id, position, start_time, end_time)
  WHERE is_active = true;
