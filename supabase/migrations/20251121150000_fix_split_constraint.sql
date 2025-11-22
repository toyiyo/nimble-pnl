-- Fix split rule constraint issue
-- Drop any old/conflicting constraints and ensure correct constraint exists

-- Drop old constraints if they exist (these may be from earlier development or manual changes)
ALTER TABLE categorization_rules DROP CONSTRAINT IF EXISTS check_split_config;
ALTER TABLE categorization_rules DROP CONSTRAINT IF EXISTS check_split_rule_has_categories;
ALTER TABLE categorization_rules DROP CONSTRAINT IF EXISTS check_split_configuration;

-- Ensure category_id can be NULL (for split rules)
ALTER TABLE categorization_rules ALTER COLUMN category_id DROP NOT NULL;

-- Add the correct constraint with proper validation
-- This constraint ensures:
-- 1. Regular rules must have category_id and no split_categories
-- 2. Split rules must have split_categories array (at least 2 items) and no category_id requirement
ALTER TABLE categorization_rules
ADD CONSTRAINT check_split_rule_has_categories
CHECK (
  (is_split_rule IS FALSE AND split_categories IS NULL AND category_id IS NOT NULL) OR
  (is_split_rule IS TRUE AND split_categories IS NOT NULL AND jsonb_array_length(split_categories) >= 2)
);
