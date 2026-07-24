-- pgTAP coverage for the bank_account_balances Stripe-identity fix
-- (migrations 20260724180200_bank_balances_rekey_connected_bank.sql and
--  20260724180300_upsert_stripe_bank_balance.sql).
--
-- ROOT CAUSE this fix addresses (production incident 2026-07-24, Huntington):
--   The Stripe balance upserts keyed ON CONFLICT on stripe_financial_account_id.
--   Stripe mints a NEW fca_ id per account on every reconnect, so the fca-keyed
--   upsert of the reconnected account did not match the pre-reconnect row and
--   INSERTED a second row. Two accounts became four rows; the orphaned old-fca_
--   row then re-flagged the whole bank requires_reauth.
--
-- CORRECTED invariant: bank_account_balances is NOT one-row-per-bank. It also
-- holds non-Stripe rows — CSV/statement-import balances and reconciliation
-- snapshots that useReconcileTransactions APPENDS with a NULL fca_. The real
-- invariant is narrower: at most ONE Stripe-origin row (fca_ NOT NULL) per
-- connected bank. The schema enforces exactly that via a PARTIAL unique index,
-- and nothing wider.
--
-- Covers:
--   1. The partial unique index bank_account_balances_stripe_bank_uniq exists.
--   2. The pre-existing UNIQUE(stripe_financial_account_id) constraint is KEPT
--      (orthogonal; permits multiple NULLs so snapshots coexist).
--   3. The plain lookup index on stripe_financial_account_id survives.
--   4. A first Stripe-origin balance row inserts cleanly.
--   5. A second Stripe row for the same bank (new fca_) raises 23505 — the
--      reconnect duplicate is now structurally impossible.
--   6-7. NULL-fca_ snapshot rows for the same bank coexist freely, and more
--      than one may exist (reconciliation history is preserved).
--   8. Exactly one Stripe row coexists with the snapshots (partial scope).
--   9-11. upsert_stripe_bank_balance() rotates the fca_ in place on reconnect,
--      leaving one Stripe row (new fca_) and leaving snapshots untouched.
--   12-13. The migration's Step-1 dedupe keeps the current-fca_ Stripe row,
--      deletes the orphaned old-fca_ Stripe row, and preserves snapshots.

BEGIN;

SELECT plan(13);

SET LOCAL role TO postgres;

ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_banks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_account_balances DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Index shape
-- ============================================================

SELECT has_index(
  'public', 'bank_account_balances', 'bank_account_balances_stripe_bank_uniq',
  'partial unique index on connected_bank_id (WHERE fca_ NOT NULL) exists — the Stripe-row identity key'
);

SELECT has_index(
  'public', 'bank_account_balances', 'bank_account_balances_stripe_account_unique',
  'the pre-existing UNIQUE(stripe_financial_account_id) constraint is kept (permits multiple NULLs, so snapshots coexist)'
);

SELECT has_index(
  'public', 'bank_account_balances', 'idx_bank_account_balances_stripe_account',
  'the plain lookup index on stripe_financial_account_id survives'
);

-- ============================================================
-- Fixture: one restaurant + one connected bank whose CURRENT fca_ is
-- fca_bal_test_current (the live account after reconnect).
-- ============================================================

CREATE TEMP TABLE _ids AS
SELECT '00000000-0000-0000-0000-0000b0000001'::uuid AS r_one;

DELETE FROM public.bank_account_balances
 WHERE connected_bank_id IN (
   SELECT id FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids)
 );
DELETE FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids);
DELETE FROM public.restaurants WHERE id = (SELECT r_one FROM _ids);

INSERT INTO public.restaurants (id, name, address, phone)
SELECT r_one, 'Balance Identity Test', '1 Test Way', '555-0100' FROM _ids;

