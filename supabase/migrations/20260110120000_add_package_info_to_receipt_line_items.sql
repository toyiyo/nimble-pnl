-- Add package size and type fields to receipt_line_items
-- Separates package type (bottle, bag) from size unit (ml, oz, lb)
-- Example: "1 bottle containing 750 ml" → package_type=bottle, size_value=750, size_unit=ml

ALTER TABLE receipt_line_items 
ADD COLUMN IF NOT EXISTS package_type TEXT,
ADD COLUMN IF NOT EXISTS size_value NUMERIC,
ADD COLUMN IF NOT EXISTS size_unit TEXT;

-- Add helpful comments
COMMENT ON COLUMN receipt_line_items.parsed_unit IS 'DEPRECATED: Use package_type for containers (bottle, bag) and size_unit for measurements (ml, oz, lb)';
COMMENT ON COLUMN receipt_line_items.package_type IS 'Type of container/package (bottle, bag, case, box, etc.)';
COMMENT ON COLUMN receipt_line_items.size_value IS 'Amount per single package (e.g., 750 for a 750ml bottle)';
COMMENT ON COLUMN receipt_line_items.size_unit IS 'Unit of measurement for size_value (ml, oz, lb, kg, etc.)';

-- Backfill existing data: detect if parsed_unit is a measurement unit or container
UPDATE receipt_line_items
SET 
  size_unit = CASE 
    WHEN LOWER(parsed_unit) IN ('lb', 'kg', 'g', 'oz', 'fl oz', 'cup', 'tbsp', 'tsp', 'ml', 'l', 'gal', 'qt') 
    THEN parsed_unit
    ELSE NULL
  END,
  package_type = CASE 
    WHEN LOWER(parsed_unit) NOT IN ('lb', 'kg', 'g', 'oz', 'fl oz', 'cup', 'tbsp', 'tsp', 'ml', 'l', 'gal', 'qt')
    THEN parsed_unit
    ELSE NULL
  END,
  size_value = CASE 
    WHEN LOWER(parsed_unit) IN ('lb', 'kg', 'g', 'oz', 'fl oz', 'cup', 'tbsp', 'tsp', 'ml', 'l', 'gal', 'qt')
    THEN parsed_quantity
    ELSE NULL
  END
WHERE package_type IS NULL AND size_unit IS NULL;
