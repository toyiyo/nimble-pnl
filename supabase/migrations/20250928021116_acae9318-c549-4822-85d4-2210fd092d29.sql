-- Drop and recreate the advanced product search function with improved matching
DROP FUNCTION IF EXISTS public.advanced_product_search(uuid,text,double precision,integer);

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
  brand text,
  category text,
  current_stock numeric, 
  uom_purchase text, 
  receipt_item_names text[], 
  similarity_score real,
  levenshtein_score real,
  combined_score real,
  match_type text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_term TEXT;
BEGIN
  -- Normalize the search term (same logic as searchable_text)
  normalized_term := lower(regexp_replace(p_search_term, '[^a-zA-Z0-9 ]','','g'));
  
  RETURN QUERY
  WITH candidates AS (
    -- Stage 1: Candidate generation using multiple methods
    SELECT DISTINCT
      p.id,
      p.name,
      p.sku,
      p.brand,
      p.category,
      p.current_stock,
      p.uom_purchase,
      p.receipt_item_names,
      -- Trigram similarity scores (with fallback)
      COALESCE(similarity(p.searchable_text, normalized_term), 0.0)::real as trgm_score,
      -- Exact match bonuses with better scoring for very similar names
      CASE 
        WHEN lower(p.name) = lower(p_search_term) THEN 1.0
        WHEN p.searchable_text = normalized_term THEN 1.0
        WHEN p.searchable_text LIKE normalized_term || '%' THEN 0.9
        WHEN EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE lower(receipt_name) = lower(p_search_term)
        ) THEN 0.95
        -- NEW: Add bonus for very similar names (like PREST vs Prst)
        WHEN levenshtein(lower(p.name), lower(p_search_term)) <= 3 
             AND length(p.name) > 10 THEN 0.85  -- For long similar names
        ELSE 0.0
      END::real as exact_bonus,
      -- Match type for debugging
      CASE 
        WHEN lower(p.name) = lower(p_search_term) THEN 'exact'
        WHEN p.searchable_text = normalized_term THEN 'exact'
        WHEN p.searchable_text LIKE normalized_term || '%' THEN 'prefix'
        WHEN EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE lower(receipt_name) = lower(p_search_term)
        ) THEN 'receipt_exact'
        WHEN levenshtein(lower(p.name), lower(p_search_term)) <= 3 
             AND length(p.name) > 10 THEN 'very_similar'
        WHEN similarity(p.searchable_text, normalized_term) > p_similarity_threshold THEN 'trigram'
        ELSE 'fallback'
      END as match_type
    FROM products p
    WHERE p.restaurant_id = p_restaurant_id
      AND (
        -- Exact matches
        lower(p.name) = lower(p_search_term)
        OR p.searchable_text = normalized_term
        OR p.searchable_text LIKE normalized_term || '%'
        -- Very similar names (like PREST vs Prst)
        OR (levenshtein(lower(p.name), lower(p_search_term)) <= 3 AND length(p.name) > 10)
        -- Trigram matches (with safe fallback)
        OR (similarity(p.searchable_text, normalized_term) > p_similarity_threshold)
        -- Receipt name exact matches
        OR EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE lower(receipt_name) = lower(p_search_term)
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
        ELSE LEAST(1.0, 1.0 - (levenshtein(lower(c.name), lower(p_search_term))::float / 
                   GREATEST(length(c.name), length(p_search_term))))
      END::real as lev_score,
      -- Combined weighted score - CAPPED at 1.0
      LEAST(1.0, 
        (c.trgm_score * 0.3 + 
         c.exact_bonus * 0.5 + 
         (CASE 
           WHEN length(c.name) = 0 OR length(p_search_term) = 0 THEN 0.0
           ELSE LEAST(1.0, 1.0 - (levenshtein(lower(c.name), lower(p_search_term))::float / 
                      GREATEST(length(c.name), length(p_search_term))))
         END) * 0.2)
      )::real as final_score
    FROM candidates c
  )
  SELECT 
    s.id,
    s.name,
    s.sku,
    s.brand,
    s.category,
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