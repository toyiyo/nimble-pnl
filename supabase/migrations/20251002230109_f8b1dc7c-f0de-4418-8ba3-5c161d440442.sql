
-- Drop the old 4-parameter version of process_unified_inventory_deduction
-- The 5-parameter version with DEFAULT NULL for p_external_order_id will handle both cases
DROP FUNCTION IF EXISTS public.process_unified_inventory_deduction(
  p_restaurant_id uuid, 
  p_pos_item_name text, 
  p_quantity_sold integer, 
  p_sale_date text
);

-- Verify we only have one version left (the 5-parameter one)
-- This function handles both cases: with or without external_order_id
