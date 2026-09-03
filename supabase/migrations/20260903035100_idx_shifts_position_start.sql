-- supabase: no-transaction
--
-- Shift Protection: index for the coverage overlap counts.
--
-- get_timeoff_coverage_impact (20260903034600) and review_time_off_request
-- (20260903034700) count same-position shifts inside a bounded time
-- window. The existing (restaurant_id, position, status) index has no
-- time column, so the count read every non-cancelled shift of the
-- position. This partial index matches the queries' status filter and
-- prunes by start_time (Phase 7a performance finding).
--
-- One CREATE INDEX CONCURRENTLY per file with the no-transaction header
-- (lesson: 2026-08-31).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_restaurant_position_start
  ON shifts (restaurant_id, position, start_time)
  WHERE status IN ('scheduled', 'confirmed');
