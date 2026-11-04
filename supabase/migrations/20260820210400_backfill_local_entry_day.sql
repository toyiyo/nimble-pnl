-- backfill_bank_transaction_journal_entries writes the restaurant-local entry day
--
-- Change: this migration changes only the entry-day derivation and the
-- fiscal-period guard basis. It replaces the raw transaction_date cast
-- with bank_txn_entry_day(transaction_date, restaurant.timezone) in two
-- places: the closed-period guard on tmp_backfill_candidates, and the
-- entry_date column of the journal_entries insert. It adds a JOIN to
-- restaurants so the candidate query carries the restaurant's timezone
-- (r.timezone) through to both call sites.
--
-- This migration is a CREATE OR REPLACE of the function body from
-- supabase/migrations/20260819232450_backfill_bank_transaction_journal_entries.sql.
-- Every other line of that function body is byte-identical.
--
-- See docs/superpowers/specs/2026-08-20-journal-entry-date-timezone-design.md.

CREATE OR REPLACE FUNCTION public.backfill_bank_transaction_journal_entries()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_entries_created int := 0;
  v_lines_created int := 0;
  v_restaurants_rebuilt int := 0;
  v_restaurant_id uuid;
BEGIN
  -- A rerun inside the same session (for example two calls in one pgTAP
  -- transaction, which never commits mid-test) must not collide with the
  -- previous call's temp tables. ON COMMIT DROP only fires at COMMIT.
  DROP TABLE IF EXISTS tmp_backfill_candidates;
  DROP TABLE IF EXISTS tmp_backfill_created_entries;

  -- Candidate predicate: categorized, not a transfer, not reconciled, not
  -- marked excluded, no existing journal entry for this bank_transaction,
  -- not inside a closed fiscal period, and the restaurant has a cash
  -- account 1000. The reconciled guard matches the bulk RPC: a reconciled
  -- row is settled and a backfill must not change its ledger. Production
  -- has 0 reconciled candidates (verified 2026-08-19), so this guard
  -- protects only a later rerun. The
  -- LEFT JOIN LATERAL mirrors the single RPC's cash-account LIMIT 1 so two
  -- accounts coded 1000 on one restaurant cannot fan out a row. A split
  -- parent needs no explicit filter here: category_id IS NOT NULL below
  -- already excludes it, because bank_transactions never carries both
  -- is_split = true and a non-null category_id (confirmed against
  -- production: 0 rows). The excluded_reason filter guards a case
  -- production does not currently have (0 of the 2,328 rows this backfill
  -- targets carry it) but this function stays in the database for a later
  -- rerun, so a future excluded+categorized row must not gain an entry
  -- either (same finding as the bulk RPC's guard, codex review on this PR).
  CREATE TEMP TABLE tmp_backfill_candidates ON COMMIT DROP AS
  SELECT
    bt.id AS bank_transaction_id,
    bt.restaurant_id,
    bt.category_id,
    bt.amount,
    bt.description,
    bt.stripe_transaction_id,
    bt.transaction_date,
    r.timezone,
    cat.account_name AS category_account_name,
    cash.id AS cash_account_id,
    row_number() OVER (ORDER BY bt.id) AS rn
  FROM bank_transactions bt
  JOIN chart_of_accounts cat
    ON cat.id = bt.category_id
   AND cat.restaurant_id = bt.restaurant_id
   AND cat.is_active = true
  JOIN restaurants r
    ON r.id = bt.restaurant_id
  LEFT JOIN LATERAL (
    SELECT coa.id
    FROM chart_of_accounts coa
    WHERE coa.restaurant_id = bt.restaurant_id
      AND coa.account_code = '1000'
    LIMIT 1
  ) cash ON true
  WHERE bt.is_categorized = true
    AND bt.category_id IS NOT NULL
    AND bt.is_transfer = false
    AND bt.is_reconciled = false
    AND bt.excluded_reason IS NULL
    AND cash.id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'bank_transaction'
        AND je.reference_id = bt.id
        AND je.restaurant_id = bt.restaurant_id
    )
    -- Compare on the same restaurant-local day the entry insert below uses
    -- for entry_date, from bank_txn_entry_day. A raw timestamptz >= date
    -- comparison casts at the session TimeZone and lets a transaction late
    -- on the period's last local day write an entry_date inside the
    -- closed period.
    AND NOT EXISTS (
      SELECT 1 FROM fiscal_periods fp
      WHERE fp.restaurant_id = bt.restaurant_id
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) >= fp.period_start
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) <= fp.period_end
        AND fp.is_closed = true
    );

  -- Statement 1: the CTE insert into journal_entries. ON CONFLICT DO
  -- NOTHING keeps a rerun idempotent (constraint unique_journal_entry_reference
  -- on reference_type, reference_id); RETURNING captures only the rows this
  -- call actually created, so a partial prior run does not double-count.
  -- entry_date comes from bank_txn_entry_day, the single convention
  -- expression: a date-anchored transaction_date keeps its UTC day, a real
  -- instant takes the restaurant-local day.
  -- The row_number() suffix on entry_number guarantees uniqueness inside
  -- this one statement even when clock_timestamp() repeats for two rows.
  CREATE TEMP TABLE tmp_backfill_created_entries ON COMMIT DROP AS
  WITH ins AS (
    INSERT INTO journal_entries (
      restaurant_id, entry_date, entry_number, description,
      reference_type, reference_id, total_debit, total_credit, created_by
    )
    SELECT
      c.restaurant_id,
      bank_txn_entry_day(c.transaction_date, c.timezone),
      'BANK-' || COALESCE(c.stripe_transaction_id, c.bank_transaction_id::text) || '-' ||
        TO_CHAR(clock_timestamp(), 'YYYYMMDD-HH24MISS-US') || '-' || c.rn::text,
      c.description,
      'bank_transaction', c.bank_transaction_id,
      ABS(c.amount), ABS(c.amount), NULL
    FROM tmp_backfill_candidates c
    ON CONFLICT ON CONSTRAINT unique_journal_entry_reference DO NOTHING
    RETURNING id, reference_id, restaurant_id
  )
  SELECT id, reference_id, restaurant_id FROM ins;

  GET DIAGNOSTICS v_entries_created = ROW_COUNT;

  -- Statement 2: two lines per entry actually created above, same sign
  -- convention as the single RPC (negative amount debits the category and
  -- credits cash; positive amount debits cash and credits the category).
  -- Joining only against tmp_backfill_created_entries means a rerun, which
  -- finds that table empty, inserts no lines twice.
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  SELECT
    e.id,
    CASE WHEN c.amount < 0 THEN c.category_id ELSE c.cash_account_id END,
    ABS(c.amount),
    0,
    CASE WHEN c.amount < 0 THEN c.category_account_name ELSE 'Cash received' END
  FROM tmp_backfill_created_entries e
  JOIN tmp_backfill_candidates c ON c.bank_transaction_id = e.reference_id
  UNION ALL
  SELECT
    e.id,
    CASE WHEN c.amount < 0 THEN c.cash_account_id ELSE c.category_id END,
    0,
    ABS(c.amount),
    CASE WHEN c.amount < 0 THEN 'Cash payment' ELSE c.category_account_name END
  FROM tmp_backfill_created_entries e
  JOIN tmp_backfill_candidates c ON c.bank_transaction_id = e.reference_id;

  GET DIAGNOSTICS v_lines_created = ROW_COUNT;

  FOR v_restaurant_id IN
    SELECT DISTINCT restaurant_id FROM tmp_backfill_created_entries
  LOOP
    PERFORM rebuild_account_balances(v_restaurant_id);
    v_restaurants_rebuilt := v_restaurants_rebuilt + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'entries_created', v_entries_created,
    'lines_created', v_lines_created,
    'restaurants_rebuilt', v_restaurants_rebuilt
  );
END;
$function$;

-- Maintenance function, not an API. The revoke from PUBLIC also strips
-- service_role, so the explicit grant below is required for the reuse
-- story (a later repair calls this again). Precedents that pair the
-- revoke with the grant: 20260804090300_bounded_categorization_sweep.sql
-- and 20260721150000_revel_sold_at_timezone_backfill.sql.
REVOKE EXECUTE ON FUNCTION public.backfill_bank_transaction_journal_entries() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_bank_transaction_journal_entries() TO service_role;

-- Run the backfill once, now. Local db reset runs this against an empty
-- database — the function returns zeros and this is a no-op there.
SET statement_timeout = 0;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.backfill_bank_transaction_journal_entries();
  RAISE NOTICE 'backfill_bank_transaction_journal_entries: %', v_result;
END $$;

RESET statement_timeout;
