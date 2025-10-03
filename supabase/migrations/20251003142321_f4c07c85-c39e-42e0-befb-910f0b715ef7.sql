-- Step 1: Add bulk-to-individual package breakdown fields (backward compatible)
-- These are all NULLABLE to ensure existing products continue working unchanged

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS bulk_purchase_unit TEXT,
ADD COLUMN IF NOT EXISTS items_per_package INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS individual_unit TEXT,
ADD COLUMN IF NOT EXISTS individual_unit_size NUMERIC;

-- Add helpful comments
COMMENT ON COLUMN products.bulk_purchase_unit IS 'The unit you purchase in bulk (e.g., box, case, pallet)';
COMMENT ON COLUMN products.items_per_package IS 'How many individual sellable units are in one bulk package (default: 1)';
COMMENT ON COLUMN products.individual_unit IS 'The individual unit you sell/use in recipes (e.g., bag, bottle, can)';
COMMENT ON COLUMN products.individual_unit_size IS 'Optional: size of each individual unit for reference';

-- Ensure items_per_package is at least 1 for new entries
ALTER TABLE products 
ADD CONSTRAINT items_per_package_positive CHECK (items_per_package IS NULL OR items_per_package >= 1);