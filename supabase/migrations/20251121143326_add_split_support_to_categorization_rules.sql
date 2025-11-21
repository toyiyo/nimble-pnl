-- Add split support to categorization rules
-- This allows rules to automatically split transactions/sales across multiple categories

-- Add new columns to categorization_rules table
ALTER TABLE categorization_rules 
ADD COLUMN IF NOT EXISTS is_split_rule BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS split_categories JSONB;

-- Update existing rows to ensure they have proper default values
-- This prevents check constraint violations
UPDATE categorization_rules
SET 
  is_split_rule = false,
  split_categories = NULL
WHERE is_split_rule IS NULL;

-- Add comment explaining split_categories structure
COMMENT ON COLUMN categorization_rules.split_categories IS 
'JSONB array of split category definitions. Each entry should have:
{
  "category_id": "uuid",
  "amount": numeric (optional if percentage is used),
  "percentage": numeric (optional if amount is used),
  "description": "text" (optional)
}
Example: [
  {"category_id": "uuid1", "percentage": 60, "description": "Labor portion"},
  {"category_id": "uuid2", "percentage": 40, "description": "Materials portion"}
]';

-- Now safely drop the NOT NULL constraint on category_id BEFORE adding the check constraint
-- This allows split rules to have NULL category_id
ALTER TABLE categorization_rules 
ALTER COLUMN category_id DROP NOT NULL;

-- Add validation check to ensure split rules have split_categories and regular rules have category_id
-- Note: This constraint ensures data integrity for both rule types
ALTER TABLE categorization_rules
ADD CONSTRAINT check_split_rule_has_categories
CHECK (
  (is_split_rule = false AND split_categories IS NULL) OR
  (is_split_rule = true AND category_id IS NULL AND split_categories IS NOT NULL AND jsonb_array_length(split_categories) >= 2)
);

-- Add index for faster lookup of split rules
CREATE INDEX IF NOT EXISTS idx_categorization_rules_is_split 
ON categorization_rules(restaurant_id, is_split_rule, is_active) 
WHERE is_active = true;
