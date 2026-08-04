-- Bound the rule-matching sweep so LIMIT actually limits work.
--
-- The old driver was a single query: unified_sales CROSS JOIN LATERAL
-- find_matching_rules_for_pos_sale(...) WHERE matched.rule_id IS NOT NULL
-- ORDER BY sale_date DESC LIMIT p_batch_limit. Because the LIMIT sits above a
-- filter on the function's own output, the planner must evaluate the matcher
-- for every candidate row before it can apply the LIMIT. On production that was
-- 51,366 rows x one matcher call each, 4.78M buffer hits, ~6s, zero matches --
-- 288 times a day, forever, because rows that match nothing never change state.
--
-- Now: statement 1 picks and stamps a bounded batch (no matcher involved, so
-- LIMIT binds); statement 2 runs the matcher against exactly those ids.
--
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.2-§3.4
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sale                RECORD;
  v_applied_count       INTEGER := 0;
  v_total_count         INTEGER := 0;
  v_split_result        RECORD;
  v_splits_with_amounts JSONB;
  v_split               JSONB;
  v_splits_array        JSONB[] := ARRAY[]::JSONB[];
  v_rules_changed_at    TIMESTAMPTZ;
  v_batch_ids           UUID[];
  v_applied_dates       DATE[] := ARRAY[]::DATE[];
  v_prev_skip           TEXT;
