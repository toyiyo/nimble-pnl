-- Add source column to track how shifts were created
ALTER TABLE shifts ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN shifts.source IS 'How this shift was created: manual, ai, or template';
