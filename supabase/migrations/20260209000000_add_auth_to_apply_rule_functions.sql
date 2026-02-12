-- Add authentication checks to apply_rules functions to allow direct RPC calls from frontend.
-- This removes the dependency on Edge Functions which have execution limits.
-- Bank transaction function inlines journal entry creation to call rebuild_account_balances
-- only once at the end instead of per-row.

-- Update apply_rules_to_pos_sales to include permission check and error handling
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales(
  p_restaurant_id UUID,
  p_batch_limit INTEGER DEFAULT 100
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
  v_applied_count INTEGER := 0;
  v_total_count INTEGER := 0;
  v_split_result RECORD;
  v_splits_with_amounts JSONB;
  v_split JSONB;
  v_splits_array JSONB[] := ARRAY[]::JSONB[];
BEGIN
  -- CRITICAL SECURITY CHECK: Verify user has permission to apply rules for this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not have access to apply rules for this restaurant';
  END IF;

  -- Only fetch uncategorized POS sales that already have a matching rule
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
        'item_name', s.item_name,
        'total_price', s.total_price,
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

    -- Per-row error handling: one bad sale doesn't abort the batch
    BEGIN
      -- Apply split rule or standard categorization
      IF v_sale.is_split_rule AND v_sale.split_categories IS NOT NULL THEN
        v_splits_array := ARRAY[]::JSONB[];

        FOR v_split IN SELECT * FROM jsonb_array_elements(v_sale.split_categories)
        LOOP
          IF v_split->>'percentage' IS NOT NULL THEN
            v_splits_array := v_splits_array || jsonb_build_object(
              'category_id', v_split->>'category_id',
              'amount', ROUND((v_sale.total_price * (v_split->>'percentage')::NUMERIC / 100.0), 2),
              'description', COALESCE(v_split->>'description', '')
            );
          ELSE
            v_splits_array := v_splits_array || jsonb_build_object(
              'category_id', v_split->>'category_id',
              'amount', (v_split->>'amount')::NUMERIC,
              'description', COALESCE(v_split->>'description', '')
            );
          END IF;
        END LOOP;

        v_splits_with_amounts := to_jsonb(v_splits_array);

        SELECT * INTO v_split_result
        FROM split_pos_sale(
          v_sale.id,
          v_splits_with_amounts
        );

        IF v_split_result.success THEN
          v_applied_count := v_applied_count + 1;
          UPDATE categorization_rules
          SET
            apply_count = apply_count + 1,
            last_applied_at = now()
          WHERE id = v_sale.rule_id;
        ELSE
          RAISE NOTICE 'Failed to split sale %: %', v_sale.id, v_split_result.message;
        END IF;
      ELSE
        UPDATE unified_sales
        SET
          category_id = v_sale.rule_category_id,
          is_categorized = true,
          updated_at = now()
        WHERE id = v_sale.id;
        v_applied_count := v_applied_count + 1;
        UPDATE categorization_rules
        SET
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_sale.rule_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error categorizing sale %: %', v_sale.id, SQLERRM;
    END;
  END LOOP;

  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

COMMENT ON FUNCTION apply_rules_to_pos_sales IS
  'Applies categorization rules to uncategorized POS sales. Includes permission check for owner/manager. Only batches sales that already match a rule, supports split rules with percentage-to-amount conversion, and processes up to p_batch_limit to avoid timeouts.';


-- Update apply_rules_to_bank_transactions: inlines journal entry creation
-- so rebuild_account_balances is called once at the end instead of per-row.
CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions(
  p_restaurant_id UUID,
  p_batch_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction RECORD;
  v_applied_count INTEGER := 0;
  v_total_count INTEGER := 0;
  v_splits_with_amounts JSONB;
  v_split JSONB;
  v_splits_array JSONB[] := ARRAY[]::JSONB[];
  -- Pre-fetched restaurant-level data
  v_cash_account_id UUID;
  -- Per-row variables for inlined categorization
  v_category RECORD;
  v_fiscal_period RECORD;
  v_journal_entry_id UUID;
  v_existing_journal_entry UUID;
  v_total_split_amount NUMERIC;
  v_split_rec RECORD;
BEGIN
  -- CRITICAL SECURITY CHECK: Verify user has permission to apply rules for this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not have access to apply rules for this restaurant';
  END IF;

  -- Pre-fetch cash account once for the restaurant (needed for journal entries)
  SELECT id INTO v_cash_account_id
  FROM chart_of_accounts
  WHERE restaurant_id = p_restaurant_id
    AND account_code = '1000'
  LIMIT 1;

  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash account (1000) not found for restaurant %', p_restaurant_id;
  END IF;

  -- Only fetch uncategorized bank transactions that already have a matching rule
  -- Include extra fields needed for inlined journal entry creation
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
      matched.split_categories
    FROM bank_transactions bt
    CROSS JOIN LATERAL find_matching_rules_for_bank_transaction(
      p_restaurant_id,
      jsonb_build_object(
        'description', bt.description,
        'amount', bt.amount,
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

    -- Per-row error handling: one bad transaction doesn't abort the batch
    BEGIN
      -- Check if transaction falls in a closed fiscal period
      SELECT id INTO v_fiscal_period
      FROM fiscal_periods
      WHERE restaurant_id = p_restaurant_id
        AND v_transaction.transaction_date >= period_start
        AND v_transaction.transaction_date <= period_end
        AND is_closed = true
      LIMIT 1;

      IF v_fiscal_period.id IS NOT NULL THEN
        RAISE EXCEPTION 'Transaction % in closed fiscal period', v_transaction.id;
      END IF;

      IF v_transaction.is_split_rule AND v_transaction.split_categories IS NOT NULL THEN
        -----------------------------------------------------------------
        -- SPLIT PATH: inline split_bank_transaction logic (no rebuild)
        -----------------------------------------------------------------
        v_splits_array := ARRAY[]::JSONB[];
        v_total_split_amount := 0;

        -- Convert percentages to amounts and build splits array
        FOR v_split IN SELECT * FROM jsonb_array_elements(v_transaction.split_categories)
        LOOP
          IF v_split->>'percentage' IS NOT NULL THEN
            v_splits_array := v_splits_array || jsonb_build_object(
              'category_id', v_split->>'category_id',
              'amount', ROUND((ABS(v_transaction.amount) * (v_split->>'percentage')::NUMERIC / 100.0), 2),
              'description', COALESCE(v_split->>'description', '')
            );
          ELSE
            v_splits_array := v_splits_array || jsonb_build_object(
              'category_id', v_split->>'category_id',
              'amount', (v_split->>'amount')::NUMERIC,
              'description', COALESCE(v_split->>'description', '')
            );
          END IF;
        END LOOP;

        v_splits_with_amounts := to_jsonb(v_splits_array);

        -- Validate splits total
        SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
        INTO v_total_split_amount
        FROM jsonb_array_elements(v_splits_with_amounts) AS elem;

        IF ABS(ABS(v_transaction.amount) - v_total_split_amount) > 0.01 THEN
          RAISE EXCEPTION 'Split amounts (%) do not match transaction amount (%) for txn %',
            v_total_split_amount, ABS(v_transaction.amount), v_transaction.id;
        END IF;

        -- Check for existing journal entry (idempotency)
        SELECT id INTO v_existing_journal_entry
        FROM journal_entries
        WHERE reference_type = 'bank_transaction'
          AND reference_id = v_transaction.id
          AND restaurant_id = p_restaurant_id
        LIMIT 1;

        IF v_existing_journal_entry IS NOT NULL THEN
          DELETE FROM journal_entry_lines WHERE journal_entry_id = v_existing_journal_entry;
          v_journal_entry_id := v_existing_journal_entry;
          UPDATE journal_entries
          SET
            entry_number = 'SPLIT-' || COALESCE(v_transaction.stripe_transaction_id, v_transaction.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
            description = 'Split transaction: ' || v_transaction.description,
            updated_at = now()
          WHERE id = v_journal_entry_id;
        ELSE
          INSERT INTO journal_entries (
            restaurant_id, entry_date, entry_number, description,
            reference_type, reference_id, total_debit, total_credit, created_by
          ) VALUES (
            p_restaurant_id,
            v_transaction.transaction_date,
            'SPLIT-' || COALESCE(v_transaction.stripe_transaction_id, v_transaction.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
            'Split transaction: ' || v_transaction.description,
            'bank_transaction',
            v_transaction.id,
            ABS(v_transaction.amount),
            ABS(v_transaction.amount),
            auth.uid()
          ) RETURNING id INTO v_journal_entry_id;
        END IF;

        -- Create split records and journal lines for each split
        FOR v_split_rec IN
          SELECT * FROM jsonb_to_recordset(v_splits_with_amounts)
            AS x(category_id uuid, amount numeric, description text)
        LOOP
          -- Validate category
          SELECT * INTO v_category
          FROM chart_of_accounts
          WHERE id = v_split_rec.category_id
            AND restaurant_id = p_restaurant_id
            AND is_active = true;

          IF v_category.id IS NULL THEN
            RAISE EXCEPTION 'Category not found or inactive: %', v_split_rec.category_id;
          END IF;

          -- Insert split record
          INSERT INTO bank_transaction_splits (
            transaction_id, category_id, amount, description
          ) VALUES (
            v_transaction.id, v_split_rec.category_id,
            v_split_rec.amount, v_split_rec.description
          );

          -- Journal lines based on transaction direction
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

        -- Offsetting cash line
        IF v_transaction.amount < 0 THEN
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
          VALUES (v_journal_entry_id, v_cash_account_id, 0, ABS(v_transaction.amount), 'Cash payment (split)');
        ELSE
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
          VALUES (v_journal_entry_id, v_cash_account_id, ABS(v_transaction.amount), 0, 'Cash received (split)');
        END IF;

        -- Update transaction status (no rebuild here)
        UPDATE bank_transactions
        SET is_split = true, is_categorized = true, category_id = NULL, updated_at = now()
        WHERE id = v_transaction.id;

        v_applied_count := v_applied_count + 1;
        UPDATE categorization_rules
        SET apply_count = apply_count + 1, last_applied_at = now()
        WHERE id = v_transaction.rule_id;

      ELSE
        -----------------------------------------------------------------
        -- NON-SPLIT PATH: inline categorize_bank_transaction (no rebuild)
        -----------------------------------------------------------------

        -- Validate category is active
        SELECT * INTO v_category
        FROM chart_of_accounts
        WHERE id = v_transaction.rule_category_id
          AND restaurant_id = p_restaurant_id
          AND is_active = true;

        IF v_category.id IS NULL THEN
          RAISE EXCEPTION 'Category not found or inactive for txn %', v_transaction.id;
        END IF;

        -- Check for existing journal entry (idempotency)
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
          SET description = 'Auto-categorized by rule: ' || v_transaction.rule_name,
              total_debit = ABS(v_transaction.amount),
              total_credit = ABS(v_transaction.amount),
              updated_at = now()
          WHERE id = v_existing_journal_entry;
        ELSE
          INSERT INTO journal_entries (
            restaurant_id, entry_date, entry_number, description,
            reference_type, reference_id, total_debit, total_credit, created_by
          ) VALUES (
            p_restaurant_id,
            v_transaction.transaction_date,
            'BANK-' || COALESCE(v_transaction.stripe_transaction_id, v_transaction.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
            'Auto-categorized by rule: ' || v_transaction.rule_name,
            'bank_transaction',
            v_transaction.id,
            ABS(v_transaction.amount),
            ABS(v_transaction.amount),
            auth.uid()
          ) RETURNING id INTO v_journal_entry_id;
        END IF;

        -- Journal entry lines based on transaction direction
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

        -- Update transaction (no rebuild here)
        UPDATE bank_transactions
        SET
          category_id = v_transaction.rule_category_id,
          is_categorized = true,
          notes = 'Auto-categorized by rule: ' || v_transaction.rule_name,
          supplier_id = COALESCE(v_transaction.supplier_id, supplier_id),
          updated_at = now()
        WHERE id = v_transaction.id;

        v_applied_count := v_applied_count + 1;
        UPDATE categorization_rules
        SET apply_count = apply_count + 1, last_applied_at = now()
        WHERE id = v_transaction.rule_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error categorizing transaction %: %', v_transaction.id, SQLERRM;
    END;
  END LOOP;

  -- Rebuild account balances ONCE at the end (instead of per-row)
  IF v_applied_count > 0 THEN
    PERFORM rebuild_account_balances(p_restaurant_id);
  END IF;

  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

COMMENT ON FUNCTION apply_rules_to_bank_transactions IS
  'Applies categorization rules to uncategorized bank transactions. Includes permission check for owner/manager. Inlines journal entry creation to call rebuild_account_balances once at the end instead of per-row. Supports split rules with percentage-to-amount conversion, and processes up to p_batch_limit to avoid timeouts.';
