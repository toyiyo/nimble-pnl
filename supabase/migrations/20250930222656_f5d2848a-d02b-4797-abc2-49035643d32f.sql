-- Fix GTIN normalization for future scans only (do NOT modify existing data)
-- This migration creates a helper function for GTIN lookup that handles both formats

-- Create a function to calculate GS1 check digit
CREATE OR REPLACE FUNCTION calculate_gs1_check_digit(base13 TEXT)
RETURNS TEXT AS $$
DECLARE
  digit INT;
  multiplier INT;
  sum INT := 0;
  check_digit INT;
  i INT;
BEGIN
  -- Ensure we have exactly 13 digits
  IF LENGTH(base13) != 13 THEN
    RAISE EXCEPTION 'Expected 13 digits, got %', LENGTH(base13);
  END IF;
  
  -- Calculate weighted sum (from right to left)
  FOR i IN 1..13 LOOP
    digit := CAST(SUBSTRING(base13, i, 1) AS INT);
    
    -- Odd positions (from right) multiply by 3, even by 1
    IF (14 - i) % 2 = 1 THEN
      multiplier := 3;
    ELSE
      multiplier := 1;
    END IF;
    
    sum := sum + (digit * multiplier);
  END LOOP;
  
  -- Calculate check digit
  check_digit := (10 - (sum % 10)) % 10;
  
  RETURN base13 || check_digit::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a helper function to find products by GTIN (handles both original and corrected formats)
CREATE OR REPLACE FUNCTION find_product_by_gtin(
  p_restaurant_id UUID,
  p_scanned_gtin TEXT
)
RETURNS TABLE(
  id UUID,
  name TEXT,
  gtin TEXT,
  current_stock NUMERIC,
  cost_per_unit NUMERIC
) AS $$
DECLARE
  normalized_gtin TEXT;
BEGIN
  -- Try exact match first (fastest)
  RETURN QUERY
  SELECT p.id, p.name, p.gtin, p.current_stock, p.cost_per_unit
  FROM products p
  WHERE p.restaurant_id = p_restaurant_id
    AND p.gtin = p_scanned_gtin
  LIMIT 1;
  
  -- If no exact match, try with corrected check digit
  IF NOT FOUND THEN
    -- Strip any check digit and recalculate
    normalized_gtin := calculate_gs1_check_digit(
      LPAD(REGEXP_REPLACE(p_scanned_gtin, '^0+', ''), 13, '0')
    );
    
    RETURN QUERY
    SELECT p.id, p.name, p.gtin, p.current_stock, p.cost_per_unit
    FROM products p
    WHERE p.restaurant_id = p_restaurant_id
      AND p.gtin = normalized_gtin
    LIMIT 1;
  END IF;
  
  -- If still not found, try stripping leading zeros from stored GTINs
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT p.id, p.name, p.gtin, p.current_stock, p.cost_per_unit
    FROM products p
    WHERE p.restaurant_id = p_restaurant_id
      AND REGEXP_REPLACE(p.gtin, '^0+', '') = REGEXP_REPLACE(p_scanned_gtin, '^0+', '')
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION find_product_by_gtin IS 'Finds products by GTIN with flexible matching: exact match, corrected check digit, or by core number (ignoring leading zeros)';
COMMENT ON FUNCTION calculate_gs1_check_digit IS 'Calculates GS1 check digit for 13-digit GTIN base';