-- Add employment type (full-time or part-time) for scheduling
ALTER TABLE employees
  ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'full_time'
  CHECK (employment_type IN ('full_time', 'part_time'));

-- Add optional date of birth for minor detection
ALTER TABLE employees
  ADD COLUMN date_of_birth DATE;

-- Comment for documentation
COMMENT ON COLUMN employees.employment_type IS 'full_time or part_time — used by scheduler for weekly hour targeting';
COMMENT ON COLUMN employees.date_of_birth IS 'Optional DOB for minor detection (age < 18)';
