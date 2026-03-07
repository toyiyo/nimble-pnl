-- Add min_crew JSONB column for position-based minimum staffing
-- Example: {"Cook": 2, "Server": 1, "Bartender": 1, "Dishwasher": 1}
-- When set, the sum of values replaces the single min_staff as the staffing floor.
ALTER TABLE staffing_settings
  ADD COLUMN IF NOT EXISTS min_crew JSONB;
