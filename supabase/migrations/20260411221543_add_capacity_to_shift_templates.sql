-- Add capacity column to shift_templates
-- Represents how many employees are needed for this shift slot.
-- Default 1 preserves existing behavior for all current records.

ALTER TABLE shift_templates
  ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1
    CONSTRAINT shift_templates_capacity_min CHECK (capacity >= 1);
