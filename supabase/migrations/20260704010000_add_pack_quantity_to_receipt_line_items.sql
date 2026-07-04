-- Add distributor "pack" (inner units per purchasing case) to receipt line items.
-- Audit/display metadata only. NOT the products.package_qty costing field.
-- Example (PFG item 87750): 1 case ordered, pack 500 packets of .32 oz each → pack_quantity = 500.
-- parsedQuantity = casesOrdered × pack_quantity (total inner units received).

ALTER TABLE receipt_line_items
ADD COLUMN IF NOT EXISTS pack_quantity INTEGER;

COMMENT ON COLUMN receipt_line_items.pack_quantity IS
  'Distributor pack: inner units per purchasing case (audit/display only). '
  'Distinct from products.package_qty, which drives calculate_recipe_cost. '
  'Example: PFG Ordered=1, Pack=500 → pack_quantity=500, parsed_quantity=500 packets.';
