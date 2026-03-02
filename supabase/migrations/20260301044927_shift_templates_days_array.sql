-- Migration: Replace day_of_week (single day) with days (multi-day array) on shift_templates
-- This enables templates that apply to multiple days (e.g., "Morning Weekdays" for Mon-Fri)

-- Step 1: Add the new days array column
ALTER TABLE shift_templates ADD COLUMN IF NOT EXISTS days INTEGER[] NOT NULL DEFAULT '{}';

-- Step 2: Migrate existing data — copy day_of_week into single-element array
UPDATE shift_templates SET days = ARRAY[day_of_week] WHERE day_of_week IS NOT NULL AND days = '{}';

-- Step 3: Drop old constraint and column
ALTER TABLE shift_templates DROP CONSTRAINT IF EXISTS valid_day_of_week;
ALTER TABLE shift_templates DROP COLUMN IF EXISTS day_of_week;

-- Step 4: Add check constraint — each element must be 0-6 (Sunday-Saturday)
ALTER TABLE shift_templates ADD CONSTRAINT valid_days CHECK (
  days <@ ARRAY[0,1,2,3,4,5,6]
);

-- Step 5: Drop the old index on day_of_week (it references the dropped column)
DROP INDEX IF EXISTS idx_shift_templates_day_of_week;

-- Step 6: Add GIN index for array containment queries on days
CREATE INDEX IF NOT EXISTS idx_shift_templates_days ON shift_templates USING GIN (days);
