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


-- ============================================================
-- §4  apply_rules_to_pos_sales_internal + hardened public wrapper
--
--     Internal engine: full body of apply_rules_to_pos_sales minus the
--     permission check. SECURITY DEFINER with pinned search_path so it
--     can be called by sync functions (also SECURITY DEFINER, owner postgres)
--     and service-role edge functions without needing auth.uid().
--
--     REVOKE from PUBLIC/anon/authenticated prevents PostgREST exposure.
--     GRANT to service_role only — the sync functions and cron run as
--     service_role or as the postgres owner (which supersedes REVOKE).
--
--     Public wrapper: unchanged signature and permission semantics for
--     authenticated clients. Re-declared with SET search_path = public
--     (the prior version was SECURITY DEFINER with an unpinned path —
--     injection risk on the permission check). DEFAULT 100 is the safe
--     interactive batch size; background callers pass larger limits.
-- ============================================================

-- Internal engine: no auth check. NOT exposed to clients (EXECUTE revoked below).
-- Called by sync functions, cron backfill, and service-role edge functions.
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales_internal(
  p_restaurant_id UUID,
  p_batch_limit   INTEGER DEFAULT 100
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale                RECORD;
  v_applied_count       INTEGER := 0;
  v_total_count         INTEGER := 0;
  v_split_result        RECORD;
  v_splits_with_amounts JSONB;
  v_split               JSONB;
  v_splits_array        JSONB[] := ARRAY[]::JSONB[];
BEGIN
  -- No permission check: this function is for background/service-role callers.
  -- The public wrapper apply_rules_to_pos_sales enforces owner/manager membership.

  FOR v_sale IN
    SELECT
      s.id,
      s.total_price,
      matched.rule_id,
      matched.rule_name,
      matched.category_id AS rule_category_id,
      matched.is_split_rule,
      matched.split_categories
    FROM unified_sales s
    CROSS JOIN LATERAL find_matching_rules_for_pos_sale(
      p_restaurant_id,
      jsonb_build_object(
        'item_name',    s.item_name,
        'total_price',  s.total_price,
        'pos_category', s.pos_category
      )
    ) matched
    WHERE s.restaurant_id = p_restaurant_id
      AND (s.is_categorized = false OR s.category_id IS NULL)
      AND s.is_split = false
      AND matched.rule_id IS NOT NULL
    ORDER BY s.sale_date DESC
    LIMIT p_batch_limit
  LOOP
    v_total_count := v_total_count + 1;

    BEGIN
      IF v_sale.is_split_rule AND v_sale.split_categories IS NOT NULL THEN
        v_splits_array := ARRAY[]::JSONB[];

        FOR v_split IN SELECT * FROM jsonb_array_elements(v_sale.split_categories)
        LOOP
          v_splits_array := v_splits_array || jsonb_build_object(
            'category_id', v_split->>'category_id',
            'amount', CASE
              WHEN v_split->>'percentage' IS NOT NULL
              THEN ROUND((v_sale.total_price * (v_split->>'percentage')::NUMERIC / 100.0), 2)
              ELSE (v_split->>'amount')::NUMERIC
            END,
            'description', COALESCE(v_split->>'description', '')
          );
        END LOOP;

        v_splits_with_amounts := to_jsonb(v_splits_array);

        SELECT * INTO v_split_result
        FROM split_pos_sale(v_sale.id, v_splits_with_amounts);

        IF NOT v_split_result.success THEN
          RAISE NOTICE 'Failed to split sale %: %', v_sale.id, v_split_result.message;
          CONTINUE;
        END IF;
      ELSE
        UPDATE unified_sales
        SET
          category_id    = v_sale.rule_category_id,
          is_categorized = true,
          updated_at     = now()
        WHERE id = v_sale.id;
      END IF;

      v_applied_count := v_applied_count + 1;
      UPDATE categorization_rules
      SET apply_count = apply_count + 1, last_applied_at = now()
      WHERE id = v_sale.rule_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error categorizing sale %: %', v_sale.id, SQLERRM;
    END;
  END LOOP;

  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

COMMENT ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer) IS
  'Auth-free internal POS rule engine. No permission check — restricted to service_role via REVOKE/GRANT. '
  'Called by sync functions (background), cron backfill, and service-role edge functions. '
  'The public wrapper apply_rules_to_pos_sales enforces owner/manager membership for interactive calls. '
  'DEFAULT 100 is the safe interactive batch size; background callers pass larger limits (e.g. 5000).';

