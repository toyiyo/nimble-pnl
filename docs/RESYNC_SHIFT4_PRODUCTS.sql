-- Optional migration: Re-sync existing Shift4 charges to update product names
-- This script can be run manually by restaurant admins to update existing unified_sales entries
-- with product names extracted from the charge metadata/description

-- Note: This will update existing unified_sales entries where pos_system = 'shift4'
-- It's safe to run multiple times (idempotent) due to the ON CONFLICT clause

-- For a specific restaurant, run:
-- SELECT sync_shift4_to_unified_sales('your-restaurant-id-here'::UUID);

-- To re-sync all restaurants with Shift4 connections:
DO $$
DECLARE
  restaurant_record RECORD;
  sync_count INTEGER;
BEGIN
  -- Loop through all restaurants with Shift4 connections
  FOR restaurant_record IN 
    SELECT DISTINCT restaurant_id 
    FROM shift4_connections
  LOOP
    -- Call sync function for each restaurant
    SELECT sync_shift4_to_unified_sales(restaurant_record.restaurant_id)
    INTO sync_count;
    
    RAISE NOTICE 'Re-synced % items for restaurant %', sync_count, restaurant_record.restaurant_id;
  END LOOP;
  
  RAISE NOTICE 'Re-sync completed for all Shift4-connected restaurants';
END $$;

-- Verify: Check sample of updated entries
-- Uncomment and modify restaurant_id to check your data:
/*
SELECT 
  item_name,
  total_price,
  sale_date,
  external_order_id,
  raw_data->'metadata'->>'product_name' as metadata_product_name,
  raw_data->>'description' as charge_description
FROM unified_sales
WHERE restaurant_id = 'your-restaurant-id-here'::UUID
  AND pos_system = 'shift4'
  AND sale_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY sale_date DESC, sale_time DESC
LIMIT 20;
*/
