-- Widen pending-outflow auto-link eligibility to categorized bank
-- transactions.
--
-- Before this migration, auto_link_pending_outflows_internal only
-- considered bank transactions with is_categorized = false. A pending
-- outflow whose vendor a categorization rule already matched (and
-- categorized) never linked, so the outflow stayed open forever.
--
-- This migration adds a linkability filter (design §4/§5): a categorized
-- transaction is linkable only when a journal entry backs the
-- categorization, and, when the outflow already carries a category, the
-- two categories agree. Three outcomes on a match:
--   Case A: transaction categorized, outflow category agrees or is unset
--           and the transaction's category then seeds the outflow.
--           Link only -- the journal entry and the transaction's
--           category, is_categorized, and suggested_category_id are left
--           untouched.
--   Case B: transaction categorized, outflow had no category -- same
--           link-only write, plus the outflow's category_id is set from
--           the transaction so the outflow record itself is not left
--           blank.
--   Case C: transaction categorized but the categories disagree, or no
--           journal entry backs it (a categorization made outside the
--           normal flow) -- not linkable this pass.
-- An uncategorized transaction keeps the two pre-existing branches: post
-- a journal entry and categorize it when the outflow carries an active
-- category, otherwise merge notes only and leave it in For Review.
--
-- See docs/superpowers/specs/2026-08-30-auto-link-categorized-transactions-design.md
-- sections 4 and 5.

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
  v_pair                    RECORD;
  v_po                      RECORD;
  v_bt                      RECORD;
  v_linked_count            INTEGER := 0;
  v_candidate_count         INTEGER := 0;
  v_cash_account_id         UUID;
  v_category_id             UUID;
  v_category_name           TEXT;
  v_fiscal_period_id        UUID;
  v_journal_entry_id        UUID;
  v_existing_journal_entry  UUID;
  v_timezone                TEXT;
  v_entry_day               DATE;
  v_merged_notes            TEXT;
  v_upload_id                UUID;
  v_entry_number            TEXT;
  v_wrote_ledger            BOOLEAN := false;
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
  -- forward window on the restaurant-local entry day (inclusive interval
  -- [issue_date, issue_date + 14], 15 calendar days), vendor match via
  -- vendor_text_match, and exactly one match on both sides -- any tie
  -- disqualifies both rows for this pass. A categorized transaction must
  -- also pass the linkability filter below.
  --
  -- Performance contract (performance review): the amount and the raw
  -- transaction_date predicates in the pairs join stay inline and
  -- sargable, so the planner can drive the join through the partial
  -- index idx_bank_transactions_auto_link (restaurant_id, amount,
  -- transaction_date). Do not move them into a function. The post-claim
  -- re-validation below mirrors the amount and window predicates.
  FOR v_pair IN
    WITH eligible_outflows AS (
      SELECT po.id,
             po.amount,
             po.issue_date,
             po.vendor_name,
             po.category_id
      FROM pending_outflows po
      WHERE po.restaurant_id = p_restaurant_id
        AND po.status IN ('pending', 'stale_30', 'stale_60', 'stale_90')
        AND po.linked_bank_transaction_id IS NULL
        AND po.auto_link_suppressed_at IS NULL
    ),
    eligible_transactions AS (
      SELECT bt.id,
             bt.amount,
             bt.transaction_date,
             bank_txn_entry_day(bt.transaction_date, v_timezone) AS entry_day,
             bt.merchant_name,
             bt.description,
             bt.normalized_payee,
             bt.is_categorized,
             bt.category_id
      FROM bank_transactions bt
      WHERE bt.restaurant_id = p_restaurant_id
        AND bt.amount < 0
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
      SELECT eo.id AS pending_outflow_id,
             et.id AS bank_transaction_id,
             eo.category_id    AS eo_category_id,
             et.is_categorized AS et_is_categorized,
             et.category_id    AS et_category_id
      FROM eligible_outflows eo
      JOIN eligible_transactions et
        -- Sargable range, equivalent to ABS(eo.amount + et.amount) < 0.01.
        ON et.amount > (- eo.amount) - 0.01
       AND et.amount < (- eo.amount) + 0.01
        -- Sargable pre-filter on the raw timestamp. The 2-day slack on each
        -- side covers every timezone skew between transaction_date and
        -- entry_day; the entry_day predicates below stay authoritative.
       AND et.transaction_date >= eo.issue_date - interval '2 days'
       AND et.transaction_date <  eo.issue_date + interval '17 days'
       AND et.entry_day >= eo.issue_date
       AND et.entry_day <= eo.issue_date + 14
       AND (vendor_text_match(eo.vendor_name, et.merchant_name)
         OR vendor_text_match(eo.vendor_name, et.description)
         OR vendor_text_match(eo.vendor_name, et.normalized_payee))
    ),
    counted_pairs AS (
      -- Window counts, not correlated subqueries: one sort per partition
      -- instead of O(pairs^2) rescans (performance review).
      SELECT p.pending_outflow_id,
             p.bank_transaction_id,
             p.eo_category_id,
             p.et_is_categorized,
             p.et_category_id,
             count(*) OVER (PARTITION BY p.pending_outflow_id)  AS outflow_matches,
             count(*) OVER (PARTITION BY p.bank_transaction_id) AS transaction_matches
      FROM pairs p
    ),
    unique_pairs AS (
      SELECT cp.pending_outflow_id,
             cp.bank_transaction_id,
             cp.eo_category_id,
             cp.et_is_categorized,
             cp.et_category_id
      FROM counted_pairs cp
      WHERE cp.outflow_matches = 1
        AND cp.transaction_matches = 1
    ),
    linkable_pairs AS (
      -- Linkability filter (design §4/§5): an uncategorized transaction
      -- is always linkable. A categorized transaction is linkable only
      -- when a journal entry backs the categorization and, when the
      -- outflow already carries a category, the two categories agree.
      SELECT up.pending_outflow_id, up.bank_transaction_id
      FROM unique_pairs up
      WHERE up.et_is_categorized = false
         OR (
           EXISTS (
             SELECT 1 FROM journal_entries je
             WHERE je.reference_type = 'bank_transaction'
               AND je.reference_id = up.bank_transaction_id
               AND je.restaurant_id = p_restaurant_id
           )
           AND (up.eo_category_id IS NULL OR up.eo_category_id = up.et_category_id)
         )
    )
    SELECT * FROM linkable_pairs
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
        AND restaurant_id = p_restaurant_id
      FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_bt
      FROM bank_transactions
      WHERE id = v_pair.bank_transaction_id
        AND restaurant_id = p_restaurant_id
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

      -- Re-check the NOT EXISTS guard from the candidate scan too. A concurrent
      -- call (the sweep and the Stripe-sync inline call can run at the same
      -- time) can commit a link to this same transaction, for a different
      -- outflow, between the candidate scan and this claim. The bank-row lock
      -- alone does not catch that once the other call has committed.
      IF v_bt.amount >= 0
         OR v_bt.is_split
         OR v_bt.is_transfer
         OR v_bt.excluded_reason IS NOT NULL
         OR v_bt.is_reconciled
         OR EXISTS (
           SELECT 1 FROM pending_outflows po2
           WHERE po2.linked_bank_transaction_id = v_bt.id
         ) THEN
        CONTINUE;
      END IF;

      -- Re-validate the match itself, not just the row flags above. Nothing
      -- in this function edits an outflow's amount/vendor or a transaction's
      -- amount/date/description, but the claim can still land after an
      -- unrelated edit committed between the candidate scan and this lock,
      -- so the match criteria from the scan (design §5) are recomputed here
      -- against the locked rows before either row is written. The amount
      -- and window predicates mirror the pairs join above; the vendor
      -- comparison is the same shared vendor_text_match function.
      v_entry_day := bank_txn_entry_day(v_bt.transaction_date, v_timezone);

      IF ABS(v_po.amount + v_bt.amount) >= 0.01
         OR v_entry_day < v_po.issue_date
         OR v_entry_day > v_po.issue_date + 14
         OR NOT (vendor_text_match(v_po.vendor_name, v_bt.merchant_name)
              OR vendor_text_match(v_po.vendor_name, v_bt.description)
              OR vendor_text_match(v_po.vendor_name, v_bt.normalized_payee)) THEN
        CONTINUE;
      END IF;

      -- Linkability re-check on the locked rows (design §4/§5), mirroring
      -- the linkable_pairs filter above. A categorized transaction needs a
      -- journal entry and, when the outflow already carries a category,
      -- agreement between the two categories.
      IF v_bt.is_categorized THEN
        IF NOT EXISTS (
             SELECT 1 FROM journal_entries je
             WHERE je.reference_type = 'bank_transaction'
               AND je.reference_id = v_bt.id
               AND je.restaurant_id = p_restaurant_id
           )
           OR (v_po.category_id IS NOT NULL AND v_po.category_id != v_bt.category_id) THEN
          CONTINUE;
        END IF;
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
        AND restaurant_id = p_restaurant_id
      ORDER BY created_at
      LIMIT 1;

      IF v_bt.is_categorized THEN
        -- Case A/B: the transaction is already categorized and
        -- journal-backed (checked above). Link only -- merge notes and
        -- match metadata, and leave the journal entry, category_id,
        -- is_categorized, and suggested_category_id untouched.
        UPDATE bank_transactions
        SET notes                      = v_merged_notes,
            matched_at                 = now(),
            matched_by                 = NULL,
            expense_invoice_upload_id  = COALESCE(v_upload_id, expense_invoice_upload_id),
            updated_at                 = now()
        WHERE id = v_bt.id
          AND restaurant_id = p_restaurant_id;
      ELSE
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
          -- transaction. v_entry_day was already computed above during the
          -- match re-validation.
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

          v_entry_number := 'BANK-' || COALESCE(v_bt.stripe_transaction_id, v_bt.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US');

          IF v_existing_journal_entry IS NOT NULL THEN
            v_journal_entry_id := v_existing_journal_entry;
            DELETE FROM journal_entry_lines WHERE journal_entry_id = v_existing_journal_entry;
            UPDATE journal_entries
            SET entry_date   = v_entry_day,
                entry_number = v_entry_number,
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
              v_entry_number,
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

          v_wrote_ledger := true;

          UPDATE bank_transactions
          SET category_id           = v_po.category_id,
              is_categorized        = true,
              suggested_category_id = v_po.category_id,
              notes                 = v_merged_notes,
              matched_at            = now(),
              matched_by            = NULL,
              expense_invoice_upload_id = COALESCE(v_upload_id, expense_invoice_upload_id),
              updated_at            = now()
          WHERE id = v_bt.id
            AND restaurant_id = p_restaurant_id;
        ELSE
          -- No usable category (none set, or the set category is inactive):
          -- write the merged notes only. The transaction stays in For Review.
          UPDATE bank_transactions
          SET notes                 = v_merged_notes,
              matched_at            = now(),
              matched_by            = NULL,
              expense_invoice_upload_id = COALESCE(v_upload_id, expense_invoice_upload_id),
              updated_at            = now()
          WHERE id = v_bt.id
            AND restaurant_id = p_restaurant_id;
        END IF;
      END IF;

      UPDATE pending_outflows
      SET status                     = 'cleared',
          linked_bank_transaction_id = v_bt.id,
          cleared_at                 = now(),
          auto_linked_at             = now(),
          -- Case B: the transaction carried a category and the outflow
          -- did not -- seed the outflow's category from the transaction
          -- so the outflow record is not left blank.
          category_id                = CASE
                                          WHEN v_bt.is_categorized AND v_po.category_id IS NULL
                                          THEN v_bt.category_id
                                          ELSE v_po.category_id
                                        END,
          updated_at                 = now()
      WHERE id = v_po.id
        AND restaurant_id = p_restaurant_id;

      v_linked_count := v_linked_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error auto-linking outflow % to transaction %: %',
        v_pair.pending_outflow_id, v_pair.bank_transaction_id, SQLERRM;
      -- Per-pair failure (closed fiscal period, etc.) skips this pair. It
      -- does not abort the batch and does not stamp either row, so the pair
      -- is retried on the next tick once the blocking condition clears.
    END;
  END LOOP;

  IF v_wrote_ledger AND NOT p_skip_rebuild THEN
    PERFORM rebuild_account_balances(p_restaurant_id);
  END IF;

  RETURN QUERY SELECT v_linked_count, v_candidate_count;
END;
$$;

COMMENT ON FUNCTION auto_link_pending_outflows_internal(uuid, integer, boolean) IS
  'Background/service-role auto-link of pending_outflows to bank_transactions. '
  'Deterministic criteria only: exact amount, forward entry-day window '
  '[issue_date, issue_date + 14] (15 calendar days inclusive), vendor_text_match, '
  'unique on both sides. A categorized transaction also needs a journal entry '
  'and category agreement with the outflow (or no outflow category). Returns '
  '(linked_count, candidate_count) where candidate_count is the number of '
  'unique-matched pairs evaluated this call, not the number linked.';

REVOKE EXECUTE ON FUNCTION auto_link_pending_outflows_internal(uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION auto_link_pending_outflows_internal(uuid, integer, boolean)
  TO service_role;

-- unlink_pending_outflow: the revert-safety check must not delete a
-- journal entry this function did not write. auto_link_pending_outflows_
-- internal now also links against a transaction categorized by something
-- else (a rule, a manual edit) without touching that journal entry, so
-- the description marker is the only reliable proof the entry came from
-- this flow (design §4.3, §7).
CREATE OR REPLACE FUNCTION public.unlink_pending_outflow(
  p_pending_outflow_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_po                        RECORD;
  v_bt                        RECORD;
  v_timezone                  TEXT;
  v_entry_day                 DATE;
  v_fiscal_period_id          UUID;
  v_journal_entry_id          UUID;
  v_journal_entry_description TEXT;
  v_upload_id                 UUID;
  v_can_revert                BOOLEAN;
  v_category_kept             BOOLEAN;
  v_new_status                TEXT;
BEGIN
  SELECT * INTO v_po
  FROM pending_outflows
  WHERE id = p_pending_outflow_id
  FOR UPDATE;

  IF v_po.id IS NULL THEN
    RAISE EXCEPTION 'Pending outflow not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE restaurant_id = v_po.restaurant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  IF v_po.status != 'cleared' OR v_po.linked_bank_transaction_id IS NULL THEN
    RAISE EXCEPTION 'Pending outflow is not linked to a bank transaction';
  END IF;

  SELECT * INTO v_bt
  FROM bank_transactions
  WHERE id = v_po.linked_bank_transaction_id
    AND restaurant_id = v_po.restaurant_id
  FOR UPDATE;

  IF v_bt.id IS NULL THEN
    RAISE EXCEPTION 'Linked bank transaction not found';
  END IF;

  SELECT timezone INTO v_timezone
  FROM restaurants
  WHERE id = v_po.restaurant_id;

  v_entry_day := bank_txn_entry_day(v_bt.transaction_date, v_timezone);

  SELECT id INTO v_fiscal_period_id
  FROM fiscal_periods
  WHERE restaurant_id = v_po.restaurant_id
    AND v_entry_day >= period_start
    AND v_entry_day <= period_end
    AND is_closed = true
  LIMIT 1;

  SELECT id, description INTO v_journal_entry_id, v_journal_entry_description
  FROM journal_entries
  WHERE reference_type = 'bank_transaction'
    AND reference_id = v_bt.id
    AND restaurant_id = v_po.restaurant_id
  LIMIT 1;

  -- Revert-safety condition list (design §7 step 2, §4.3). All must hold,
  -- or the categorization stays and the UI is told to recategorize
  -- manually. The description check stops this function from deleting a
  -- journal entry the auto-link did not write -- a categorized
  -- transaction can now link without posting one of its own.
  v_can_revert := v_po.auto_linked_at IS NOT NULL
    AND v_bt.is_categorized = true
    AND v_bt.category_id = v_po.category_id
    AND v_bt.is_reconciled = false
    AND v_fiscal_period_id IS NULL
    AND v_journal_entry_id IS NOT NULL
    AND v_journal_entry_description LIKE 'Matched pending outflow: %';

  SELECT id INTO v_upload_id
  FROM expense_invoice_uploads
  WHERE pending_outflow_id = v_po.id
  ORDER BY created_at
  LIMIT 1;

  IF v_can_revert THEN
    DELETE FROM journal_entry_lines WHERE journal_entry_id = v_journal_entry_id;
    DELETE FROM journal_entries WHERE id = v_journal_entry_id;

    UPDATE bank_transactions
    SET is_categorized          = false,
        category_id             = NULL,
        suggested_category_id   = NULL,
        rules_evaluated_at      = '-infinity',
        matched_at               = NULL,
        matched_by               = NULL,
        expense_invoice_upload_id = CASE WHEN expense_invoice_upload_id = v_upload_id THEN NULL ELSE expense_invoice_upload_id END,
        updated_at                = now()
    WHERE id = v_bt.id;

    v_category_kept := false;
  ELSE
    UPDATE bank_transactions
    SET matched_at                = NULL,
        matched_by                = NULL,
        expense_invoice_upload_id = CASE WHEN expense_invoice_upload_id = v_upload_id THEN NULL ELSE expense_invoice_upload_id END,
        updated_at                = now()
    WHERE id = v_bt.id;

    v_category_kept := true;
  END IF;

  -- Same thresholds as mark_stale_pending_outflows
  -- (20251107141500_pending_outflows.sql:98-121). No cron job calls that
  -- function, so a plain 'pending' reset on an old outflow would stay
  -- wrong forever.
  v_new_status := CASE
    WHEN v_po.issue_date <= CURRENT_DATE - INTERVAL '90 days' THEN 'stale_90'
    WHEN v_po.issue_date <= CURRENT_DATE - INTERVAL '60 days' THEN 'stale_60'
    WHEN v_po.issue_date <= CURRENT_DATE - INTERVAL '30 days' THEN 'stale_30'
    ELSE 'pending'
  END;

  UPDATE pending_outflows
  SET status                     = v_new_status,
      linked_bank_transaction_id = NULL,
      cleared_at                 = NULL,
      auto_linked_at             = NULL,
      auto_link_suppressed_at    = now(),
      updated_at                 = now()
  WHERE id = v_po.id;

  IF v_can_revert THEN
    PERFORM rebuild_account_balances(v_po.restaurant_id);
  END IF;

  RETURN jsonb_build_object('category_kept', v_category_kept, 'status', v_new_status);
END;
$$;

COMMENT ON FUNCTION public.unlink_pending_outflow(uuid) IS
  'Undoes an automatic (or manual) link between a pending outflow and a bank '
  'transaction. Reverts the categorization only when the revert is safe '
  '(auto-linked, category unchanged, not reconciled, open fiscal period, '
  'journal entry present with the auto-link description marker); otherwise '
  'keeps the categorization and returns category_kept = true. Owner/manager '
  'only. Stamps auto_link_suppressed_at so the sweep does not re-link the pair.';

REVOKE EXECUTE ON FUNCTION public.unlink_pending_outflow(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unlink_pending_outflow(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.unlink_pending_outflow(uuid) TO authenticated;