-- Prevent PostgREST / client exposure: clients must go through the public wrapper.
REVOKE EXECUTE ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer) FROM PUBLIC, anon, authenticated;
-- Service-role callers (edge functions, cron via sync functions) retain EXECUTE.
GRANT  EXECUTE ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer) TO service_role;


-- Public wrapper: unchanged signature and permission semantics for authenticated clients.
-- Re-declared with SET search_path = public (the prior version was SECURITY DEFINER
-- with an unpinned search_path — injection risk on the permission check).
-- DEFAULT 100 is the safe interactive batch size; background callers pass larger limits.
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales(
  p_restaurant_id UUID,
  p_batch_limit   INTEGER DEFAULT 100
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not have access to apply rules for this restaurant';
  END IF;

  RETURN QUERY SELECT * FROM apply_rules_to_pos_sales_internal(p_restaurant_id, p_batch_limit);
END;
$$;

COMMENT ON FUNCTION apply_rules_to_pos_sales(uuid, integer) IS
  'Public POS rule engine for authenticated owner/manager callers. '
  'Enforces membership then delegates to apply_rules_to_pos_sales_internal. '
  'DEFAULT 100 is the safe interactive batch size; background callers should '
  'call the internal function directly with a larger limit.';


-- ============================================================
-- §5  apply_rules_to_bank_transactions_internal + supplier assignment + public wrapper
--
--     Internal engine: full body of apply_rules_to_bank_transactions minus the
--     permission check. SECURITY DEFINER with pinned search_path (already
--     present in the original). The main cursor SELECT gains
--     matched.supplier_id AS rule_supplier_id from the updated matcher (§1).
--     In the non-split UPDATE, supplier assignment uses:
--       COALESCE(v_transaction.supplier_id, v_transaction.rule_supplier_id, supplier_id)
--     so the transaction's own supplier wins; failing that, the rule's supplier
--     is assigned (assign-not-filter semantics); failing that, the DB value is
--     preserved (no clobber).
--
--     REVOKE from PUBLIC/anon/authenticated prevents PostgREST exposure.
--     GRANT to service_role only.
--
--     Public wrapper: unchanged signature and permission semantics for
--     authenticated clients. Delegates to the internal function.
--     DEFAULT 100 is the safe interactive batch size; background callers pass
--     larger limits (the stripe-sync-transactions edge function uses 1000).
-- ============================================================

-- Internal engine: no auth check. NOT exposed to clients (EXECUTE revoked below).
-- Called by service-role edge functions, cron backfill, and migration backfill.
CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions_internal(
  p_restaurant_id UUID,
  p_batch_limit   INTEGER DEFAULT 100
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction         RECORD;
  v_applied_count       INTEGER := 0;
  v_total_count         INTEGER := 0;
  v_splits_with_amounts JSONB;
  v_split               JSONB;
  v_splits_array        JSONB[] := ARRAY[]::JSONB[];
  v_cash_account_id     UUID;
  v_category            RECORD;
  v_fiscal_period_id    UUID;
  v_journal_entry_id    UUID;
  v_existing_journal_entry UUID;
  v_total_split_amount  NUMERIC;
  v_split_rec           RECORD;
  v_entry_prefix        TEXT;
  v_entry_description   TEXT;
BEGIN
  -- No permission check: this function is for background/service-role callers.
  -- The public wrapper apply_rules_to_bank_transactions enforces owner/manager membership.

  SELECT id INTO v_cash_account_id
  FROM chart_of_accounts
  WHERE restaurant_id = p_restaurant_id
    AND account_code = '1000'
  LIMIT 1;

  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash account (1000) not found for restaurant %', p_restaurant_id;
  END IF;

  FOR v_transaction IN
    SELECT
      bt.id,
      bt.amount,
      bt.description,
      bt.supplier_id,
      bt.transaction_date,
      bt.stripe_transaction_id,
      matched.rule_id,
      matched.rule_name,
      matched.category_id AS rule_category_id,
      matched.is_split_rule,
      matched.split_categories,
      matched.supplier_id AS rule_supplier_id   -- NEW: rule's supplier for assign-not-filter
    FROM bank_transactions bt
    CROSS JOIN LATERAL find_matching_rules_for_bank_transaction(
      p_restaurant_id,
      jsonb_build_object(
        'description', bt.description,
        'amount',      bt.amount,
        'supplier_id', bt.supplier_id
      )
    ) matched
    WHERE bt.restaurant_id = p_restaurant_id
      AND (bt.is_categorized = false OR bt.category_id IS NULL)
      AND bt.is_split = false
      AND bt.excluded_reason IS NULL
      AND matched.rule_id IS NOT NULL
    ORDER BY bt.transaction_date DESC
    LIMIT p_batch_limit
  LOOP
    v_total_count := v_total_count + 1;

    BEGIN
      SELECT id INTO v_fiscal_period_id
      FROM fiscal_periods
      WHERE restaurant_id = p_restaurant_id
        AND v_transaction.transaction_date >= period_start
        AND v_transaction.transaction_date <= period_end
        AND is_closed = true
      LIMIT 1;

      IF v_fiscal_period_id IS NOT NULL THEN
        RAISE EXCEPTION 'Transaction % in closed fiscal period', v_transaction.id;
      END IF;

      IF v_transaction.is_split_rule AND v_transaction.split_categories IS NOT NULL THEN
        -- Split path
        v_splits_array := ARRAY[]::JSONB[];
        v_total_split_amount := 0;

        FOR v_split IN SELECT * FROM jsonb_array_elements(v_transaction.split_categories)
        LOOP
          v_splits_array := v_splits_array || jsonb_build_object(
            'category_id', v_split->>'category_id',
            'amount', CASE
              WHEN v_split->>'percentage' IS NOT NULL
              THEN ROUND((ABS(v_transaction.amount) * (v_split->>'percentage')::NUMERIC / 100.0), 2)
              ELSE (v_split->>'amount')::NUMERIC
            END,
            'description', COALESCE(v_split->>'description', '')
          );
        END LOOP;

        v_splits_with_amounts := to_jsonb(v_splits_array);

        SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
        INTO v_total_split_amount
        FROM jsonb_array_elements(v_splits_with_amounts) AS elem;

        IF ABS(ABS(v_transaction.amount) - v_total_split_amount) > 0.01 THEN
          RAISE EXCEPTION 'Split amounts (%) do not match transaction amount (%) for txn %',
            v_total_split_amount, ABS(v_transaction.amount), v_transaction.id;
        END IF;

        v_entry_prefix := 'SPLIT';
        v_entry_description := 'Split transaction: ' || v_transaction.description;
      ELSE
        -- Non-split path: validate category
        SELECT * INTO v_category
        FROM chart_of_accounts
        WHERE id = v_transaction.rule_category_id
          AND restaurant_id = p_restaurant_id
          AND is_active = true;

        IF v_category.id IS NULL THEN
          RAISE EXCEPTION 'Category not found or inactive for txn %', v_transaction.id;
        END IF;

        v_entry_prefix := 'BANK';
        v_entry_description := 'Auto-categorized by rule: ' || v_transaction.rule_name;
      END IF;

      -- Upsert journal entry (shared by both paths).
      -- created_by uses auth.uid() which returns NULL in service-role/cron context —
      -- journal_entries.created_by is NULLABLE so NULL inserts are valid.
      SELECT id INTO v_existing_journal_entry
      FROM journal_entries
      WHERE reference_type = 'bank_transaction'
        AND reference_id = v_transaction.id
        AND restaurant_id = p_restaurant_id
      LIMIT 1;

      IF v_existing_journal_entry IS NOT NULL THEN
        v_journal_entry_id := v_existing_journal_entry;
        DELETE FROM journal_entry_lines WHERE journal_entry_id = v_existing_journal_entry;
        UPDATE journal_entries
        SET
          entry_number = v_entry_prefix || '-' || COALESCE(v_transaction.stripe_transaction_id, v_transaction.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
          description  = v_entry_description,
          total_debit  = ABS(v_transaction.amount),
          total_credit = ABS(v_transaction.amount),
          updated_at   = now()
        WHERE id = v_existing_journal_entry;
      ELSE
        INSERT INTO journal_entries (
          restaurant_id, entry_date, entry_number, description,
          reference_type, reference_id, total_debit, total_credit, created_by
        ) VALUES (
          p_restaurant_id,
          v_transaction.transaction_date,
          v_entry_prefix || '-' || COALESCE(v_transaction.stripe_transaction_id, v_transaction.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
          v_entry_description,
          'bank_transaction',
          v_transaction.id,
          ABS(v_transaction.amount),
          ABS(v_transaction.amount),
          auth.uid()   -- NULL in service-role/cron context; column is NULLABLE
        ) RETURNING id INTO v_journal_entry_id;
      END IF;

      -- Create journal lines (path-specific)
      IF v_transaction.is_split_rule AND v_transaction.split_categories IS NOT NULL THEN
        FOR v_split_rec IN
          SELECT * FROM jsonb_to_recordset(v_splits_with_amounts)
            AS x(category_id uuid, amount numeric, description text)
        LOOP
          SELECT * INTO v_category
          FROM chart_of_accounts
          WHERE id = v_split_rec.category_id
            AND restaurant_id = p_restaurant_id
            AND is_active = true;

          IF v_category.id IS NULL THEN
            RAISE EXCEPTION 'Category not found or inactive: %', v_split_rec.category_id;
          END IF;

          INSERT INTO bank_transaction_splits (
            transaction_id, category_id, amount, description
          ) VALUES (
            v_transaction.id, v_split_rec.category_id,
            v_split_rec.amount, v_split_rec.description
          );

          IF v_transaction.amount < 0 THEN
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
            VALUES (v_journal_entry_id, v_split_rec.category_id, v_split_rec.amount, 0,
                    COALESCE(v_split_rec.description, v_category.account_name));
          ELSE
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
            VALUES (v_journal_entry_id, v_split_rec.category_id, 0, v_split_rec.amount,
                    COALESCE(v_split_rec.description, v_category.account_name));
          END IF;
        END LOOP;

        -- Offsetting cash line for split
        IF v_transaction.amount < 0 THEN
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
          VALUES (v_journal_entry_id, v_cash_account_id, 0, ABS(v_transaction.amount), 'Cash payment (split)');
        ELSE
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
          VALUES (v_journal_entry_id, v_cash_account_id, ABS(v_transaction.amount), 0, 'Cash received (split)');
        END IF;

        UPDATE bank_transactions
        SET is_split = true, is_categorized = true, category_id = NULL, updated_at = now()
        WHERE id = v_transaction.id;
      ELSE
        -- Non-split journal lines
        IF v_transaction.amount < 0 THEN
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
          VALUES
            (v_journal_entry_id, v_transaction.rule_category_id, ABS(v_transaction.amount), 0, v_category.account_name),
            (v_journal_entry_id, v_cash_account_id, 0, ABS(v_transaction.amount), 'Cash payment');
        ELSE
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
          VALUES
            (v_journal_entry_id, v_cash_account_id, ABS(v_transaction.amount), 0, 'Cash received'),
            (v_journal_entry_id, v_transaction.rule_category_id, 0, ABS(v_transaction.amount), v_category.account_name);
        END IF;

        UPDATE bank_transactions
        SET
          category_id    = v_transaction.rule_category_id,
          is_categorized = true,
          notes          = 'Auto-categorized by rule: ' || v_transaction.rule_name,
          -- Supplier assignment (assign-not-filter semantics from §1):
          --   1. Transaction's own supplier wins if already set.
          --   2. Rule's supplier is assigned when the transaction has none.
          --   3. Database value preserved as last resort (no clobber).
          supplier_id    = COALESCE(v_transaction.supplier_id, v_transaction.rule_supplier_id, supplier_id),
          updated_at     = now()
        WHERE id = v_transaction.id;
      END IF;

      v_applied_count := v_applied_count + 1;
      UPDATE categorization_rules
      SET apply_count = apply_count + 1, last_applied_at = now()
      WHERE id = v_transaction.rule_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error categorizing transaction %: %', v_transaction.id, SQLERRM;
    END;
  END LOOP;

  IF v_applied_count > 0 THEN
    PERFORM rebuild_account_balances(p_restaurant_id);
  END IF;

  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

COMMENT ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer) IS
  'Auth-free internal bank rule engine. No permission check — restricted to service_role via REVOKE/GRANT. '
  'Called by service-role edge functions (stripe-sync-transactions), cron backfill, and migration backfill. '
  'Supplier assignment: COALESCE(txn.supplier_id, rule.supplier_id, db_value) — txn wins, then rule assigns, '
  'then preserves existing value. The public wrapper apply_rules_to_bank_transactions enforces '
  'owner/manager membership for interactive calls. '
  'DEFAULT 100 is the safe interactive batch size; background callers pass larger limits (e.g. 1000).';

-- Prevent PostgREST / client exposure: clients must go through the public wrapper.
REVOKE EXECUTE ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer) FROM PUBLIC, anon, authenticated;
-- Service-role callers (edge functions, cron, migration backfill) retain EXECUTE.
GRANT  EXECUTE ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer) TO service_role;


-- Public wrapper: unchanged signature and permission semantics for authenticated clients.
-- Delegates to the internal function after the ownership check.
-- DEFAULT 100 is the safe interactive batch size; background callers should
-- call the internal function directly with a larger limit (e.g. 1000 for stripe sync).
CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions(
  p_restaurant_id UUID,
  p_batch_limit   INTEGER DEFAULT 100
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not have access to apply rules for this restaurant';
  END IF;

  RETURN QUERY SELECT * FROM apply_rules_to_bank_transactions_internal(p_restaurant_id, p_batch_limit);
END;
$$;

COMMENT ON FUNCTION apply_rules_to_bank_transactions(uuid, integer) IS
  'Public bank rule engine for authenticated owner/manager callers. '
  'Enforces membership then delegates to apply_rules_to_bank_transactions_internal. '
  'DEFAULT 100 is the safe interactive batch size; background callers should '
  'call the internal function directly with a larger limit.';

-- ============================================================
-- §6  Dynamic gate rewrite of the four sync functions
--
--     Each of the four POS sync functions (sync_toast_to_unified_sales × 2,
--     _sync_focus_to_unified_sales_impl, _sync_focus_transactions_to_unified_sales_impl)
--     contains an auth.uid() guard that skips batch categorization when called from a
--     background / service-role context:
--
--       IF auth.uid() IS NOT NULL THEN
--         PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000);
--       ELSE
--         RAISE LOG '... skipping batch categorization ...';
--       END IF;
--
--     This DO-block reads each live function body via pg_get_functiondef, uses
--     regexp_replace to swap that block for an unconditional call to the new
--     internal engine, then EXECUTEs the resulting CREATE OR REPLACE statement.
--
--     Idempotent: if a function already contains 'apply_rules_to_pos_sales_internal'
--     it was already patched — skip it safely.
--     Drift guard: if the gate pattern is not found and the function is not already
--     patched, RAISE EXCEPTION aborts the migration (prevents silent no-op).
--
--     NOTE: the regex does NOT match the authorization header
--     "IF auth.uid() IS NOT NULL AND NOT EXISTS ..." because the pattern requires
--     "IS NOT NULL THEN" immediately followed (via \s*) by "PERFORM apply_rules_to_pos_sales",
--     while the authorization header has "AND NOT EXISTS" in between.
-- ============================================================
DO $$
DECLARE
  v_fn  regprocedure;
  v_src text;
  v_new text;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sync_toast_to_unified_sales',
                        '_sync_focus_to_unified_sales_impl',
                        '_sync_focus_transactions_to_unified_sales_impl')
  LOOP
    v_src := pg_get_functiondef(v_fn);

    -- Idempotency: already patched in a previous run — skip.
    IF v_src LIKE '%apply_rules_to_pos_sales_internal%' THEN
      RAISE LOG 'gate rewrite: % already patched — skipping', v_fn;
      CONTINUE;
    END IF;

    -- Replace the auth-gated block with an unconditional internal call.
    v_new := regexp_replace(
      v_src,
      'IF auth\.uid\(\) IS NOT NULL THEN\s*PERFORM apply_rules_to_pos_sales\(p_restaurant_id, 10000\);\s*ELSE\s*RAISE LOG\s*[^;]+;\s*END IF;',
      'PERFORM apply_rules_to_pos_sales_internal(p_restaurant_id, 10000);'
    );

    -- Drift guard: pattern not found → the body has changed in a way we did not anticipate.
    IF v_new = v_src THEN
      RAISE EXCEPTION
        'gate rewrite: categorization gate not found in % — migration aborted (body drifted?)',
        v_fn;
    END IF;

    EXECUTE v_new;
    RAISE LOG 'gate rewrite: patched %', v_fn;
  END LOOP;
END;
$$;
