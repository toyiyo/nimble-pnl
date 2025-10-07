
-- Delete all inventory transactions created today that should have been on historical dates
-- These are the incorrectly dated transactions from the bulk import
DELETE FROM inventory_transactions
WHERE restaurant_id = 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c'
  AND transaction_type = 'usage'
  AND created_at::date = '2025-10-02'
  AND reference_id LIKE '%_2025-09-%';

-- Also clean up the incorrect daily_food_costs aggregation for today
DELETE FROM daily_food_costs
WHERE restaurant_id = 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c'
  AND date = '2025-10-02'
  AND source = 'inventory_usage';
