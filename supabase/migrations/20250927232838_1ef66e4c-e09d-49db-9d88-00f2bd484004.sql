-- Fix the advanced_product_search function to handle missing operators gracefully
CREATE OR REPLACE FUNCTION public.advanced_product_search(
  p_restaurant_id uuid, 
  p_search_term text, 
  p_similarity_threshold double precision DEFAULT 0.25, 
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  id uuid, 
  name text, 
  sku text, 
  current_stock numeric, 
  uom_purchase text, 
  receipt_item_names text[], 
  similarity_score double precision, 
  levenshtein_score double precision, 
  combined_score double precision, 
  match_type text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  normalized_term TEXT;
BEGIN
  -- Normalize the search term (same logic as searchable_text)
  normalized_term := lower(regexp_replace(unaccent(p_search_term), '[^a-z0-9 ]','','g'));
  
  RETURN QUERY
  WITH candidates AS (
    -- Stage 1: Candidate generation using multiple methods
    SELECT DISTINCT
      p.id,
      p.name,
      p.sku,
      p.current_stock,
      p.uom_purchase,
      p.receipt_item_names,
      -- Trigram similarity scores (with fallback)
      COALESCE(similarity(p.searchable_text, normalized_term), 0.0) as trgm_score,
      -- Exact match bonuses
      CASE 
        WHEN p.searchable_text = normalized_term THEN 1.0
        WHEN p.searchable_text LIKE normalized_term || '%' THEN 0.9
        WHEN EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE lower(unaccent(receipt_name)) = lower(p_search_term)
        ) THEN 0.95
        ELSE 0.0
      END as exact_bonus,
      -- Match type for debugging
      CASE 
        WHEN p.searchable_text = normalized_term THEN 'exact'
        WHEN p.searchable_text LIKE normalized_term || '%' THEN 'prefix'
        WHEN EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE lower(unaccent(receipt_name)) = lower(p_search_term)
        ) THEN 'receipt_exact'
        WHEN similarity(p.searchable_text, normalized_term) > p_similarity_threshold THEN 'trigram'
        ELSE 'fallback'
      END as match_type
    FROM products p
    WHERE p.restaurant_id = p_restaurant_id
      AND (
        -- Exact matches
        p.searchable_text = normalized_term
        OR p.searchable_text LIKE normalized_term || '%'
        -- Trigram matches (with safe fallback)
        OR (similarity(p.searchable_text, normalized_term) > p_similarity_threshold)
        -- Receipt name exact matches
        OR EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE lower(unaccent(receipt_name)) = lower(p_search_term)
        )
        -- Fallback ILIKE for partial matches
        OR p.searchable_text ILIKE '%' || normalized_term || '%'
      )
  ),
  scored AS (
    -- Stage 2: Re-ranking with Levenshtein distance
    SELECT 
      c.*,
      -- Levenshtein distance normalized to 0-1 score
      CASE 
        WHEN length(c.name) = 0 OR length(p_search_term) = 0 THEN 0.0
        ELSE 1.0 - (levenshtein(lower(unaccent(c.name)), normalized_term)::float / 
                   GREATEST(length(c.name), length(p_search_term)))
      END as lev_score,
      -- Combined weighted score
      (c.trgm_score * 0.4 + 
       c.exact_bonus * 0.4 + 
       (CASE 
         WHEN length(c.name) = 0 OR length(p_search_term) = 0 THEN 0.0
         ELSE 1.0 - (levenshtein(lower(unaccent(c.name)), normalized_term)::float / 
                    GREATEST(length(c.name), length(p_search_term)))
       END) * 0.2) as final_score
    FROM candidates c
  )
  SELECT 
    s.id,
    s.name,
    s.sku,
    s.current_stock,
    s.uom_purchase,
    s.receipt_item_names,
    s.trgm_score,
    s.lev_score,
    s.final_score,
    s.match_type
  FROM scored s
  WHERE s.final_score > 0.1  -- Filter out very low scores
  ORDER BY 
    s.final_score DESC,
    s.exact_bonus DESC,
    s.trgm_score DESC,
    length(s.name) ASC  -- Prefer shorter names when scores are equal
  LIMIT p_limit;
END;
$$;