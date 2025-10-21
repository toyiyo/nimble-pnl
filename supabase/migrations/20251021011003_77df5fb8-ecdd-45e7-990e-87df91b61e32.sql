-- Add SET search_path to suggest_supplier_for_payee for security
CREATE OR REPLACE FUNCTION suggest_supplier_for_payee(
  p_restaurant_id uuid,
  p_payee_name text
)
RETURNS TABLE (
  supplier_id uuid,
  supplier_name text,
  match_confidence numeric,
  match_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH all_matches AS (
    -- Exact matches on supplier name
    SELECT 
      s.id as supplier_id,
      s.name as supplier_name,
      1.0::numeric as match_confidence,
      'exact'::text as match_type
    FROM suppliers s
    WHERE s.restaurant_id = p_restaurant_id
      AND s.is_active = true
      AND LOWER(s.name) = LOWER(p_payee_name)

    UNION ALL

    -- Exact matches on name variations
    SELECT 
      s.id,
      s.name,
      0.95::numeric,
      'alias'::text
    FROM suppliers s
    JOIN supplier_name_variations snv ON snv.supplier_id = s.id
    WHERE s.restaurant_id = p_restaurant_id
      AND s.is_active = true
      AND snv.match_type = 'exact'
      AND LOWER(snv.name_variation) = LOWER(p_payee_name)

    UNION ALL

    -- Fuzzy matches (contains)
    SELECT 
      s.id,
      s.name,
      0.7::numeric,
      'fuzzy'::text
    FROM suppliers s
    WHERE s.restaurant_id = p_restaurant_id
      AND s.is_active = true
      AND (
        LOWER(p_payee_name) LIKE '%' || LOWER(s.name) || '%'
        OR LOWER(s.name) LIKE '%' || LOWER(p_payee_name) || '%'
      )
  )
  SELECT * FROM all_matches
  ORDER BY match_confidence DESC, supplier_name
  LIMIT 5;
END;
$$;