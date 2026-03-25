-- Add area field to employees for grouping in schedule view
-- Areas represent physical zones in the restaurant (Back of House, Front of House, Bar, etc.)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS area TEXT;

-- Index for filtering/grouping by area
CREATE INDEX IF NOT EXISTS idx_employees_area ON employees(restaurant_id, area) WHERE area IS NOT NULL;
