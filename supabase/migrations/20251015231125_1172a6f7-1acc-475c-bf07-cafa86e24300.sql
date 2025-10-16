-- Fix Clover prices: they were divided by 1000 but should only be divided by 100
-- So we need to multiply by 10 to correct them

UPDATE clover_order_line_items
SET 
  price = price * 10,
  updated_at = now()
WHERE price < 1;

UPDATE unified_sales
SET 
  unit_price = unit_price * 10,
  total_price = quantity * (unit_price * 10)
WHERE pos_system = 'clover' 
  AND unit_price < 1;