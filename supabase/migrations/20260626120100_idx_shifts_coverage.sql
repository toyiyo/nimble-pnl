-- Composite index for the coverage sweep in shift_slot_min_concurrent.
-- The function filters: restaurant_id, start_time (overlap), status <> 'cancelled'.
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own migration file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_restaurant_start_status
  ON public.shifts (restaurant_id, start_time, status);
