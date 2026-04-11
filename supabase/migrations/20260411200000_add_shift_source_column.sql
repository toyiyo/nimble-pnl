-- Add source column to track how shifts were created
ALTER TABLE shifts ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE shifts
  ADD CONSTRAINT shifts_source_check
  CHECK (source IN ('manual', 'ai', 'template'));

COMMENT ON COLUMN shifts.source IS 'How this shift was created: manual, ai, or template';
