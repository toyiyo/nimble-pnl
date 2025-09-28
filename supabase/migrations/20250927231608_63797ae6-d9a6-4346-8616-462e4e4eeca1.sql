-- Create abbreviation mapping table for OCR normalization
CREATE TABLE IF NOT EXISTS product_abbreviations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  abbreviation TEXT NOT NULL,
  full_term TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(restaurant_id, abbreviation)
);

-- Enable RLS on abbreviations table (only if not already enabled)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE tablename = 'product_abbreviations' 
    AND rowsecurity = true
  ) THEN
    ALTER TABLE product_abbreviations ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Drop existing policy if it exists and create new one
DROP POLICY IF EXISTS "Users can manage abbreviations for their restaurants" ON product_abbreviations;
CREATE POLICY "Users can manage abbreviations for their restaurants" 
ON product_abbreviations FOR ALL
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE restaurant_id = product_abbreviations.restaurant_id 
  AND user_id = auth.uid() 
  AND role = ANY(ARRAY['owner', 'manager', 'chef'])
));

-- Advanced fuzzy search function with hybrid scoring
CREATE OR REPLACE FUNCTION advanced_product_search(
  p_restaurant_id UUID,
  p_search_term TEXT,
  p_similarity_threshold FLOAT DEFAULT 0.25,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  sku TEXT,
  current_stock NUMERIC,
  uom_purchase TEXT,
  receipt_item_names TEXT[],
  similarity_score FLOAT,
  levenshtein_score FLOAT,
  combined_score FLOAT,
  match_type TEXT
) 
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_term TEXT;
BEGIN
  -- Normalize the search term (same logic as searchable_text)
  normalized_term := lower(regexp_replace(unaccent(p_search_term), '[^a-z0-9 ]','','g'));
  
  -- Set similarity threshold for this query
  PERFORM set_config('pg_trgm.similarity_threshold', p_similarity_threshold::text, true);
  
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
      -- Trigram similarity scores
      GREATEST(
        similarity(p.searchable_text, normalized_term),
        word_similarity(p.searchable_text, normalized_term)
      ) as trgm_score,
      -- Exact match bonuses
      CASE 
        WHEN p.searchable_text = normalized_term THEN 1.0
        WHEN p.searchable_text LIKE normalized_term || '%' THEN 0.9
        WHEN EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE lower(unaccent(receipt_name)) = p_search_term
        ) THEN 0.95
        ELSE 0.0
      END as exact_bonus,
      -- Match type for debugging
      CASE 
        WHEN p.searchable_text = normalized_term THEN 'exact'
        WHEN p.searchable_text LIKE normalized_term || '%' THEN 'prefix'
        WHEN EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE lower(unaccent(receipt_name)) = p_search_term
        ) THEN 'receipt_exact'
        WHEN p.searchable_text % normalized_term THEN 'trigram'
        WHEN p.searchable_text %% normalized_term THEN 'word_trigram'
        ELSE 'fallback'
      END as match_type
    FROM products p
    WHERE p.restaurant_id = p_restaurant_id
      AND (
        -- Exact matches
        p.searchable_text = normalized_term
        OR p.searchable_text LIKE normalized_term || '%'
        -- Trigram matches
        OR p.searchable_text % normalized_term
        OR p.searchable_text %% normalized_term
        -- Receipt name exact matches
        OR EXISTS (
          SELECT 1 FROM unnest(p.receipt_item_names) AS receipt_name
          WHERE lower(unaccent(receipt_name)) = p_search_term
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