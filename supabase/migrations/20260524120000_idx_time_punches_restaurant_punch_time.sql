-- Composite index on (restaurant_id, punch_time) to support the
-- AI chat get_labor_costs / get_time_punches query pattern.
--
-- The existing schema has separate idx_time_punches_restaurant and
-- idx_time_punches_time indexes, but both new code paths filter on
-- restaurant_id AND a punch_time range, so a composite is meaningfully faster.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, so this
-- migration intentionally contains only the index statement.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_time_punches_restaurant_punch_time
  ON public.time_punches (restaurant_id, punch_time);
