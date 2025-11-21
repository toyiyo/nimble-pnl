-- Update split_pos_sale to write to unified_sales_splits table instead of creating child unified_sales rows
-- This keeps revenue line items normalized and lets the dashboard pull split metadata consistently.
DROP FUNCTION IF EXISTS split_pos_sale(UUID, JSONB);

CREATE OR REPLACE FUNCTION split_pos_sale(
  p_sale_id UUID,
  p_splits JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_record unified_sales%ROWTYPE;
  v_split JSONB;
  v_total_split_amount NUMERIC := 0;
  v_split_amount NUMERIC;
  v_category_id UUID;
  v_description TEXT;
  v_tolerance NUMERIC;
  v_amount_key CONSTANT TEXT := 'amount';
  v_category_key CONSTANT TEXT := 'category_id';
  v_description_key CONSTANT TEXT := 'description';
BEGIN
  -- Fetch the sale and validate it exists
  SELECT * INTO v_sale_record
  FROM unified_sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  -- Ensure caller has permission to manage this restaurant's sales
  IF NOT EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE restaurant_id = v_sale_record.restaurant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user cannot split sales for this restaurant';
  END IF;

  -- Validate split payload shape
  IF p_splits IS NULL OR jsonb_typeof(p_splits) <> 'array' THEN
    RAISE EXCEPTION 'Invalid splits: must be a JSON array';
  END IF;

  IF jsonb_array_length(p_splits) = 0 THEN
    RAISE EXCEPTION 'Invalid splits: array cannot be empty';
  END IF;

  -- Validate each split entry
  FOR v_split IN SELECT jsonb_array_elements(p_splits)
  LOOP
    IF NOT (v_split ? v_amount_key AND v_split ? v_category_key) THEN
      RAISE EXCEPTION 'Invalid split: missing required fields (amount, category_id)';
    END IF;

    IF NOT (v_split->>v_amount_key ~ '^[+-]?\\d+(\\.\\d+)?$') THEN
      RAISE EXCEPTION 'Invalid split: amount must be numeric, got: %', v_split->>v_amount_key;
    END IF;

    v_split_amount := (v_split->>v_amount_key)::NUMERIC;
    IF v_split_amount = 0 THEN
      RAISE EXCEPTION 'Invalid split: amount cannot be zero';
    END IF;

    BEGIN
      v_category_id := (v_split->>v_category_key)::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid split: category_id must be a valid UUID, got: %', v_split->>v_category_key;
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM chart_of_accounts
      WHERE id = v_category_id
        AND restaurant_id = v_sale_record.restaurant_id
    ) THEN
      RAISE EXCEPTION 'Invalid split: category % does not belong to this restaurant', v_category_id;
    END IF;

    v_total_split_amount := v_total_split_amount + v_split_amount;
  END LOOP;

  v_tolerance := GREATEST(0.01, COALESCE(v_sale_record.total_price, 0) * 0.005);

  IF ABS(v_total_split_amount - COALESCE(v_sale_record.total_price, 0)) > v_tolerance THEN
    RAISE EXCEPTION 'Split amounts must equal total sale price. Expected: %, got: %',
      COALESCE(v_sale_record.total_price, 0), v_total_split_amount;
  END IF;

  -- Remove any legacy child sale rows and existing split records for this sale
  DELETE FROM unified_sales WHERE parent_sale_id = p_sale_id;
  DELETE FROM unified_sales_splits WHERE sale_id = p_sale_id;

  -- Insert the normalized split rows
  FOR v_split IN SELECT jsonb_array_elements(p_splits)
  LOOP
  v_split_amount := (v_split->>v_amount_key)::NUMERIC;
  v_category_id := (v_split->>v_category_key)::UUID;
  v_description := NULLIF(btrim(v_split->>v_description_key), '');

    INSERT INTO unified_sales_splits (
      sale_id,
      category_id,
      amount,
      description
    )
    VALUES (
      p_sale_id,
      v_category_id,
      v_split_amount,
      COALESCE(v_description, v_sale_record.item_name)
    );
  END LOOP;

  -- Mark the sale as split/categorized so it no longer shows as pending
  UPDATE unified_sales
  SET
    is_split = true,
    is_categorized = true,
    category_id = NULL,
    suggested_category_id = NULL,
    ai_confidence = NULL,
    ai_reasoning = NULL,
    updated_at = now()
  WHERE id = p_sale_id;
END;
$$;

COMMENT ON FUNCTION split_pos_sale(UUID, JSONB) IS
'Normalizes POS sale splits into unified_sales_splits. Validates payload, enforces restaurant ownership, and deletes legacy child sale rows before inserting split metadata.';
