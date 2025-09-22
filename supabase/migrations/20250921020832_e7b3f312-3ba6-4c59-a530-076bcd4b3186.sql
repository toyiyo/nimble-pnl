-- Delete the incorrect daily_pnl entry for 2025-09-21
DELETE FROM daily_pnl 
WHERE restaurant_id = 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c' 
AND date = '2025-09-21';

-- Delete any incorrect daily_sales entry for 2025-09-21
DELETE FROM daily_sales 
WHERE restaurant_id = 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c' 
AND date = '2025-09-21' 
AND source = 'square';

-- Delete any incorrect daily_labor_costs entry for 2025-09-21
DELETE FROM daily_labor_costs 
WHERE restaurant_id = 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c' 
AND date = '2025-09-21' 
AND source = 'square';