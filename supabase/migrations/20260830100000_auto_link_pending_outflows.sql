-- Auto-link pending outflows to matching bank transactions.
--
-- New columns on pending_outflows:
--   auto_linked_at            -- set when a link was made by this function
--   auto_link_suppressed_at   -- set by unlink_pending_outflow (a later
--                                 migration); a non-null value removes the
--                                 outflow from the candidate set below.
--
-- normalize_match_text(text): lowercase, strip every character outside
-- a-z0-9. Used for the vendor-name containment check.
--
-- auto_link_pending_outflows_internal: the background writer. Mirrors
-- confirmMatch (src/hooks/usePendingOutflows.tsx:134-301) for the write
-- shape, and apply_rules_to_bank_transactions_internal
-- (20260820210300_sweep_local_entry_day.sql) for the claim/lock/per-pair
-- exception pattern.
--
-- See docs/superpowers/specs/2026-08-30-pending-outflow-auto-link-design.md
-- sections 5 and 6.

ALTER TABLE pending_outflows
  ADD COLUMN IF NOT EXISTS auto_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_link_suppressed_at timestamptz;

CREATE OR REPLACE FUNCTION normalize_match_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(COALESCE(p_text, '')), '[^a-z0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION auto_link_pending_outflows_internal(
  p_restaurant_id UUID,
  p_batch_limit   INTEGER DEFAULT 100,
  p_skip_rebuild  BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  linked_count    INTEGER,
  candidate_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pair                   RECORD;
  v_po                     RECORD;
  v_bt                     RECORD;
  v_linked_count           INTEGER := 0;
  v_candidate_count        INTEGER := 0;
  v_cash_account_id        UUID;
  v_category_id             UUID;
  v_category_name           TEXT;
  v_fiscal_period_id        UUID;
  v_journal_entry_id        UUID;
  v_existing_journal_entry  UUID;
  v_timezone                 TEXT;
  v_entry_day                DATE;
  v_merged_notes             TEXT;
  v_upload_id                UUID;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit < 1 THEN
    RAISE EXCEPTION 'p_batch_limit must be a positive integer, got %', p_batch_limit;
  END IF;

  -- No permission check: this function is for background/service-role
  -- callers only (grants below).

  SELECT id INTO v_cash_account_id
  FROM chart_of_accounts
  WHERE restaurant_id = p_restaurant_id
    AND account_code = '1000'
  LIMIT 1;

  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash account (1000) not found for restaurant %', p_restaurant_id;
  END IF;

  SELECT timezone INTO v_timezone
  FROM restaurants
  WHERE id = p_restaurant_id;

  -- Candidate pairs: deterministic criteria (design §5). Amount exact,
  -- forward-only 14-day window on the restaurant-local entry day, vendor
  -- normalized containment in either direction, and exactly one match on
  -- both sides -- any tie disqualifies both rows for this pass.
  FOR v_pair IN
    WITH eligible_outflows AS (
      SELECT po.id,
             po.amount,
             po.issue_date,
             normalize_match_text(po.vendor_name) AS norm_vendor
      FROM pending_outflows po
      WHERE po.restaurant_id = p_restaurant_id
        AND po.status IN ('pending', 'stale_30', 'stale_60', 'stale_90')
        AND po.linked_bank_transaction_id IS NULL
        AND po.auto_link_suppressed_at IS NULL
    ),
    eligible_transactions AS (
      SELECT bt.id,
             bt.amount,
             bank_txn_entry_day(bt.transaction_date, v_timezone) AS entry_day,
             normalize_match_text(bt.merchant_name)     AS norm_merchant,
             normalize_match_text(bt.description)       AS norm_description,
             normalize_match_text(bt.normalized_payee)  AS norm_payee
      FROM bank_transactions bt
      WHERE bt.restaurant_id = p_restaurant_id
        AND bt.amount < 0
        AND bt.is_categorized = false
        AND bt.is_split = false
        AND bt.is_transfer = false
        AND bt.excluded_reason IS NULL
        AND bt.is_reconciled = false
        AND NOT EXISTS (
          SELECT 1 FROM pending_outflows po2
          WHERE po2.linked_bank_transaction_id = bt.id
        )
    ),
    pairs AS (
      SELECT eo.id AS pending_outflow_id, et.id AS bank_transaction_id
      FROM eligible_outflows eo
      JOIN eligible_transactions et
        ON ABS(eo.amount + et.amount) < 0.01
       AND et.entry_day >= eo.issue_date
       AND et.entry_day <= eo.issue_date + 14
       AND length(eo.norm_vendor) >= 3
       AND (
         (length(et.norm_merchant) >= 3
           AND (strpos(et.norm_merchant, eo.norm_vendor) > 0
                OR strpos(eo.norm_vendor, et.norm_merchant) > 0))
         OR (length(et.norm_description) >= 3
           AND (strpos(et.norm_description, eo.norm_vendor) > 0
                OR strpos(eo.norm_vendor, et.norm_description) > 0))
         OR (length(et.norm_payee) >= 3
           AND (strpos(et.norm_payee, eo.norm_vendor) > 0
                OR strpos(eo.norm_vendor, et.norm_payee) > 0))
       )
    ),
    unique_pairs AS (
      SELECT p.pending_outflow_id, p.bank_transaction_id
      FROM pairs p
      WHERE (SELECT count(*) FROM pairs p2 WHERE p2.pending_outflow_id = p.pending_outflow_id) = 1
        AND (SELECT count(*) FROM pairs p3 WHERE p3.bank_transaction_id = p.bank_transaction_id) = 1
    )
    SELECT * FROM unique_pairs
    ORDER BY pending_outflow_id
    LIMIT p_batch_limit
  LOOP
    v_candidate_count := v_candidate_count + 1;

    BEGIN
      -- Claim both rows before the write. FOR UPDATE SKIP LOCKED makes the
      -- claim a fact, not a guess -- a concurrent categorize, bulk
      -- categorize, or rules sweep loses the race instead of racing this
      -- write.
      SELECT * INTO v_po
      FROM pending_outflows
      WHERE id = v_pair.pending_outflow_id
      FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_bt
      FROM bank_transactions
      WHERE id = v_pair.bank_transaction_id
      FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      -- Re-check eligibility after the claim. A plain read is not enough --
      -- something can commit between the candidate scan above and the lock.
      IF v_po.status NOT IN ('pending', 'stale_30', 'stale_60', 'stale_90')
         OR v_po.linked_bank_transaction_id IS NOT NULL
         OR v_po.auto_link_suppressed_at IS NOT NULL THEN
        CONTINUE;
      END IF;

      IF v_bt.amount >= 0
         OR v_bt.is_categorized
         OR v_bt.is_split
         OR v_bt.is_transfer
         OR v_bt.excluded_reason IS NOT NULL
         OR v_bt.is_reconciled THEN
        CONTINUE;
      END IF;

      -- Merge notes. Skip the merge when the bank notes already contain the
      -- outflow notes, so a re-run of this pair does not duplicate text.
      IF v_bt.notes IS NOT NULL AND v_po.notes IS NOT NULL
         AND strpos(v_bt.notes, v_po.notes) > 0 THEN
        v_merged_notes := v_bt.notes;
      ELSE
        v_merged_notes := NULLIF(concat_ws(E'\n\n', v_bt.notes, v_po.notes), '');
      END IF;

      SELECT id INTO v_upload_id
      FROM expense_invoice_uploads
      WHERE pending_outflow_id = v_po.id
      ORDER BY created_at
      LIMIT 1;

      v_category_id := NULL;
      v_category_name := NULL;
      IF v_po.category_id IS NOT NULL THEN
        SELECT id, account_name INTO v_category_id, v_category_name
        FROM chart_of_accounts
        WHERE id = v_po.category_id
          AND restaurant_id = p_restaurant_id
          AND is_active = true;
      END IF;

      IF v_category_id IS NOT NULL THEN
        -- Category branch: post the journal entry, categorize the
        -- transaction.
        v_entry_day := bank_txn_entry_day(v_bt.transaction_date, v_timezone);

        SELECT id INTO v_fiscal_period_id
        FROM fiscal_periods
        WHERE restaurant_id = p_restaurant_id
          AND v_entry_day >= period_start
          AND v_entry_day <= period_end
          AND is_closed = true
        LIMIT 1;

        IF v_fiscal_period_id IS NOT NULL THEN
          RAISE EXCEPTION 'Bank transaction % in closed fiscal period', v_bt.id;
        END IF;

        SELECT id INTO v_existing_journal_entry
        FROM journal_entries
        WHERE reference_type = 'bank_transaction'
          AND reference_id = v_bt.id
          AND restaurant_id = p_restaurant_id
        LIMIT 1;

        IF v_existing_journal_entry IS NOT NULL THEN
          v_journal_entry_id := v_existing_journal_entry;
          DELETE FROM journal_entry_lines WHERE journal_entry_id = v_existing_journal_entry;
          UPDATE journal_entries
          SET entry_date   = v_entry_day,
              entry_number = 'BANK-' || COALESCE(v_bt.stripe_transaction_id, v_bt.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
              description  = 'Matched pending outflow: ' || v_po.vendor_name,
              total_debit  = ABS(v_bt.amount),
              total_credit = ABS(v_bt.amount),
              updated_at   = now()
          WHERE id = v_existing_journal_entry;
        ELSE
          INSERT INTO journal_entries (
            restaurant_id, entry_date, entry_number, description,
            reference_type, reference_id, total_debit, total_credit, created_by
          ) VALUES (
            p_restaurant_id,
            v_entry_day,
            'BANK-' || COALESCE(v_bt.stripe_transaction_id, v_bt.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
            'Matched pending outflow: ' || v_po.vendor_name,
            'bank_transaction',
            v_bt.id,
            ABS(v_bt.amount),
            ABS(v_bt.amount),
            NULL   -- background writer; created_by is nullable
          ) RETURNING id INTO v_journal_entry_id;
        END IF;

        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
        VALUES
          (v_journal_entry_id, v_category_id, ABS(v_bt.amount), 0, v_category_name),
          (v_journal_entry_id, v_cash_account_id, 0, ABS(v_bt.amount), 'Cash payment');

        UPDATE bank_transactions
        SET category_id           = v_po.category_id,
            is_categorized        = true,
            suggested_category_id = v_po.category_id,
            notes                 = v_merged_notes,
            matched_at            = now(),
            matched_by            = NULL,
            expense_invoice_upload_id = COALESCE(v_upload_id, expense_invoice_upload_id),
            updated_at            = now()
        WHERE id = v_bt.id;
      ELSE
        -- No usable category (none set, or the set category is inactive):
        -- write the merged notes only. The transaction stays in For Review.
        UPDATE bank_transactions
        SET notes                 = v_merged_notes,
            matched_at            = now(),
            matched_by            = NULL,
            expense_invoice_upload_id = COALESCE(v_upload_id, expense_invoice_upload_id),
            updated_at            = now()
        WHERE id = v_bt.id;
      END IF;

      UPDATE pending_outflows
      SET status                     = 'cleared',
          linked_bank_transaction_id = v_bt.id,
          cleared_at                 = now(),
          auto_linked_at             = now(),
          updated_at                 = now()
      WHERE id = v_po.id;

      v_linked_count := v_linked_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error auto-linking outflow % to transaction %: %',
        v_pair.pending_outflow_id, v_pair.bank_transaction_id, SQLERRM;
      -- Per-pair failure (closed fiscal period, etc.) skips this pair. It
      -- does not abort the batch and does not stamp either row, so the pair
      -- is retried on the next tick once the blocking condition clears.
    END;
  END LOOP;

  IF v_linked_count > 0 AND NOT p_skip_rebuild THEN
    PERFORM rebuild_account_balances(p_restaurant_id);
  END IF;

  RETURN QUERY SELECT v_linked_count, v_candidate_count;
END;
$$;

COMMENT ON FUNCTION auto_link_pending_outflows_internal(uuid, integer, boolean) IS
  'Background/service-role auto-link of pending_outflows to bank_transactions. '
  'Deterministic criteria only (exact amount, 14-day forward window, normalized '
  'vendor containment, unique on both sides). Returns (linked_count, '
  'candidate_count) where candidate_count is the number of unique-matched pairs '
  'evaluated this call, not the number linked.';

REVOKE EXECUTE ON FUNCTION auto_link_pending_outflows_internal(uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION auto_link_pending_outflows_internal(uuid, integer, boolean)
  TO service_role;