BEGIN
  -- Guard: reject NULL or non-positive batch limits (LIMIT NULL removes cap; negative aborts loops).
  IF p_batch_limit IS NULL OR p_batch_limit < 1 THEN
    RAISE EXCEPTION 'p_batch_limit must be a positive integer, got %', p_batch_limit;
  END IF;

  -- No permission check: this function is for background/service-role callers.
  -- The public wrapper apply_rules_to_pos_sales enforces owner/manager membership.

  -- Rule watermark. This predicate MUST mirror find_matching_rules_for_pos_sale's
  -- own rule-selection predicate exactly -- is_active and applies_to, and
  -- nothing else. In particular NOT auto_apply: the matcher ignores it, so a
  -- narrower watermark here would let a rule the matcher applies change without
  -- invalidating the cache, producing a silent permanent miss.
  SELECT max(GREATEST(cr.created_at, COALESCE(cr.updated_at, cr.created_at)))
    INTO v_rules_changed_at
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND (cr.applies_to = 'pos_sales' OR cr.applies_to = 'both');

  -- No rule can match: equivalent to running to completion with zero matches,
  -- minus all the work. Deliberately writes nothing.
  IF v_rules_changed_at IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Suppress trigger_unified_sales_aggregation for the duration of the sweep and
  -- re-aggregate once at the end. aggregate_unified_sales_to_daily sums
  -- COALESCE(total_price, unit_price*quantity, 0) and never reads category_id,
  -- so categorising a row cannot change a daily total -- the suppression is
  -- end-state-equivalent, not a behaviour change. Save and restore rather than
  -- forcing 'false': the Revel sync calls this from inside its own suppression
  -- window and must keep it.
  v_prev_skip := COALESCE(current_setting('app.skip_unified_sales_triggers', true), 'false');
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  -- Statement 1: select and stamp the batch BEFORE any matching happens.
  -- MATERIALIZED is required -- PG12+ inlines single-reference CTEs, which would
  -- dissolve the LIMIT back into the outer query and reintroduce the bug.
  --
  -- This UPDATE fires reset_unified_sales_rules_evaluated_at, but that trigger
  -- only resets when item_name/total_price/pos_category change, and this
  -- statement touches none of them -- so the stamp it just wrote survives.
  WITH batch AS MATERIALIZED (
    SELECT s.id
    FROM unified_sales s
    WHERE s.restaurant_id = p_restaurant_id
      AND (s.is_categorized = false OR s.category_id IS NULL)
      AND s.is_split = false
      AND s.rules_evaluated_at < v_rules_changed_at
    ORDER BY s.sale_date DESC
    LIMIT p_batch_limit
  ), stamped AS (
    UPDATE unified_sales u
       SET rules_evaluated_at = v_rules_changed_at
      FROM batch b
     WHERE u.id = b.id
    RETURNING u.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_batch_ids FROM stamped;

  -- Statement 2: matcher runs against exactly the stamped ids -- at most
  -- p_batch_limit calls, regardless of how many candidates exist.
  FOR v_sale IN
    SELECT s.id, s.sale_date, s.total_price, matched.rule_id, matched.rule_name,
           matched.category_id AS rule_category_id,
           matched.is_split_rule, matched.split_categories
    FROM unified_sales s
    CROSS JOIN LATERAL find_matching_rules_for_pos_sale(
      p_restaurant_id,
      jsonb_build_object('item_name', s.item_name, 'total_price', s.total_price,
                         'pos_category', s.pos_category)
    ) matched
    WHERE s.id = ANY(v_batch_ids)
      AND matched.rule_id IS NOT NULL
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
        SELECT * INTO v_split_result FROM split_pos_sale(v_sale.id, v_splits_with_amounts);
        IF NOT v_split_result.success THEN
          RAISE NOTICE 'Failed to split sale %: %', v_sale.id, v_split_result.message;
          -- A rule genuinely matched this row, but applying it failed. Statement 1
          -- already stamped this row at the current watermark; leaving that stamp
          -- in place would permanently exclude it from every future sweep even
          -- after the blocking condition (bad split config, etc.) is fixed. Reset
          -- it so the row stays a candidate. See EXCEPTION handler below for the
          -- same reasoning applied to the non-split path.
          UPDATE unified_sales SET rules_evaluated_at = '-infinity' WHERE id = v_sale.id;
          CONTINUE;
        END IF;
      ELSE
        UPDATE unified_sales
        SET category_id = v_sale.rule_category_id, is_categorized = true, updated_at = now()
        WHERE id = v_sale.id;
      END IF;
      v_applied_count := v_applied_count + 1;
      -- Split children inherit the parent's sale_date, so recording the
      -- parent's date covers both the child INSERTs and the parent's UPDATE.
      v_applied_dates := v_applied_dates || v_sale.sale_date::date;
      UPDATE categorization_rules
      SET apply_count = apply_count + 1, last_applied_at = now()
      WHERE id = v_sale.rule_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error categorizing sale %: %', v_sale.id, SQLERRM;
      -- Same reasoning as the split-failure branch above: a rule matched, the
      -- apply raised (FK violation, check constraint, etc.), but statement 1's
      -- stamp is already on this row. Reset it so a transient failure does not
      -- become a silent, permanent miscategorization once the negative cache
      -- excludes the row from every subsequent sweep.
      UPDATE unified_sales SET rules_evaluated_at = '-infinity' WHERE id = v_sale.id;
    END;
  END LOOP;

  PERFORM set_config('app.skip_unified_sales_triggers', v_prev_skip, true);

  -- Re-aggregate the touched dates once each. Skipped when the caller had
  -- suppression on already -- that caller owns the re-aggregation.
  IF v_applied_count > 0 AND v_prev_skip IS DISTINCT FROM 'true' THEN
    PERFORM aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
    FROM (SELECT DISTINCT unnest(v_applied_dates) AS sale_date) d;
  END IF;

  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

COMMENT ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer) IS
  'Background/service-role rule sweep for unified_sales. Evaluates at most '
  'p_batch_limit rows per call against the restaurant''s rule set, stamping '
  'rules_evaluated_at so unmatched rows are not re-evaluated until a rule '
  'changes. Callers needing a permission check must use apply_rules_to_pos_sales.';

REVOKE EXECUTE ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer)
  TO service_role;

