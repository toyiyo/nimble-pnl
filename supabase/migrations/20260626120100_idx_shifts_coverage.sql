-- Composite index for the coverage sweep in shift_slot_min_concurrent.
-- The function filters: restaurant_id, position, status <> 'cancelled'.
-- Including position as the second key lets Postgres narrow by restaurant+position
-- before scanning for overlap, which is the dominant access pattern in get_open_shifts
-- and claim_open_shift where position is always supplied.
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own migration file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_restaurant_position_status
  ON public.shifts (restaurant_id, position, status)
  WHERE status <> 'cancelled';
