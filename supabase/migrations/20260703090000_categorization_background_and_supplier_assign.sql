-- Migration: categorization background rule application + supplier-assign semantics
-- Spec: docs/superpowers/specs/2026-07-02-categorization-background-and-supplier-assign-design.md
--
-- §1  DROP+CREATE find_matching_rules_for_bank_transaction (RETURNS TABLE change requires DROP)
--     Adds supplier_id output column; supplier = assignment (not filter) when rule has
--     description/amount criteria; supplier-only rules remain strict filters.
--
-- §2  CREATE OR REPLACE matches_bank_transaction_rule
--     Same supplier-only semantics for the BEFORE INSERT trigger path.
--
-- §3  CREATE OR REPLACE auto_apply_bank_categorization_rules (BEFORE INSERT trigger fn)
--     Selects cr.supplier_id via the updated matcher and assigns it to NEW.supplier_id
--     when the transaction has none (COALESCE: txn supplier wins).
--
-- §4  apply_rules_to_pos_sales_internal + hardened public wrapper
-- §5  apply_rules_to_bank_transactions_internal + supplier assignment + public wrapper
-- §6  Dynamic gate rewrite of the four sync functions
-- §7  One-time backfill of the stuck backlog


-- ============================================================
-- §1  find_matching_rules_for_bank_transaction
--     DROP + CREATE required: Postgres cannot change OUT parameters via CREATE OR REPLACE.
--     After re-create, explicitly GRANT to authenticated and service_role — Supabase
--     revokes PUBLIC execute by default and DROP would otherwise strand direct callers.
-- ============================================================

DROP FUNCTION IF EXISTS find_matching_rules_for_bank_transaction(uuid, jsonb);

