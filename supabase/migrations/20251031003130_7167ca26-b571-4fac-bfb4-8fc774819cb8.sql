-- Add database constraints for split sales to prevent double counting
-- and ensure data integrity

-- Add foreign key constraint to ensure child splits have valid parent
ALTER TABLE unified_sales
ADD CONSTRAINT fk_parent_sale
FOREIGN KEY (parent_sale_id)
REFERENCES unified_sales(id)
ON DELETE CASCADE;

-- Add check constraint to prevent nested splits (parent sales can't have a parent)
ALTER TABLE unified_sales
ADD CONSTRAINT chk_no_nested_splits
CHECK (parent_sale_id IS NULL OR is_split = false);

-- Create index on parent_sale_id for performance
CREATE INDEX IF NOT EXISTS idx_unified_sales_parent_sale_id 
ON unified_sales(parent_sale_id) 
WHERE parent_sale_id IS NOT NULL;

-- Add comment explaining the constraints
COMMENT ON CONSTRAINT fk_parent_sale ON unified_sales IS 
'Ensures child split sales reference a valid parent sale. Cascades delete to children when parent is deleted.';

COMMENT ON CONSTRAINT chk_no_nested_splits ON unified_sales IS 
'Prevents nested splits - only original sales (where parent_sale_id IS NULL) can be marked as split (is_split = true).';