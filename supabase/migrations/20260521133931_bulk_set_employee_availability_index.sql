-- Composite index for bulk_set_employee_availability DELETE predicate and
-- per-employee/per-day lookups in check_availability_conflict.
-- Split from 20260521133930_bulk_set_employee_availability.sql because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_employee_availability_restaurant_employee_day
  ON employee_availability (restaurant_id, employee_id, day_of_week);
