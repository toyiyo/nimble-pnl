-- Add optional area field to shift templates for grouping and AI scheduling
ALTER TABLE shift_templates ADD COLUMN area TEXT;

-- Index for filtered queries by area within a restaurant
CREATE INDEX idx_shift_templates_area
  ON shift_templates (restaurant_id, area)
  WHERE area IS NOT NULL;
