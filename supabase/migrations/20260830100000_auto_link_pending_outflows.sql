-- Auto-link pending outflows to matching bank transactions.
--
-- New columns on pending_outflows:
--   auto_linked_at            -- set when a link was made by this function
--   auto_link_suppressed_at   -- set by unlink_pending_outflow (a later
--                                 migration); a non-null value removes the
--                                 outflow from the candidate set below.
--
-- normalize_match_text(text): lowercase, strip every character outside
-- a-z0-9. normalize_match_tokens(text): lowercase, collapse every
-- non-alphanumeric run to one space. vendor_text_match(text, text): the
-- shared vendor comparison — plain containment for strings of 5+
-- characters, token-boundary containment for shorter strings. The
-- token-boundary path stops a short string (3-4 characters) from a
-- false match across a word boundary (sound-logic review).
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

CREATE OR REPLACE FUNCTION normalize_match_tokens(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(lower(COALESCE(p_text, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- The one shared vendor comparison. Both the candidate scan and the
-- post-claim re-validation in auto_link_pending_outflows_internal call
-- this function, so the two sites cannot drift apart.
--
-- Rules (symmetric in both directions):
--   1. Both sides must normalize to 3+ characters.
--   2. Plain containment counts only when the contained side has 5+
--      characters. A shorter contained string can span a word boundary
--      by accident ('dco' inside 'rentandcox'), and this function gates
--      an unreviewed financial write.
--   3. A 3-4 character string still matches at a token boundary:
--      'cox' matches 'rent and cox', not 'randcorp'.
CREATE OR REPLACE FUNCTION vendor_text_match(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  WITH n AS (
    SELECT normalize_match_text(p_a)   AS na,
           normalize_match_text(p_b)   AS nb,
           normalize_match_tokens(p_a) AS ta,
           normalize_match_tokens(p_b) AS tb
  )
  SELECT CASE
    WHEN length(na) < 3 OR length(nb) < 3 THEN false
    ELSE (length(na) >= 5 AND strpos(nb, na) > 0)
      OR (length(nb) >= 5 AND strpos(na, nb) > 0)
      OR strpos(' ' || tb || ' ', ' ' || ta || ' ') > 0
      OR strpos(' ' || ta || ' ', ' ' || tb || ' ') > 0
  END
  FROM n;
$$;

COMMENT ON FUNCTION vendor_text_match(text, text) IS
  'Shared vendor comparison for pending-outflow auto-link. Plain containment '
  'for 5+ character strings; token-boundary containment for 3-4 character '
  'strings. False when either side normalizes to fewer than 3 characters.';

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
  v_upload_id               UUID;
  v_entry_number            TEXT;
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
  -- disqualifies both rows for this pass.
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
             po.vendor_name
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
             bt.normalized_payee
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
             count(*) OVER (PARTITION BY p.pending_outflow_id)  AS outflow_matches,
             count(*) OVER (PARTITION BY p.bank_transaction_id) AS transaction_matches
      FROM pairs p
    ),
    unique_pairs AS (
      SELECT cp.pending_outflow_id, cp.bank_transaction_id
      FROM counted_pairs cp
      WHERE cp.outflow_matches = 1
        AND cp.transaction_matches = 1
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
         OR v_bt.is_categorized
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

      UPDATE pending_outflows
      SET status                     = 'cleared',
          linked_bank_transaction_id = v_bt.id,
          cleared_at                 = now(),
          auto_linked_at             = now(),
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

  IF v_linked_count > 0 AND NOT p_skip_rebuild THEN
    PERFORM rebuild_account_balances(p_restaurant_id);
  END IF;

  RETURN QUERY SELECT v_linked_count, v_candidate_count;
END;
$$;

COMMENT ON FUNCTION auto_link_pending_outflows_internal(uuid, integer, boolean) IS
  'Background/service-role auto-link of pending_outflows to bank_transactions. '
  'Deterministic criteria only: exact amount, forward entry-day window '
  '[issue_date, issue_date + 14] (15 calendar days inclusive), vendor_text_match, '
  'unique on both sides. Returns (linked_count, candidate_count) where '
  'candidate_count is the number of unique-matched pairs evaluated this call, '
  'not the number linked.';

REVOKE EXECUTE ON FUNCTION auto_link_pending_outflows_internal(uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION auto_link_pending_outflows_internal(uuid, integer, boolean)
  TO service_role;
