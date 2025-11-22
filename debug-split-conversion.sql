-- Debug the split conversion process step by step

-- 1. Get the split rule
SELECT 
  id,
  rule_name,
  is_split_rule,
  split_categories,
  jsonb_pretty(split_categories) as split_categories_formatted
FROM categorization_rules
WHERE restaurant_id = 'b80c60f4-76f9-49e6-9e63-7594d708d31a'
  AND is_split_rule = true
LIMIT 1;

-- 2. Get a sample sale that should match
SELECT 
  id,
  item_name,
  total_price,
  pos_category,
  is_categorized,
  category_id,
  is_split
FROM unified_sales
WHERE restaurant_id = 'b80c60f4-76f9-49e6-9e63-7594d708d31a'
  AND item_name ILIKE '%wetzel%'
  AND (is_categorized = false OR category_id IS NULL)
  AND is_split = false
LIMIT 5;

-- 3. Test if the rule matches this sale
WITH sample_sale AS (
  SELECT 
    id,
    item_name,
    total_price,
    pos_category
  FROM unified_sales
  WHERE restaurant_id = 'b80c60f4-76f9-49e6-9e63-7594d708d31a'
    AND item_name ILIKE '%wetzel%'
    AND (is_categorized = false OR category_id IS NULL)
    AND is_split = false
  LIMIT 1
)
SELECT 
  s.id as sale_id,
  s.item_name,
  s.total_price,
  r.*
FROM sample_sale s
CROSS JOIN LATERAL (
  SELECT * FROM find_matching_rules_for_pos_sale(
    'b80c60f4-76f9-49e6-9e63-7594d708d31a',
    jsonb_build_object(
      'item_name', s.item_name,
      'total_price', s.total_price,
      'pos_category', s.pos_category
    )
  )
  LIMIT 1
) r;

-- 4. Manually test the conversion logic
WITH sample_sale AS (
  SELECT 
    id,
    total_price
  FROM unified_sales
  WHERE restaurant_id = 'b80c60f4-76f9-49e6-9e63-7594d708d31a'
    AND item_name ILIKE '%wetzel%'
    AND (is_categorized = false OR category_id IS NULL)
    AND is_split = false
  LIMIT 1
),
rule_data AS (
  SELECT split_categories
  FROM categorization_rules
  WHERE restaurant_id = 'b80c60f4-76f9-49e6-9e63-7594d708d31a'
    AND is_split_rule = true
  LIMIT 1
)
SELECT 
  s.id as sale_id,
  s.total_price as original_amount,
  split_item->>'category_id' as category_id,
  split_item->>'percentage' as percentage,
  ROUND((s.total_price * (split_item->>'percentage')::NUMERIC / 100.0), 2) as calculated_amount,
  jsonb_build_object(
    'category_id', split_item->>'category_id',
    'amount', ROUND((s.total_price * (split_item->>'percentage')::NUMERIC / 100.0), 2),
    'description', COALESCE(split_item->>'description', '')
  ) as converted_split
FROM sample_sale s
CROSS JOIN rule_data r
CROSS JOIN LATERAL jsonb_array_elements(r.split_categories) AS split_item;

-- 5. Test split_pos_sale with converted amounts
WITH sample_sale AS (
  SELECT id, total_price
  FROM unified_sales
  WHERE restaurant_id = 'b80c60f4-76f9-49e6-9e63-7594d708d31a'
    AND item_name ILIKE '%wetzel%'
    AND (is_categorized = false OR category_id IS NULL)
    AND is_split = false
  LIMIT 1
),
rule_data AS (
  SELECT split_categories
  FROM categorization_rules
  WHERE restaurant_id = 'b80c60f4-76f9-49e6-9e63-7594d708d31a'
    AND is_split_rule = true
  LIMIT 1
),
converted_splits AS (
  SELECT 
    s.id as sale_id,
    jsonb_agg(
      jsonb_build_object(
        'category_id', split_item->>'category_id',
        'amount', ROUND((s.total_price * (split_item->>'percentage')::NUMERIC / 100.0), 2),
        'description', COALESCE(split_item->>'description', '')
      )
    ) as splits_with_amounts
  FROM sample_sale s
  CROSS JOIN rule_data r
  CROSS JOIN LATERAL jsonb_array_elements(r.split_categories) AS split_item
  GROUP BY s.id
)
SELECT 
  cs.sale_id,
  jsonb_pretty(cs.splits_with_amounts) as converted_splits,
  (SELECT * FROM split_pos_sale(cs.sale_id, cs.splits_with_amounts)) as split_result
FROM converted_splits cs;
