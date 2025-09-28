-- Add fields to products table to store receipt item mappings for auto-matching
ALTER TABLE products ADD COLUMN receipt_item_names TEXT[] DEFAULT '{}';

-- Add a simple text search function for product matching
CREATE OR REPLACE FUNCTION search_products_by_name(
  p_restaurant_id UUID,
  p_search_term TEXT
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  sku TEXT,
  current_stock NUMERIC,
  uom_purchase TEXT,
  receipt_item_names TEXT[]
) 
LANGUAGE SQL
STABLE
AS $$
  SELECT 
    p.id,
    p.name,
    p.sku,
    p.current_stock,
    p.uom_purchase,
    p.receipt_item_names
  FROM products p
  WHERE p.restaurant_id = p_restaurant_id
    AND (
      p.name ILIKE '%' || p_search_term || '%'
      OR EXISTS (
        SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
        WHERE receipt_name ILIKE '%' || p_search_term || '%'
      )
      OR p.sku ILIKE '%' || p_search_term || '%'
    )
  ORDER BY 
    CASE WHEN p.name ILIKE p_search_term || '%' THEN 1 ELSE 2 END,
    p.name
  LIMIT 20;
$$;