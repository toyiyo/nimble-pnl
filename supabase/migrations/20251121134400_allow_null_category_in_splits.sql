-- Allow NULL category_id in unified_sales_splits to support uncategorized splits
-- This is needed for manual sales with adjustments where splits are created before categorization

ALTER TABLE unified_sales_splits
  ALTER COLUMN category_id DROP NOT NULL;

-- Add index for uncategorized splits
CREATE INDEX IF NOT EXISTS idx_unified_sales_splits_uncategorized 
  ON unified_sales_splits(sale_id) 
  WHERE category_id IS NULL;

-- Comment explaining the change
COMMENT ON COLUMN unified_sales_splits.category_id IS 
'Category for this split. Can be NULL for uncategorized splits that need to be categorized later.';
