-- Add shift_template_id to shifts for accurate planner bucketing.
-- Nullable: legacy/imported shifts won't have a template reference.
ALTER TABLE shifts
  ADD COLUMN shift_template_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL;

-- Index for efficient lookups when building the planner grid
CREATE INDEX idx_shifts_shift_template_id ON shifts(shift_template_id)
  WHERE shift_template_id IS NOT NULL;
