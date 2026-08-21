-- apply_rules_to_bank_transactions_internal writes the restaurant-local entry day
--
-- Change: this migration changes only the entry-day derivation and the
-- fiscal-period guard basis. It replaces the raw transaction_date cast
-- with bank_txn_entry_day(transaction_date, restaurant.timezone), looked
-- up once per call, in three places: the closed-period guard, the
-- new-entry journal entry insert, and the existing-entry UPDATE branch.
-- It also heals entry_date on the existing-entry UPDATE branch, so a
-- re-sweep call fixes a previously wrong-day entry instead of leaving it
-- stale.
--
-- This migration is a CREATE OR REPLACE of the function body from
-- supabase/migrations/20260804090300_bounded_categorization_sweep.sql.
-- Every other line of that function body is byte-identical.
--
-- See docs/superpowers/specs/2026-08-20-journal-entry-date-timezone-design.md.

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
  v_timezone            text;
  v_entry_day           date;
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

  -- Rule watermark. Single definition, shared with the POS sweep and with
  -- drain_categorization_backlog's retirement guard -- see the function's
  -- comment for why it must not be re-derived inline.
  v_rules_changed_at := public.categorization_rules_watermark(p_restaurant_id, 'bank_transactions');

  -- No rule can match: equivalent to running to completion with zero matches,
  -- minus all the work. Deliberately writes nothing.
  IF v_rules_changed_at IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- One expression for the entry day; the guard below and the insert use
  -- it. Never derive the day a second way (PR #766 lesson).
  SELECT timezone INTO v_timezone
  FROM restaurants
  WHERE id = p_restaurant_id;

  -- Statement 1: select and stamp the batch BEFORE any matching happens.
  -- MATERIALIZED is required -- PG12+ inlines single-reference CTEs, which
  -- would dissolve the LIMIT back into the outer query and reintroduce the
  -- bug.
  --
  -- This UPDATE fires reset_bank_transactions_rules_evaluated_at, but that
  -- trigger only resets when description/amount/supplier_id change, and this
  -- statement touches none of them -- so the stamp it just wrote survives.
  --
  -- FOR UPDATE SKIP LOCKED makes the batch a claim rather than a guess, for
  -- the same reason as the POS sweep above. It matters more here: the apply
  -- path INSERTs into bank_transaction_splits, which has no uniqueness
  -- constraint, so two sweeps claiming the same row would duplicate splits.
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
    FOR UPDATE SKIP LOCKED
  ), stamped AS (
    UPDATE bank_transactions u
       SET rules_evaluated_at = v_rules_changed_at
      FROM batch b
     WHERE u.id = b.id
    RETURNING u.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_batch_ids FROM stamped;

  -- Candidates CLAIMED, not matched -- see the note in
  -- apply_rules_to_pos_sales_internal. Callers loop on this, not applied_count.
  v_total_count := COALESCE(array_length(v_batch_ids, 1), 0);

  -- ORDER BY restored: id = ANY(uuid[]) does not preserve the batch ordering.
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
    ORDER BY bt.transaction_date DESC
  LOOP
    BEGIN
      v_entry_day := bank_txn_entry_day(v_transaction.transaction_date, v_timezone);

      SELECT id INTO v_fiscal_period_id
      FROM fiscal_periods
      WHERE restaurant_id = p_restaurant_id
        AND v_entry_day >= period_start
        AND v_entry_day <= period_end
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
          entry_date   = v_entry_day,
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
          v_entry_day,
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

COMMENT ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer, boolean) IS
  'Background/service-role rule sweep for bank_transactions. Evaluates at most '
  'p_batch_limit rows per call, stamping rules_evaluated_at so unmatched rows '
  'are not re-evaluated until a rule changes. Returns (applied_count, '
  'total_count) where total_count is the number of candidates CLAIMED this '
  'call, not the number matched: loop on total_count > 0, not applied_count > 0.';

REVOKE EXECUTE ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer, boolean)
  TO service_role;
