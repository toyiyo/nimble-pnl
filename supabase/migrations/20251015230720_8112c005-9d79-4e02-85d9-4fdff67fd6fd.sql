-- Fix existing Clover data with incorrect quantities and prices
-- Clover stores quantities in thousands (1000 = 1 item) and prices in cents

-- Update clover_order_line_items: divide unit_quantity by 1000 and price by 1000
UPDATE clover_order_line_items
SET 
  unit_quantity = unit_quantity / 1000,
  price = price / 1000,
  updated_at = now()
WHERE unit_quantity >= 1000 OR price >= 1000;

-- Update unified_sales for Clover items: divide quantity by 1000, unit_price by 1000, and recalculate total_price
UPDATE unified_sales
SET 
  quantity = quantity / 1000,
  unit_price = unit_price / 1000,
  total_price = (quantity / 1000) * (unit_price / 1000)
WHERE pos_system = 'clover' 
  AND (quantity >= 1000 OR unit_price >= 1000);