-- Bound the bank-transaction rule-matching sweep, mirroring the
-- apply_rules_to_pos_sales_internal fix above: statement 1 picks and stamps
-- a bounded batch (no matcher involved, so LIMIT binds); statement 2 runs the
-- matcher against exactly those ids. Unlike unified_sales, bank_transactions
-- has no aggregation-on-UPDATE trigger to suppress -- verified via
-- pg_get_triggerdef(bank_transactions): only update_accounting_updated_at,
-- auto_categorize_bank_transaction (BEFORE INSERT), and
-- reset_bank_transactions_rules_evaluated_at (Task 1) fire on this table, so
-- the sweep needs no skip-flag dance and no re-aggregation step.
--
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.2-§3.4
CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions_internal(
  p_restaurant_id UUID,
  p_batch_limit   INTEGER DEFAULT 100,
  p_skip_rebuild  BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
  v_rules_changed_at    TIMESTAMPTZ;
  v_batch_ids           UUID[];
BEGIN
  -- Guard: reject NULL or non-positive batch limits (LIMIT NULL removes cap; negative aborts loops).
  IF p_batch_limit IS NULL OR p_batch_limit < 1 THEN
    RAISE EXCEPTION 'p_batch_limit must be a positive integer, got %', p_batch_limit;
  END IF;

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

  -- Rule watermark. This predicate MUST mirror
  -- find_matching_rules_for_bank_transaction's own rule-selection predicate
  -- exactly -- is_active and applies_to, and nothing else. In particular NOT
  -- auto_apply: the matcher ignores it, so a narrower watermark here would
  -- let a rule the matcher applies change without invalidating the cache,
  -- producing a silent permanent miss.
  SELECT max(GREATEST(cr.created_at, COALESCE(cr.updated_at, cr.created_at)))
    INTO v_rules_changed_at
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND (cr.applies_to = 'bank_transactions' OR cr.applies_to = 'both');

  -- No rule can match: equivalent to running to completion with zero matches,
  -- minus all the work. Deliberately writes nothing.
  IF v_rules_changed_at IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Statement 1: select and stamp the batch BEFORE any matching happens.
  -- MATERIALIZED is required -- PG12+ inlines single-reference CTEs, which
  -- would dissolve the LIMIT back into the outer query and reintroduce the
  -- bug.
  --
  -- This UPDATE fires reset_bank_transactions_rules_evaluated_at, but that
  -- trigger only resets when description/amount/supplier_id change, and this
  -- statement touches none of them -- so the stamp it just wrote survives.
  WITH batch AS MATERIALIZED (
    SELECT bt.id
    FROM bank_transactions bt
    WHERE bt.restaurant_id = p_restaurant_id
      AND (bt.is_categorized = false OR bt.category_id IS NULL)
      AND bt.is_split = false
      AND bt.excluded_reason IS NULL
      AND bt.rules_evaluated_at < v_rules_changed_at
    ORDER BY bt.transaction_date DESC
    LIMIT p_batch_limit
  ), stamped AS (
    UPDATE bank_transactions u
       SET rules_evaluated_at = v_rules_changed_at
      FROM batch b
     WHERE u.id = b.id
    RETURNING u.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_batch_ids FROM stamped;

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
    WHERE bt.id = ANY(v_batch_ids)
      AND matched.rule_id IS NOT NULL
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
        SET
          is_split       = true,
          is_categorized = true,
          category_id    = NULL,
          -- Supplier assignment on split path: same assign-not-filter semantics as non-split.
          -- Transaction's own supplier wins; rule supplier assigned when transaction has none.
          supplier_id    = COALESCE(v_transaction.supplier_id, v_transaction.rule_supplier_id, supplier_id),
          updated_at     = now()
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
      -- A rule matched, but the apply raised (closed fiscal period, inactive
      -- category, split-amount mismatch, etc.). Statement 1 already stamped
      -- this row at the current watermark; leaving that stamp in place would
      -- permanently exclude it from every future sweep even after the
      -- blocking condition clears (period reopened, category reactivated).
      -- Reset it so the row stays a candidate for retry.
      UPDATE bank_transactions SET rules_evaluated_at = '-infinity' WHERE id = v_transaction.id;
    END;
  END LOOP;

  IF v_applied_count > 0 AND NOT p_skip_rebuild THEN
    PERFORM rebuild_account_balances(p_restaurant_id);
  END IF;

  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer, boolean)
  TO service_role;
