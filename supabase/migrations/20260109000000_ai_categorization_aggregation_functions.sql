-- Database functions for aggregated categorization pattern analysis
-- These functions support the AI categorization suggestion system by:
-- 1. Aggregating similar transactions/sales to reduce token usage
-- 2. Excluding items already covered by existing active rules
-- 3. Providing occurrence counts for impact-based prioritization
-- 4. Expanding time range to 12 months for better pattern recognition

-- ============================================================
-- Function: get_uncovered_pos_patterns
-- Purpose: Returns aggregated POS sales patterns not covered by existing rules
-- ============================================================
CREATE OR REPLACE FUNCTION get_uncovered_pos_patterns(
  p_restaurant_id UUID,
  p_limit INT DEFAULT 200
)
RETURNS TABLE (
  item_name TEXT,
  pos_category TEXT,
  typical_price NUMERIC,
  category_code TEXT,
  category_name TEXT,
  occurrence_count BIGINT,
  date_range TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH existing_rules AS (
    -- Get all active POS rules for this restaurant
    SELECT 
      cr.item_name_pattern,
      cr.item_name_match_type,
      cr.pos_category as rule_pos_category
    FROM categorization_rules cr
    WHERE cr.restaurant_id = p_restaurant_id
      AND cr.applies_to IN ('pos_sales', 'both')
      AND cr.is_active = true
  ),
  aggregated_sales AS (
    SELECT 
      us.item_name,
      us.pos_category,
      ROUND(us.total_price::numeric, 2) as typical_price,
      coa.account_code as category_code,
      coa.account_name as category_name,
      COUNT(*) as occurrence_count,
      MIN(us.sale_date) as first_sale,
      MAX(us.sale_date) as last_sale
    FROM unified_sales us
    LEFT JOIN chart_of_accounts coa ON us.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.is_categorized = true
      AND us.category_id IS NOT NULL
      AND us.sale_date >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY us.item_name, us.pos_category, ROUND(us.total_price::numeric, 2), 
             coa.account_code, coa.account_name
  )
  SELECT 
    a.item_name,
    a.pos_category,
    a.typical_price,
    a.category_code,
    a.category_name,
    a.occurrence_count,
    a.first_sale::text || ' to ' || a.last_sale::text as date_range
  FROM aggregated_sales a
  WHERE NOT EXISTS (
    -- Exclude items that match existing rules
    SELECT 1 FROM existing_rules r
    WHERE (
      (r.item_name_match_type = 'exact' AND LOWER(a.item_name) = LOWER(r.item_name_pattern))
      OR (r.item_name_match_type = 'contains' AND LOWER(a.item_name) LIKE '%' || LOWER(r.item_name_pattern) || '%')
      OR (r.item_name_match_type = 'starts_with' AND LOWER(a.item_name) LIKE LOWER(r.item_name_pattern) || '%')
      OR (r.item_name_match_type = 'ends_with' AND LOWER(a.item_name) LIKE '%' || LOWER(r.item_name_pattern))
      OR (r.rule_pos_category IS NOT NULL AND LOWER(a.pos_category) = LOWER(r.rule_pos_category))
    )
  )
  ORDER BY a.occurrence_count DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_uncovered_pos_patterns(UUID, INT) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION get_uncovered_pos_patterns IS 
'Returns aggregated POS sales patterns not covered by existing categorization rules. 
Used by AI suggestion system to identify high-impact rule opportunities.
Aggregates by item_name, pos_category, and rounded price over last 12 months.
Excludes items matching active rules to avoid duplicate suggestions.
Results ordered by occurrence count (highest impact first).';

-- ============================================================
-- Function: get_uncovered_bank_patterns
-- Purpose: Returns aggregated bank transaction patterns not covered by existing rules
-- ============================================================
CREATE OR REPLACE FUNCTION get_uncovered_bank_patterns(
  p_restaurant_id UUID,
  p_limit INT DEFAULT 200
)
RETURNS TABLE (
  description TEXT,
  merchant_name TEXT,
  normalized_payee TEXT,
  typical_amount NUMERIC,
  amount_range TEXT,
  category_code TEXT,
  category_name TEXT,
  occurrence_count BIGINT,
  date_range TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH existing_rules AS (
    -- Get all active bank transaction rules for this restaurant
    SELECT 
      cr.description_pattern,
      cr.description_match_type,
      cr.supplier_id,
      cr.amount_min,
      cr.amount_max
    FROM categorization_rules cr
    WHERE cr.restaurant_id = p_restaurant_id
      AND cr.applies_to IN ('bank_transactions', 'both')
      AND cr.is_active = true
  ),
  aggregated_transactions AS (
    SELECT 
      bt.description,
      bt.merchant_name,
      bt.normalized_payee,
      ROUND(AVG(bt.amount)::numeric, 2) as typical_amount,
      ROUND(MIN(bt.amount)::numeric, 2) as min_amount,
      ROUND(MAX(bt.amount)::numeric, 2) as max_amount,
      coa.account_code as category_code,
      coa.account_name as category_name,
      COUNT(*) as occurrence_count,
      MIN(bt.transaction_date) as first_transaction,
      MAX(bt.transaction_date) as last_transaction
    FROM bank_transactions bt
    LEFT JOIN chart_of_accounts coa ON bt.category_id = coa.id
    WHERE bt.restaurant_id = p_restaurant_id
      AND bt.is_categorized = true
      AND bt.category_id IS NOT NULL
      AND bt.transaction_date >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY bt.description, bt.merchant_name, bt.normalized_payee,
             coa.account_code, coa.account_name
  )
  SELECT 
    a.description,
    a.merchant_name,
    a.normalized_payee,
    a.typical_amount,
    '$' || a.min_amount::text || ' - $' || a.max_amount::text as amount_range,
    a.category_code,
    a.category_name,
    a.occurrence_count,
    a.first_transaction::text || ' to ' || a.last_transaction::text as date_range
  FROM aggregated_transactions a
  WHERE NOT EXISTS (
    -- Exclude transactions that match existing rules
    SELECT 1 FROM existing_rules r
    WHERE (
      (r.description_match_type = 'exact' AND LOWER(a.description) = LOWER(r.description_pattern))
      OR (r.description_match_type = 'contains' AND LOWER(a.description) LIKE '%' || LOWER(r.description_pattern) || '%')
      OR (r.description_match_type = 'starts_with' AND LOWER(a.description) LIKE LOWER(r.description_pattern) || '%')
      OR (r.description_match_type = 'ends_with' AND LOWER(a.description) LIKE '%' || LOWER(r.description_pattern))
      OR (
        r.amount_min IS NOT NULL 
        AND r.amount_max IS NOT NULL 
        AND a.typical_amount >= r.amount_min 
        AND a.typical_amount <= r.amount_max
      )
    )
  )
  ORDER BY a.occurrence_count DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_uncovered_bank_patterns(UUID, INT) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION get_uncovered_bank_patterns IS 
'Returns aggregated bank transaction patterns not covered by existing categorization rules.
Used by AI suggestion system to identify high-impact rule opportunities.
Aggregates by description, merchant_name, normalized_payee over last 12 months.
Excludes transactions matching active rules to avoid duplicate suggestions.
Results ordered by occurrence count (highest impact first).';
