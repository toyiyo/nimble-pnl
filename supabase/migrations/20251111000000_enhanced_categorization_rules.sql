-- Enhanced categorization rules system supporting multiple pattern types
-- Replaces the limited supplier-only rules with a flexible pattern-based system

-- Drop old supplier_categorization_rules table (data migration can be done separately if needed)
-- We keep transaction_categorization_rules but enhance it

-- Enhanced categorization rules table
-- This table supports both bank transactions and POS sales
CREATE TABLE IF NOT EXISTS categorization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  
  -- Rule applies to which source
  applies_to TEXT NOT NULL CHECK (applies_to IN ('bank_transactions', 'pos_sales', 'both')),
  
  -- Pattern matching fields
  description_pattern TEXT,
  description_match_type TEXT CHECK (description_match_type IN ('exact', 'contains', 'starts_with', 'ends_with', 'regex')),
  
  amount_min NUMERIC(15, 2),
  amount_max NUMERIC(15, 2),
  
  supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  
  transaction_type TEXT CHECK (transaction_type IN ('debit', 'credit', 'any')),
  
  -- For POS sales
  pos_category TEXT,
  item_name_pattern TEXT,
  item_name_match_type TEXT CHECK (item_name_match_type IN ('exact', 'contains', 'starts_with', 'ends_with', 'regex')),
  
  -- Target category
  category_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  
  -- Rule settings
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_apply BOOLEAN NOT NULL DEFAULT false,
  
  -- Statistics
  apply_count INTEGER NOT NULL DEFAULT 0,
  last_applied_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT at_least_one_pattern CHECK (
    description_pattern IS NOT NULL OR
    amount_min IS NOT NULL OR
    amount_max IS NOT NULL OR
    supplier_id IS NOT NULL OR
    transaction_type IS NOT NULL OR
    pos_category IS NOT NULL OR
    item_name_pattern IS NOT NULL
  )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_categorization_rules_restaurant ON categorization_rules(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_categorization_rules_active ON categorization_rules(restaurant_id, is_active, auto_apply);
CREATE INDEX IF NOT EXISTS idx_categorization_rules_priority ON categorization_rules(restaurant_id, priority DESC);
CREATE INDEX IF NOT EXISTS idx_categorization_rules_supplier ON categorization_rules(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_categorization_rules_applies_to ON categorization_rules(restaurant_id, applies_to);

-- Enable RLS
ALTER TABLE categorization_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies (drop first to avoid conflicts)
DROP POLICY IF EXISTS "Users can view categorization rules for their restaurants" ON categorization_rules;
DROP POLICY IF EXISTS "Owners and managers can manage categorization rules" ON categorization_rules;

CREATE POLICY "Users can view categorization rules for their restaurants"
  ON categorization_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = categorization_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage categorization rules"
  ON categorization_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = categorization_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Trigger to update updated_at (drop first to avoid conflicts)
DROP TRIGGER IF EXISTS update_categorization_rules_updated_at ON categorization_rules;
CREATE TRIGGER update_categorization_rules_updated_at
  BEFORE UPDATE ON categorization_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();

-- Function to check if a bank transaction matches a rule
CREATE OR REPLACE FUNCTION matches_bank_transaction_rule(
  p_rule_id UUID,
  p_transaction JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rule RECORD;
  v_description TEXT;
  v_amount NUMERIC;
  v_supplier_id UUID;
  v_tx_type TEXT;
BEGIN
  -- Get rule details
  SELECT * INTO v_rule
  FROM categorization_rules
  WHERE id = p_rule_id
    AND is_active = true
    AND applies_to IN ('bank_transactions', 'both');
  
  IF v_rule.id IS NULL THEN
    RETURN false;
  END IF;
  
  -- Extract transaction fields
  v_description := COALESCE(p_transaction->>'description', '');
  v_amount := COALESCE((p_transaction->>'amount')::NUMERIC, 0);
  v_supplier_id := CASE 
    WHEN p_transaction->>'supplier_id' IS NOT NULL 
    THEN (p_transaction->>'supplier_id')::UUID 
    ELSE NULL 
  END;
  v_tx_type := CASE 
    WHEN v_amount < 0 THEN 'debit'
    WHEN v_amount > 0 THEN 'credit'
    ELSE 'any'
  END;
  
  -- Check description pattern
  IF v_rule.description_pattern IS NOT NULL THEN
    CASE v_rule.description_match_type
      WHEN 'exact' THEN
        IF LOWER(v_description) != LOWER(v_rule.description_pattern) THEN
          RETURN false;
        END IF;
      WHEN 'contains' THEN
        IF POSITION(LOWER(v_rule.description_pattern) IN LOWER(v_description)) = 0 THEN
          RETURN false;
        END IF;
      WHEN 'starts_with' THEN
        IF NOT (LOWER(v_description) LIKE LOWER(v_rule.description_pattern) || '%') THEN
          RETURN false;
        END IF;
      WHEN 'ends_with' THEN
        IF NOT (LOWER(v_description) LIKE '%' || LOWER(v_rule.description_pattern)) THEN
          RETURN false;
        END IF;
      WHEN 'regex' THEN
        IF NOT (v_description ~ v_rule.description_pattern) THEN
          RETURN false;
        END IF;
    END CASE;
  END IF;
  
  -- Check amount range
  IF v_rule.amount_min IS NOT NULL AND ABS(v_amount) < v_rule.amount_min THEN
    RETURN false;
  END IF;
  
  IF v_rule.amount_max IS NOT NULL AND ABS(v_amount) > v_rule.amount_max THEN
    RETURN false;
  END IF;
  
  -- Check supplier
  IF v_rule.supplier_id IS NOT NULL THEN
    IF v_supplier_id IS NULL OR v_supplier_id != v_rule.supplier_id THEN
      RETURN false;
    END IF;
  END IF;
  
  -- Check transaction type
  IF v_rule.transaction_type IS NOT NULL AND v_rule.transaction_type != 'any' THEN
    IF v_tx_type != v_rule.transaction_type THEN
      RETURN false;
    END IF;
  END IF;
  
  -- All conditions matched
  RETURN true;
END;
$$;

-- Function to check if a POS sale matches a rule
CREATE OR REPLACE FUNCTION matches_pos_sale_rule(
  p_rule_id UUID,
  p_sale JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rule RECORD;
  v_item_name TEXT;
  v_amount NUMERIC;
  v_pos_category TEXT;
BEGIN
  -- Get rule details
  SELECT * INTO v_rule
  FROM categorization_rules
  WHERE id = p_rule_id
    AND is_active = true
    AND applies_to IN ('pos_sales', 'both');
  
  IF v_rule.id IS NULL THEN
    RETURN false;
  END IF;
  
  -- Extract sale fields
  v_item_name := COALESCE(p_sale->>'item_name', '');
  v_amount := COALESCE((p_sale->>'total_price')::NUMERIC, 0);
  v_pos_category := COALESCE(p_sale->>'pos_category', '');
  
  -- Check item name pattern
  IF v_rule.item_name_pattern IS NOT NULL THEN
    CASE v_rule.item_name_match_type
      WHEN 'exact' THEN
        IF LOWER(v_item_name) != LOWER(v_rule.item_name_pattern) THEN
          RETURN false;
        END IF;
      WHEN 'contains' THEN
        IF POSITION(LOWER(v_rule.item_name_pattern) IN LOWER(v_item_name)) = 0 THEN
          RETURN false;
        END IF;
      WHEN 'starts_with' THEN
        IF NOT (LOWER(v_item_name) LIKE LOWER(v_rule.item_name_pattern) || '%') THEN
          RETURN false;
        END IF;
      WHEN 'ends_with' THEN
        IF NOT (LOWER(v_item_name) LIKE '%' || LOWER(v_rule.item_name_pattern)) THEN
          RETURN false;
        END IF;
      WHEN 'regex' THEN
        IF NOT (v_item_name ~ v_rule.item_name_pattern) THEN
          RETURN false;
        END IF;
    END CASE;
  END IF;
  
  -- Check POS category
  IF v_rule.pos_category IS NOT NULL THEN
    IF LOWER(v_pos_category) != LOWER(v_rule.pos_category) THEN
      RETURN false;
    END IF;
  END IF;
  
  -- Check amount range
  IF v_rule.amount_min IS NOT NULL AND ABS(v_amount) < v_rule.amount_min THEN
    RETURN false;
  END IF;
  
  IF v_rule.amount_max IS NOT NULL AND ABS(v_amount) > v_rule.amount_max THEN
    RETURN false;
  END IF;
  
  -- All conditions matched
  RETURN true;
END;
$$;

-- Function to find matching rules for a bank transaction
CREATE OR REPLACE FUNCTION find_matching_rules_for_bank_transaction(
  p_restaurant_id UUID,
  p_transaction JSONB
)
RETURNS TABLE (
  rule_id UUID,
  rule_name TEXT,
  category_id UUID,
  priority INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cr.id,
    cr.rule_name,
    cr.category_id,
    cr.priority
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND cr.applies_to IN ('bank_transactions', 'both')
    AND matches_bank_transaction_rule(cr.id, p_transaction)
  ORDER BY cr.priority DESC, cr.created_at ASC
  LIMIT 1;
END;
$$;

-- Function to find matching rules for a POS sale
CREATE OR REPLACE FUNCTION find_matching_rules_for_pos_sale(
  p_restaurant_id UUID,
  p_sale JSONB
)
RETURNS TABLE (
  rule_id UUID,
  rule_name TEXT,
  category_id UUID,
  priority INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cr.id,
    cr.rule_name,
    cr.category_id,
    cr.priority
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND cr.applies_to IN ('pos_sales', 'both')
    AND matches_pos_sale_rule(cr.id, p_sale)
  ORDER BY cr.priority DESC, cr.created_at ASC
  LIMIT 1;
END;
$$;

-- Function to apply rules to uncategorized bank transactions
CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions(
  p_restaurant_id UUID
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transaction RECORD;
  v_rule RECORD;
  v_applied_count INTEGER := 0;
  v_total_count INTEGER := 0;
  v_transaction_json JSONB;
BEGIN
  -- Get all uncategorized bank transactions
  FOR v_transaction IN
    SELECT id, description, amount, supplier_id
    FROM bank_transactions
    WHERE restaurant_id = p_restaurant_id
      AND (is_categorized = false OR category_id IS NULL)
  LOOP
    v_total_count := v_total_count + 1;
    
    -- Build transaction JSONB for matching
    v_transaction_json := jsonb_build_object(
      'description', v_transaction.description,
      'amount', v_transaction.amount,
      'supplier_id', v_transaction.supplier_id
    );
    
    -- Find matching rule
    SELECT * INTO v_rule
    FROM find_matching_rules_for_bank_transaction(p_restaurant_id, v_transaction_json)
    LIMIT 1;
    
    -- If rule found, categorize the transaction
    IF v_rule.rule_id IS NOT NULL THEN
      BEGIN
        PERFORM categorize_bank_transaction(
          v_transaction.id,
          v_rule.category_id,
          'Auto-categorized by rule: ' || v_rule.rule_name,
          NULL,
          v_transaction.supplier_id
        );
        
        -- Update rule statistics
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
        
        v_applied_count := v_applied_count + 1;
      EXCEPTION WHEN OTHERS THEN
        -- Log error but continue processing
        RAISE NOTICE 'Error categorizing transaction %: %', v_transaction.id, SQLERRM;
      END;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

-- Function to apply rules to uncategorized POS sales
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales(
  p_restaurant_id UUID
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale RECORD;
  v_rule RECORD;
  v_applied_count INTEGER := 0;
  v_total_count INTEGER := 0;
  v_sale_json JSONB;
BEGIN
  -- Get all uncategorized POS sales
  FOR v_sale IN
    SELECT id, item_name, total_price, pos_category
    FROM unified_sales
    WHERE restaurant_id = p_restaurant_id
      AND (is_categorized = false OR category_id IS NULL)
  LOOP
    v_total_count := v_total_count + 1;
    
    -- Build sale JSONB for matching
    v_sale_json := jsonb_build_object(
      'item_name', v_sale.item_name,
      'total_price', v_sale.total_price,
      'pos_category', v_sale.pos_category
    );
    
    -- Find matching rule
    SELECT * INTO v_rule
    FROM find_matching_rules_for_pos_sale(p_restaurant_id, v_sale_json)
    LIMIT 1;
    
    -- If rule found, categorize the sale
    IF v_rule.rule_id IS NOT NULL THEN
      BEGIN
        UPDATE unified_sales
        SET 
          category_id = v_rule.category_id,
          is_categorized = true,
          updated_at = now()
        WHERE id = v_sale.id;
        
        -- Update rule statistics
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
        
        v_applied_count := v_applied_count + 1;
      EXCEPTION WHEN OTHERS THEN
        -- Log error but continue processing
        RAISE NOTICE 'Error categorizing sale %: %', v_sale.id, SQLERRM;
      END;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

-- Migrate existing supplier_categorization_rules to new table (if data exists)
INSERT INTO categorization_rules (
  restaurant_id,
  rule_name,
  applies_to,
  supplier_id,
  category_id,
  is_active,
  auto_apply,
  created_at,
  updated_at
)
SELECT 
  scr.restaurant_id,
  'Supplier: ' || s.name AS rule_name,
  'bank_transactions' AS applies_to,
  scr.supplier_id,
  scr.default_category_id,
  scr.auto_apply,
  scr.auto_apply,
  scr.created_at,
  scr.updated_at
FROM supplier_categorization_rules scr
JOIN suppliers s ON s.id = scr.supplier_id
ON CONFLICT DO NOTHING;

-- Comment to explain the new system
COMMENT ON TABLE categorization_rules IS 'Enhanced categorization rules supporting pattern-based matching for both bank transactions and POS sales';
COMMENT ON FUNCTION matches_bank_transaction_rule IS 'Checks if a bank transaction matches all conditions of a categorization rule';
COMMENT ON FUNCTION matches_pos_sale_rule IS 'Checks if a POS sale matches all conditions of a categorization rule';
COMMENT ON FUNCTION find_matching_rules_for_bank_transaction IS 'Finds the highest priority matching rule for a bank transaction';
COMMENT ON FUNCTION find_matching_rules_for_pos_sale IS 'Finds the highest priority matching rule for a POS sale';
COMMENT ON FUNCTION apply_rules_to_bank_transactions IS 'Applies categorization rules to all uncategorized bank transactions';
COMMENT ON FUNCTION apply_rules_to_pos_sales IS 'Applies categorization rules to all uncategorized POS sales';

-- Trigger to auto-apply categorization rules when new POS sales are synced
CREATE OR REPLACE FUNCTION auto_apply_pos_categorization_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
  v_sale_json JSONB;
  v_auto_apply BOOLEAN;
BEGIN
  -- Only process uncategorized sales
  IF NEW.is_categorized = false OR NEW.category_id IS NULL THEN
    -- Build sale JSONB for matching
    v_sale_json := jsonb_build_object(
      'item_name', NEW.item_name,
      'total_price', NEW.total_price,
      'pos_category', NEW.pos_category
    );
    
    -- Find matching rule
    SELECT * INTO v_rule
    FROM find_matching_rules_for_pos_sale(NEW.restaurant_id, v_sale_json)
    LIMIT 1;
    
    -- If rule found, check if auto_apply is enabled
    IF v_rule.rule_id IS NOT NULL THEN
      SELECT auto_apply INTO v_auto_apply
      FROM categorization_rules
      WHERE id = v_rule.rule_id;
      
      IF v_auto_apply THEN
        NEW.category_id := v_rule.category_id;
        NEW.is_categorized := true;
        
        -- Update rule statistics
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on unified_sales
DROP TRIGGER IF EXISTS auto_categorize_pos_sale ON unified_sales;
CREATE TRIGGER auto_categorize_pos_sale
  BEFORE INSERT ON unified_sales
  FOR EACH ROW
  EXECUTE FUNCTION auto_apply_pos_categorization_rules();

-- Trigger to auto-apply categorization rules when new bank transactions are synced
CREATE OR REPLACE FUNCTION auto_apply_bank_categorization_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
  v_transaction_json JSONB;
  v_auto_apply BOOLEAN;
BEGIN
  -- Only process uncategorized transactions
  IF NEW.is_categorized = false OR NEW.category_id IS NULL THEN
    -- Build transaction JSONB for matching
    v_transaction_json := jsonb_build_object(
      'description', NEW.description,
      'amount', NEW.amount,
      'supplier_id', NEW.supplier_id
    );
    
    -- Find matching rule
    SELECT * INTO v_rule
    FROM find_matching_rules_for_bank_transaction(NEW.restaurant_id, v_transaction_json)
    LIMIT 1;
    
    -- If rule found, check if auto_apply is enabled
    IF v_rule.rule_id IS NOT NULL THEN
      SELECT auto_apply INTO v_auto_apply
      FROM categorization_rules
      WHERE id = v_rule.rule_id;
      
      IF v_auto_apply THEN
        -- Update the transaction with the rule's category
        NEW.category_id := v_rule.category_id;
        NEW.is_categorized := true;
        
        -- Update rule statistics
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on bank_transactions
DROP TRIGGER IF EXISTS auto_categorize_bank_transaction ON bank_transactions;
CREATE TRIGGER auto_categorize_bank_transaction
  BEFORE INSERT ON bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION auto_apply_bank_categorization_rules();
