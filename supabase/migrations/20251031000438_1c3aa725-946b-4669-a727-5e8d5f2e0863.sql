-- Fix unique constraint to allow split sales
-- The current constraint prevents splits because split items have the same external IDs

-- Drop the old constraint
ALTER TABLE unified_sales DROP CONSTRAINT IF EXISTS unified_sales_unique_square;

-- Create a partial unique index that only applies to non-split items (parent_sale_id IS NULL)
-- This allows split items to have the same external IDs while preventing duplicate POS imports
CREATE UNIQUE INDEX IF NOT EXISTS unified_sales_unique_square 
ON unified_sales (restaurant_id, pos_system, external_order_id, external_item_id)
WHERE parent_sale_id IS NULL;

COMMENT ON INDEX unified_sales_unique_square IS 
'Ensures no duplicate POS imports. Excludes split items (parent_sale_id NOT NULL) to allow splitting sales into multiple categories.';