INSERT INTO public.connected_banks
  (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
SELECT r_one, 'fca_bal_test_current', 'Huntington', 'connected', '2589' FROM _ids;

CREATE TEMP TABLE _bank AS
SELECT id AS bank_id FROM public.connected_banks
 WHERE restaurant_id = (SELECT r_one FROM _ids) AND account_mask = '2589';

-- ============================================================
-- Partial-index enforcement + snapshot coexistence
-- ============================================================

-- First Stripe-origin balance row (starts on the old fca_, pre-reconnect).
SELECT lives_ok(
  $$
    INSERT INTO public.bank_account_balances
      (connected_bank_id, account_name, stripe_financial_account_id, current_balance)
    SELECT bank_id, 'Huntington Business Checking 100', 'fca_bal_test_old', 48679.81 FROM _bank
  $$,
  'first Stripe-origin balance row for a connected bank inserts cleanly'
);

-- A second Stripe row for the SAME bank with a DIFFERENT fca_ — exactly the
-- duplicate the pre-fix reconnect created — must violate the partial index.
SELECT throws_ok(
  $$
    INSERT INTO public.bank_account_balances
      (connected_bank_id, account_name, stripe_financial_account_id, current_balance)
    SELECT bank_id, 'Huntington Business Checking 100', 'fca_bal_test_dup', 39218.59 FROM _bank
  $$,
  '23505',
  NULL,
  'a second Stripe row for the same bank (new fca_) raises unique_violation — the reconnect duplicate is now impossible'
);

-- A NULL-fca_ snapshot row (reconciliation/CSV import) for the SAME bank is
-- outside the partial index and coexists.
SELECT lives_ok(
  $$
    INSERT INTO public.bank_account_balances
      (connected_bank_id, account_name, stripe_financial_account_id, current_balance)
    SELECT bank_id, 'Reconcile snapshot', NULL, 100.00 FROM _bank
  $$,
  'a NULL-fca_ snapshot row for the same bank coexists (partial index does not cover it)'
);

-- A SECOND NULL-fca_ snapshot must also be allowed — reconciliation appends
-- history and must never collide.
SELECT lives_ok(
  $$
    INSERT INTO public.bank_account_balances
      (connected_bank_id, account_name, stripe_financial_account_id, current_balance)
    SELECT bank_id, 'Reconcile snapshot 2', NULL, 200.00 FROM _bank
  $$,
  'a second NULL-fca_ snapshot for the same bank is allowed (reconciliation history preserved)'
);

-- Exactly one Stripe row coexists with the two snapshots.
SELECT is(
  (SELECT count(*)::int FROM public.bank_account_balances b
     JOIN _bank ON b.connected_bank_id = _bank.bank_id
    WHERE b.stripe_financial_account_id IS NOT NULL),
  1,
  'exactly one Stripe-origin row exists for the bank while two NULL-fca_ snapshots coexist'
);

-- ============================================================
-- Forward guarantee: the RPC the edge functions call rotates the fca_ in place
-- ============================================================

SELECT lives_ok(
  $$
    SELECT public.upsert_stripe_bank_balance(
      (SELECT bank_id FROM _bank),
      'fca_bal_test_new', 'Huntington Business Checking 100', 'checking', '2589',
      39218.59, NULL, 'USD', true, now()
    )
  $$,
  'upsert_stripe_bank_balance rotates the fca_ in place on reconnect (no 23505)'
);

SELECT is(
  (SELECT stripe_financial_account_id FROM public.bank_account_balances b
     JOIN _bank ON b.connected_bank_id = _bank.bank_id
    WHERE b.stripe_financial_account_id IS NOT NULL),
  'fca_bal_test_new',
  'after the RPC exactly one Stripe row remains and it carries the new fca_ (rotated in place)'
);

SELECT is(
  (SELECT count(*)::int FROM public.bank_account_balances b
     JOIN _bank ON b.connected_bank_id = _bank.bank_id
    WHERE b.stripe_financial_account_id IS NULL),
  2,
  'the RPC left both NULL-fca_ snapshot rows untouched'
);

-- ============================================================
-- Step-1 dedupe: reproduce the pre-fix duplicate scenario and run the exact
-- ranked-CTE DELETE from the migration. The partial index blocks building the
-- duplicate, so drop it inside this (rolled-back) transaction first.
-- ============================================================

DROP INDEX public.bank_account_balances_stripe_bank_uniq;

-- Bank currently has one Stripe row (fca_bal_test_new) + 2 snapshots. Add the
-- orphaned OLD-fca_ Stripe row a reconnect would have left behind. Stamp the
-- current-fca_ row as OLDER so the dedupe cannot win it on recency alone —
-- it must win on the "matches connected_banks.stripe_financial_account_id"
-- tiebreak. First point the bank's current fca_ at fca_bal_test_new.
UPDATE public.connected_banks
   SET stripe_financial_account_id = 'fca_bal_test_new'
 WHERE id = (SELECT bank_id FROM _bank);

UPDATE public.bank_account_balances
   SET as_of_date = '2026-01-01', created_at = '2026-01-01'
 WHERE connected_bank_id = (SELECT bank_id FROM _bank)
   AND stripe_financial_account_id = 'fca_bal_test_new';

INSERT INTO public.bank_account_balances
  (connected_bank_id, account_name, stripe_financial_account_id, current_balance, as_of_date, created_at)
SELECT bank_id, 'Huntington Business Checking 100', 'fca_bal_test_orphan', 0.00, '2026-07-01', '2026-07-01'
  FROM _bank;

-- Exact Step-1 query from the migration.
WITH ranked AS (
  SELECT bab.id,
         row_number() OVER (
           PARTITION BY bab.connected_bank_id
           ORDER BY (bab.stripe_financial_account_id
                       IS NOT DISTINCT FROM cb.stripe_financial_account_id) DESC,
                    bab.as_of_date  DESC NULLS LAST,
                    bab.created_at  DESC NULLS LAST,
                    bab.id          DESC
         ) AS rn
    FROM public.bank_account_balances bab
    JOIN public.connected_banks cb ON cb.id = bab.connected_bank_id
   WHERE bab.stripe_financial_account_id IS NOT NULL
)
DELETE FROM public.bank_account_balances b
 USING ranked r
 WHERE b.id = r.id
   AND r.rn > 1;

SELECT is(
  (SELECT stripe_financial_account_id FROM public.bank_account_balances b
     JOIN _bank ON b.connected_bank_id = _bank.bank_id
    WHERE b.stripe_financial_account_id IS NOT NULL),
  'fca_bal_test_new',
  'dedupe keeps the Stripe row whose fca_ matches connected_banks (current), even though the orphan is more recent'
);

SELECT is(
  (SELECT count(*)::int FROM public.bank_account_balances b
     JOIN _bank ON b.connected_bank_id = _bank.bank_id),
  3,
  'dedupe deletes only the orphaned old-fca_ Stripe row: one Stripe row + two snapshots survive'
);

-- Cleanup
DELETE FROM public.bank_account_balances
 WHERE connected_bank_id IN (SELECT bank_id FROM _bank);
DELETE FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids);
DELETE FROM public.restaurants WHERE id = (SELECT r_one FROM _ids);

SELECT * FROM finish();
ROLLBACK;