CREATE FUNCTION find_matching_rules_for_bank_transaction(
  p_restaurant_id uuid,
  p_transaction   jsonb
)
RETURNS TABLE (
  rule_id         uuid,
  rule_name       text,
  category_id     uuid,
  priority        integer,
  is_split_rule   boolean,
  split_categories jsonb,
  supplier_id     uuid        -- NEW: rule's supplier_id (assign-not-filter when other criteria exist)
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cr.id           AS rule_id,
    cr.rule_name,
    cr.category_id,
    cr.priority,
    cr.is_split_rule,
    cr.split_categories,
    cr.supplier_id
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND (cr.applies_to = 'bank_transactions' OR cr.applies_to = 'both')
    -- Description pattern matching (NULL means "any description")
    AND (
      cr.description_pattern IS NULL
      OR (
        CASE cr.description_match_type
          WHEN 'exact'       THEN LOWER(p_transaction->>'description') = LOWER(cr.description_pattern)
          WHEN 'contains'    THEN LOWER(p_transaction->>'description') LIKE '%' || LOWER(cr.description_pattern) || '%'
          WHEN 'starts_with' THEN LOWER(p_transaction->>'description') LIKE LOWER(cr.description_pattern) || '%'
          WHEN 'ends_with'   THEN LOWER(p_transaction->>'description') LIKE '%' || LOWER(cr.description_pattern)
          WHEN 'regex'       THEN (p_transaction->>'description') ~ cr.description_pattern
          ELSE false
        END
      )
    )
    -- Amount range matching
    AND (cr.amount_min IS NULL OR ABS((p_transaction->>'amount')::NUMERIC) >= cr.amount_min)
    AND (cr.amount_max IS NULL OR ABS((p_transaction->>'amount')::NUMERIC) <= cr.amount_max)
    -- Supplier semantics: a supplier on a rule is a FILTER only when the rule is
    -- "supplier-only" (no description/amount criteria; transaction_type does NOT count).
    -- When the rule has description or amount criteria, supplier is an ASSIGNMENT applied
    -- after match — not a filter. This means supplier-carrying description rules now match
    -- supplier-less transactions (the common case in bank feeds).
    AND (
      cr.supplier_id IS NULL
      OR cr.description_pattern IS NOT NULL
      OR cr.amount_min IS NOT NULL
      OR cr.amount_max IS NOT NULL
      -- Supplier-only rule: the transaction must already be linked to that supplier.
      -- COALESCE(..., false) prevents NULL-comparison from silently excluding the row.
      OR COALESCE((p_transaction->>'supplier_id')::uuid = cr.supplier_id, false)
    )
    -- Transaction type matching
    AND (
      cr.transaction_type IS NULL
      OR cr.transaction_type = 'any'
      OR (cr.transaction_type = 'debit'  AND (p_transaction->>'amount')::NUMERIC < 0)
      OR (cr.transaction_type = 'credit' AND (p_transaction->>'amount')::NUMERIC > 0)
    )
  ORDER BY cr.priority DESC, cr.created_at ASC
  LIMIT 1;
END;
$$;

-- Explicit grants: Supabase revokes PUBLIC execute by default; authenticated callers
-- (useApplyRulesV2, etc.) and service_role edge functions both need EXECUTE.
GRANT EXECUTE ON FUNCTION find_matching_rules_for_bank_transaction(uuid, jsonb)
  TO authenticated, service_role;


-- ============================================================
-- §2  matches_bank_transaction_rule
--     BEFORE INSERT trigger path uses this function directly.
--     Apply the same supplier-only semantics so both code paths are consistent.
-- ============================================================

CREATE OR REPLACE FUNCTION matches_bank_transaction_rule(
  p_rule_id    uuid,
  p_transaction jsonb
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_rule        RECORD;
  v_description text;
  v_amount      numeric;
  v_supplier_id uuid;
  v_tx_type     text;
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
  v_amount      := COALESCE((p_transaction->>'amount')::NUMERIC, 0);
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

  -- Check supplier: filter only when the rule is supplier-only
  -- (no description/amount criteria; transaction_type does NOT count as a positive criterion).
  -- When the rule has a description or amount, supplier is an ASSIGNMENT (not a filter),
  -- so we skip this check — matching is decided by the other criteria alone.
  IF v_rule.supplier_id IS NOT NULL
     AND v_rule.description_pattern IS NULL
     AND v_rule.amount_min IS NULL
     AND v_rule.amount_max IS NULL THEN
    -- Supplier-only rule: the transaction must already be linked to that supplier.
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


-- ============================================================
-- §3  auto_apply_bank_categorization_rules (BEFORE INSERT trigger fn)
--     Two changes vs. the 20251111000000 version:
--     1. The SELECT feeding v_matching_rule now uses find_matching_rules_for_bank_transaction
--        directly (which already returns supplier_id via §1) so no inline JOIN is needed.
--     2. In the apply branch: NEW.supplier_id := COALESCE(NEW.supplier_id, v_matching_rule.supplier_id)
--        assigns the rule's supplier when the transaction has none; the txn's own supplier wins.
-- ============================================================

CREATE OR REPLACE FUNCTION auto_apply_bank_categorization_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_matching_rule RECORD;
  v_transaction_json JSONB;
  v_auto_apply BOOLEAN;
BEGIN
  -- Only process uncategorized transactions
  IF NEW.is_categorized = false OR NEW.category_id IS NULL THEN
    -- Build transaction JSONB for matching
    v_transaction_json := jsonb_build_object(
      'description', NEW.description,
      'amount',       NEW.amount,
      'supplier_id',  NEW.supplier_id
    );

    -- Find matching rule (returns supplier_id column via §1 DROP+CREATE)
    SELECT * INTO v_matching_rule
    FROM find_matching_rules_for_bank_transaction(NEW.restaurant_id, v_transaction_json)
    LIMIT 1;

    -- If rule found, check if auto_apply is enabled
    IF v_matching_rule.rule_id IS NOT NULL THEN
      SELECT auto_apply INTO v_auto_apply
      FROM categorization_rules
      WHERE id = v_matching_rule.rule_id;

      IF v_auto_apply THEN
        -- Update the transaction with the rule's category
        NEW.category_id    := v_matching_rule.category_id;
        NEW.is_categorized := true;

        -- Assign the rule's supplier when the transaction has none (assign-not-filter semantics).
        -- COALESCE: the transaction's own supplier_id wins if already set.
        NEW.supplier_id := COALESCE(NEW.supplier_id, v_matching_rule.supplier_id);

        -- Update rule statistics
        UPDATE categorization_rules
        SET
          apply_count    = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_matching_rule.rule_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
