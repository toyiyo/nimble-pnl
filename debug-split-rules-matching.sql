-- Test query to debug why rules aren't matching POS sales
-- Run this in Supabase SQL Editor to see what's happening

-- 1. Check the rule configuration
SELECT 
  id,
  rule_name,
  item_name_pattern,
  item_name_match_type,
  is_active,
  applies_to,
  is_split_rule,
  split_categories,
  pos_category,
  amount_min,
  amount_max
FROM categorization_rules
WHERE rule_name = 'Wetzel bits';

-- 2. Check a sample POS sale that should match
SELECT 
  id,
  item_name,
  total_price,
  pos_category,
  is_categorized,
  is_split,
  category_id
FROM unified_sales
WHERE item_name ILIKE '%Wetzel bits%'
  AND (is_categorized = false OR category_id IS NULL)
  AND is_split = false
ORDER BY sale_date DESC
LIMIT 5;

-- 3. Test the matching logic manually
-- Replace the UUIDs with your actual restaurant_id
WITH test_sale AS (
  SELECT jsonb_build_object(
    'item_name', 'Wetzel bits',
    'total_price', 7.99,
    'pos_category', NULL
  ) AS sale_data
)
SELECT 
  cr.id AS rule_id,
  cr.rule_name,
  cr.item_name_pattern,
  cr.item_name_match_type,
  cr.is_split_rule,
  cr.split_categories,
  -- Test the matching condition
  CASE cr.item_name_match_type
    WHEN 'exact' THEN LOWER(test_sale.sale_data->>'item_name') = LOWER(cr.item_name_pattern)
    WHEN 'contains' THEN LOWER(test_sale.sale_data->>'item_name') LIKE '%' || LOWER(cr.item_name_pattern) || '%'
    WHEN 'starts_with' THEN LOWER(test_sale.sale_data->>'item_name') LIKE LOWER(cr.item_name_pattern) || '%'
    WHEN 'ends_with' THEN LOWER(test_sale.sale_data->>'item_name') LIKE '%' || LOWER(cr.item_name_pattern)
    WHEN 'regex' THEN (test_sale.sale_data->>'item_name') ~ cr.item_name_pattern
    ELSE false
  END AS would_match
FROM categorization_rules cr
CROSS JOIN test_sale
WHERE cr.rule_name = 'Wetzel bits'
  AND cr.is_active = true
  AND (cr.applies_to = 'pos_sales' OR cr.applies_to = 'both');

-- 4. Check if there are any column name issues
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'categorization_rules'
  AND column_name IN ('split_categories', 'split_config', 'category_id', 'is_split_rule')
ORDER BY column_name;

-- 5. Test the find_matching_rules_for_pos_sale function directly
-- Replace with your restaurant_id
SELECT * FROM find_matching_rules_for_pos_sale(
  'b80c60f4-76f9-49e6-9e63-7594d708d31a'::UUID,
  jsonb_build_object(
    'item_name', 'Wetzel bits',
    'total_price', 7.99,
    'pos_category', NULL
  )
);
