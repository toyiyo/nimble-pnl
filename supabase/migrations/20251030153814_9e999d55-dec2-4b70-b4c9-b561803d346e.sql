-- Fix categorize_pos_sale function - remove updated_at column that doesn't exist
DROP FUNCTION IF EXISTS categorize_pos_sale(UUID, UUID);

CREATE OR REPLACE FUNCTION categorize_pos_sale(
  p_sale_id UUID,
  p_category_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE unified_sales
  SET 
    category_id = p_category_id,
    is_categorized = true,
    suggested_category_id = NULL,
    ai_confidence = NULL,
    ai_reasoning = NULL
  WHERE id = p_sale_id;
END;
$$;