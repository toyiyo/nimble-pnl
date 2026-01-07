-- Add unit_price column to receipt_line_items
-- This column stores the price per unit, while parsed_price contains the line total (quantity × unit_price)

ALTER TABLE receipt_line_items 
ADD COLUMN IF NOT EXISTS unit_price numeric;

-- Backfill existing records: calculate unit_price from parsed_price / parsed_quantity
UPDATE receipt_line_items
SET unit_price = CASE 
  WHEN parsed_quantity > 0 THEN parsed_price / parsed_quantity 
  ELSE parsed_price 
END
WHERE unit_price IS NULL AND parsed_price IS NOT NULL;

-- Add helpful comments to clarify the price columns
COMMENT ON COLUMN receipt_line_items.unit_price IS 'Price per unit. parsed_price contains the line total.';
COMMENT ON COLUMN receipt_line_items.parsed_price IS 'Total price for this line item (quantity × unit_price)';
