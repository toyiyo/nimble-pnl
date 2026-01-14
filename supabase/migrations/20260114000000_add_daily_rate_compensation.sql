-- Migration: Add daily_rate compensation type
-- 
-- Supports "Per Day Worked" payment model where employees are paid a fixed
-- daily rate for each day they work (hours irrelevant).
-- 
-- Example: $1000/week ÷ 6 days = $166.67/day
-- - 3 days worked = $500.01
-- - 6 days worked = $1000.02
-- - 7 days worked = $1166.69 (exceeds weekly reference)

BEGIN;

-- ============================================================================
-- STEP 1: Add new compensation type to constraint
-- ============================================================================

ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_compensation_type_check,
  ADD CONSTRAINT employees_compensation_type_check
    CHECK (compensation_type IN ('hourly', 'salary', 'contractor', 'daily_rate'));

-- ============================================================================
-- STEP 2: Add daily_rate-specific fields
-- ============================================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS daily_rate_amount INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS daily_rate_reference_weekly INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS daily_rate_reference_days INTEGER DEFAULT NULL;

-- ============================================================================
-- STEP 3: Add documentation
-- ============================================================================

COMMENT ON COLUMN employees.daily_rate_amount IS 
  'Derived daily rate in cents (e.g., $1000/6 days = 16667 cents). Source of truth for pay calculations.';

COMMENT ON COLUMN employees.daily_rate_reference_weekly IS 
  'Weekly reference amount in cents (e.g., $1000 = 100000 cents). Manager''s mental model for display/audit.';

COMMENT ON COLUMN employees.daily_rate_reference_days IS 
  'Standard work days per week (e.g., 6). Used with reference weekly to derive daily rate.';

-- ============================================================================
-- STEP 4: Add check constraints for data integrity
-- ============================================================================

-- Ensure daily_rate employees have required fields
ALTER TABLE employees
  ADD CONSTRAINT daily_rate_fields_required
    CHECK (
      compensation_type != 'daily_rate' OR (
        daily_rate_amount IS NOT NULL AND
        daily_rate_amount > 0 AND
        daily_rate_reference_weekly IS NOT NULL AND
        daily_rate_reference_weekly > 0 AND
        daily_rate_reference_days IS NOT NULL AND
        daily_rate_reference_days > 0
      )
    );

COMMIT;
