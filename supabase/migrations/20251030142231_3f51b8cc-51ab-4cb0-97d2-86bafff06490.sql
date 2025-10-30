-- Add categorization and split support to unified_sales
ALTER TABLE unified_sales 
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS suggested_category_id UUID REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS ai_confidence TEXT CHECK (ai_confidence IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS ai_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS is_categorized BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_split BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS item_type TEXT CHECK (item_type IN ('sale', 'tip', 'tax', 'discount', 'comp', 'service_charge', 'other')) DEFAULT 'sale';

-- Create index for categorization queries
CREATE INDEX IF NOT EXISTS idx_unified_sales_categorization 
  ON unified_sales(restaurant_id, is_categorized, item_type);

-- Create index for AI suggestions
CREATE INDEX IF NOT EXISTS idx_unified_sales_ai_suggestions 
  ON unified_sales(restaurant_id, suggested_category_id) 
  WHERE suggested_category_id IS NOT NULL AND is_categorized = false;

-- Create unified_sales_splits table
CREATE TABLE IF NOT EXISTS unified_sales_splits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES unified_sales(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE unified_sales_splits ENABLE ROW LEVEL SECURITY;

-- RLS Policies for splits
CREATE POLICY "Users can view splits for their restaurants"
ON unified_sales_splits FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM unified_sales us
    JOIN user_restaurants ur ON us.restaurant_id = ur.restaurant_id
    WHERE us.id = unified_sales_splits.sale_id 
    AND ur.user_id = auth.uid()
  )
);

CREATE POLICY "Owners and managers can manage sales splits"
ON unified_sales_splits FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM unified_sales us
    JOIN user_restaurants ur ON us.restaurant_id = ur.restaurant_id
    WHERE us.id = unified_sales_splits.sale_id 
    AND ur.user_id = auth.uid()
    AND ur.role IN ('owner', 'manager')
  )
);

-- Index for performance
CREATE INDEX idx_unified_sales_splits_sale ON unified_sales_splits(sale_id);
CREATE INDEX idx_unified_sales_splits_category ON unified_sales_splits(category_id);

-- Update RLS policy for unified_sales to allow categorization updates
CREATE POLICY "Owners and managers can update sales categorization"
ON unified_sales FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = unified_sales.restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
  )
);

-- Function: categorize_pos_sale
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
    ai_reasoning = NULL,
    updated_at = now()
  WHERE id = p_sale_id;
END;
$$;

-- Function: split_pos_sale
CREATE OR REPLACE FUNCTION split_pos_sale(
  p_sale_id UUID,
  p_splits JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale_record unified_sales%ROWTYPE;
  v_total_split_amount NUMERIC := 0;
  v_split JSONB;
BEGIN
  -- Get the sale record
  SELECT * INTO v_sale_record
  FROM unified_sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  -- Calculate total split amount
  FOR v_split IN SELECT jsonb_array_elements(p_splits)
  LOOP
    v_total_split_amount := v_total_split_amount + (v_split->>'amount')::NUMERIC;
  END LOOP;

  -- Validate that splits equal total_price
  IF ABS(v_total_split_amount - COALESCE(v_sale_record.total_price, 0)) > 0.01 THEN
    RAISE EXCEPTION 'Split amounts must equal total sale price. Expected: %, Got: %', 
      COALESCE(v_sale_record.total_price, 0), v_total_split_amount;
  END IF;

  -- Delete existing splits if any
  DELETE FROM unified_sales_splits WHERE sale_id = p_sale_id;

  -- Insert new splits
  FOR v_split IN SELECT jsonb_array_elements(p_splits)
  LOOP
    INSERT INTO unified_sales_splits (sale_id, category_id, amount, description)
    VALUES (
      p_sale_id,
      (v_split->>'category_id')::UUID,
      (v_split->>'amount')::NUMERIC,
      v_split->>'description'
    );
  END LOOP;

  -- Mark sale as split and categorized
  UPDATE unified_sales
  SET 
    is_split = true,
    is_categorized = true,
    suggested_category_id = NULL,
    ai_confidence = NULL,
    ai_reasoning = NULL,
    updated_at = now()
  WHERE id = p_sale_id;
END;
$$;