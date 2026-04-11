-- Add CHECK constraint to enforce valid source values
ALTER TABLE shifts
  ADD CONSTRAINT shifts_source_check
  CHECK (source IN ('manual', 'ai', 'template'));
