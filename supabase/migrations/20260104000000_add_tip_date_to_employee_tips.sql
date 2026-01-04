-- Migration: Add tip_date column to employee_tips for accurate date-based filtering
-- Purpose: Prevent double-counting when aggregating tips from employee_tips and tip_split_items
-- 
-- Background:
-- - tip_splits.split_date is a DATE field
-- - employee_tips.recorded_at is a TIMESTAMP field
-- - We need to compare dates (not timestamps) to identify which employee_tips
--   are already included in approved tip splits
--
-- This migration:
-- 1. Adds tip_date column (DATE type)
-- 2. Populates it from recorded_at for existing rows
-- 3. Creates an index for query performance
-- 4. Adds a trigger to auto-populate tip_date from recorded_at

-- Add the tip_date column (nullable initially)
ALTER TABLE employee_tips
ADD COLUMN IF NOT EXISTS tip_date DATE;

-- Populate tip_date from recorded_at for existing rows
UPDATE employee_tips
SET tip_date = recorded_at::date
WHERE tip_date IS NULL;

-- Make tip_date NOT NULL and set default
ALTER TABLE employee_tips
ALTER COLUMN tip_date SET NOT NULL,
ALTER COLUMN tip_date SET DEFAULT CURRENT_DATE;

-- Create index for query performance
CREATE INDEX IF NOT EXISTS idx_employee_tips_tip_date 
ON employee_tips(tip_date);

-- Create a trigger to auto-populate tip_date from recorded_at
CREATE OR REPLACE FUNCTION set_tip_date_from_recorded_at()
RETURNS TRIGGER AS $$
BEGIN
  -- If tip_date is not explicitly set, derive it from recorded_at
  IF NEW.tip_date IS NULL THEN
    NEW.tip_date := (NEW.recorded_at AT TIME ZONE 'UTC')::date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_tip_date ON employee_tips;
CREATE TRIGGER trigger_set_tip_date
  BEFORE INSERT OR UPDATE ON employee_tips
  FOR EACH ROW
  EXECUTE FUNCTION set_tip_date_from_recorded_at();

-- Add comment for documentation
COMMENT ON COLUMN employee_tips.tip_date IS 'Date the tip was earned (DATE type for comparison with tip_splits.split_date). Auto-populated from recorded_at if not set.';
