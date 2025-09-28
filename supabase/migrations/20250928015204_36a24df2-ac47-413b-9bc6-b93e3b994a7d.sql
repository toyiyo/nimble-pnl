-- Add full-text search capabilities to products table
-- Add search vector column for full-text search
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create GIN index for full-text search performance
CREATE INDEX IF NOT EXISTS products_search_vector_idx ON products USING GIN(search_vector);

-- Create or replace function to update search vector
CREATE OR REPLACE FUNCTION public.update_products_search_vector()
RETURNS trigger AS $$
BEGIN
  -- Create tsvector from multiple fields with different weights
  NEW.search_vector := setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
                       setweight(to_tsvector('english', COALESCE(NEW.brand, '')), 'B') ||
                       setweight(to_tsvector('english', COALESCE(NEW.category, '')), 'C') ||
                       setweight(to_tsvector('english', COALESCE(NEW.sku, '')), 'D') ||
                       setweight(to_tsvector('english', COALESCE(NEW.supplier_name, '')), 'D') ||
                       setweight(to_tsvector('english', array_to_string(COALESCE(NEW.receipt_item_names, '{}'), ' ')), 'B');
  
  -- Also update the searchable_text for backward compatibility
  NEW.searchable_text := lower(regexp_replace(
    coalesce(NEW.name,'') || ' ' || 
    coalesce(NEW.brand,'') || ' ' || 
    coalesce(NEW.category,'') || ' ' ||
    coalesce(NEW.supplier_name,'') || ' ' ||
    array_to_string(coalesce(NEW.receipt_item_names, '{}'), ' '),
    '[^a-zA-Z0-9 ]','','g'
  ));
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic search vector updates
DROP TRIGGER IF EXISTS products_search_vector_trigger ON products;
CREATE TRIGGER products_search_vector_trigger
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_products_search_vector();

-- Update existing products to populate search_vector
UPDATE products SET search_vector = 
  setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(brand, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(category, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(sku, '')), 'D') ||
  setweight(to_tsvector('english', COALESCE(supplier_name, '')), 'D') ||
  setweight(to_tsvector('english', array_to_string(COALESCE(receipt_item_names, '{}'), ' ')), 'B')
WHERE search_vector IS NULL;

-- Enhanced full-text search function
CREATE OR REPLACE FUNCTION public.fulltext_product_search(
  p_restaurant_id uuid, 
  p_search_term text, 
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  id uuid, 
  name text, 
  sku text, 
  brand text,
  category text,
  current_stock numeric, 
  uom_purchase text, 
  receipt_item_names text[], 
  similarity_score real,
  match_type text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  search_query tsquery;
  plain_query tsquery;
BEGIN
  -- Create search query with multiple strategies
  search_query := plainto_tsquery('english', p_search_term);
  plain_query := to_tsquery('english', regexp_replace(trim(p_search_term), '\s+', ' & ', 'g') || ':*');
  
  RETURN QUERY
  WITH fulltext_results AS (
    -- Full-text search with ranking
    SELECT 
      p.id,
      p.name,
      p.sku,
      p.brand,
      p.category,
      p.current_stock,
      p.uom_purchase,
      p.receipt_item_names,
      -- Use ts_rank for scoring with normalization
      ts_rank_cd(p.search_vector, search_query, 32) as ft_score,
      'fulltext' as match_type
    FROM products p
    WHERE p.restaurant_id = p_restaurant_id
      AND p.search_vector @@ search_query
    
    UNION ALL
    
    -- Prefix search for partial matches
    SELECT 
      p.id,
      p.name,
      p.sku,
      p.brand,
      p.category,
      p.current_stock,
      p.uom_purchase,
      p.receipt_item_names,
      ts_rank_cd(p.search_vector, plain_query, 32) * 0.8 as ft_score, -- Slightly lower weight
      'prefix' as match_type
    FROM products p
    WHERE p.restaurant_id = p_restaurant_id
      AND p.search_vector @@ plain_query
      AND NOT EXISTS (
        SELECT 1 FROM products p2 
        WHERE p2.id = p.id AND p2.search_vector @@ search_query
      )
    
    UNION ALL
    
    -- Fallback to ILIKE for very short terms or when no FT results
    SELECT 
      p.id,
      p.name,
      p.sku,
      p.brand,
      p.category,
      p.current_stock,
      p.uom_purchase,
      p.receipt_item_names,
      0.3 as ft_score, -- Lower score for fallback matches
      'ilike_fallback' as match_type
    FROM products p
    WHERE p.restaurant_id = p_restaurant_id
      AND (
        p.name ILIKE '%' || p_search_term || '%'
        OR p.brand ILIKE '%' || p_search_term || '%'
        OR p.sku ILIKE '%' || p_search_term || '%'
        OR EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE receipt_name ILIKE '%' || p_search_term || '%'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM products p2 
        WHERE p2.id = p.id 
          AND (p2.search_vector @@ search_query OR p2.search_vector @@ plain_query)
      )
  )
  SELECT 
    fr.id,
    fr.name,
    fr.sku,
    fr.brand,
    fr.category,
    fr.current_stock,
    fr.uom_purchase,
    fr.receipt_item_names,
    fr.ft_score::real as similarity_score,
    fr.match_type
  FROM fulltext_results fr
  ORDER BY 
    fr.ft_score DESC,
    length(fr.name) ASC  -- Prefer shorter names when scores are equal
  LIMIT p_limit;
END;
$$;