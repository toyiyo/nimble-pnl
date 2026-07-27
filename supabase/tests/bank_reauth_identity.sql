-- pgTAP coverage for Phase 4 Tasks 1 and 5 of the bank re-authentication flow
-- (docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §3.1, §4.1, §4.2).
--
-- Migrations under test:
--   20260723130000_connected_banks_reauth_columns.sql (Task 1)
--   20260723130150_reconnect_bank_identity_safe.sql (Task 5)
--
-- Task 1 covers:
--   1. connected_banks gains account_mask/deactivated_at/data_current_through,
--      correctly typed (timestamptz, not date).
--   2. connected_banks_identity_uniq rejects a second *live* row sharing
--      (restaurant_id, institution_name, account_mask).
--   3. That index does NOT block multiple 'disconnected' rows on the same
--      tuple (the predicate excludes them).
--   4. NULL account_mask rows never conflict (NULLs are distinct in a unique
--      index) — the legacy/unknown-mask path.
--   5. idx_bank_transactions_bank_date exists, supporting the
--      data_current_through recompute in Task 6.
--
-- Task 5 covers the SQL the webhook handler issues via three service-role-only
-- RPCs (mark_connected_bank_deactivated, mark_connected_bank_reactivated,
-- reconnect_connected_bank):
--   6. A `deactivated` event sets status='requires_reauth' and stamps
--      deactivated_at + sync_error.
--   7. A second `deactivated` event (redelivery) leaves an existing
--      deactivated_at unchanged — COALESCE, not now() — so the escalation
--      clock does not reset.
--   8. A `reactivated` event restores 'connected' and nulls deactivated_at
--      and sync_error.
--   9. The step-1 identity UPDATE cannot steal a row that is already live
--      (status='connected') under a different stripe_financial_account_id.
--  10. Three accounts at one institution with distinct masks reconnect to
--      three distinct rows — no cross-graft. This is the bug the whole
--      change exists for.
--  11. `ON CONFLICT ... DO UPDATE` turns a concurrent double-submitted
--      account.created race into an update rather than a 23505.

BEGIN;

SELECT plan(37);

SET LOCAL role TO postgres;

ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_banks DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Column existence + types
-- ============================================================

SELECT has_column(
  'public', 'connected_banks', 'account_mask',
  'connected_banks should have account_mask column'
);

SELECT col_type_is(
  'public', 'connected_banks', 'account_mask', 'text',
  'account_mask should be TEXT'
);

SELECT has_column(
  'public', 'connected_banks', 'deactivated_at',
  'connected_banks should have deactivated_at column'
);

SELECT col_type_is(
  'public', 'connected_banks', 'deactivated_at', 'timestamp with time zone',
  'deactivated_at should be TIMESTAMPTZ'
);

SELECT has_column(
  'public', 'connected_banks', 'data_current_through',
  'connected_banks should have data_current_through column'
);

SELECT col_type_is(
  'public', 'connected_banks', 'data_current_through', 'timestamp with time zone',
  'data_current_through should be TIMESTAMPTZ, not DATE (design §3.1 correction)'
);

-- ============================================================
-- Indexes
-- ============================================================

SELECT has_index(
  'public', 'connected_banks', 'connected_banks_identity_uniq',
  'connected_banks should have the connected_banks_identity_uniq partial unique index'
);

SELECT has_index(
  'public', 'bank_transactions', 'idx_bank_transactions_bank_date',
  'bank_transactions should have idx_bank_transactions_bank_date for the data_current_through recompute'
);

-- ============================================================
-- Behavioral coverage of the partial unique index
-- ============================================================

CREATE TEMP TABLE _ids AS
SELECT '00000000-0000-0000-0000-0000d0000001'::uuid AS r_one;

DELETE FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids);
DELETE FROM public.restaurants WHERE id = (SELECT r_one FROM _ids);

INSERT INTO public.restaurants (id, name, address, phone)
SELECT r_one, 'Reauth Identity Test', '1 Test Way', '555-0100' FROM _ids;

-- First live row inserts cleanly.
SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_001', 'Chase', 'connected', '1234' FROM _ids
  $$,
  'first live row with (restaurant, institution, mask) inserts cleanly'
);

-- A second, distinct fca_ id with the same (restaurant, institution, mask)
-- tuple while still 'connected' must violate the partial unique index.
SELECT throws_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_002', 'Chase', 'connected', '1234' FROM _ids
  $$,
  '23505',
  NULL,
  'a second live row on the same (restaurant, institution, mask) tuple raises unique_violation'
);

-- Same tuple, but 'requires_reauth' status — also live, must also conflict.
SELECT throws_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_003', 'Chase', 'requires_reauth', '1234' FROM _ids
  $$,
  '23505',
  NULL,
  'a live requires_reauth row on the same tuple also raises unique_violation'
);

-- Any number of 'disconnected' rows on the same tuple are permitted — the
-- partial index predicate excludes status = 'disconnected'.
SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_004', 'Chase', 'disconnected', '1234' FROM _ids
  $$,
  'first disconnected row on the same tuple inserts cleanly'
);

SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_005', 'Chase', 'disconnected', '1234' FROM _ids
  $$,
  'a second disconnected row on the same tuple also inserts cleanly (index predicate excludes disconnected)'
);

-- Two rows with NULL account_mask at the same institution both insert —
-- NULLs are distinct in a unique index, so this never conflicts. This is the
-- legacy/unknown-mask path.
SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_006', 'Wells Fargo', 'connected', NULL FROM _ids
  $$,
  'first NULL-mask row inserts cleanly'
);

SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_007', 'Wells Fargo', 'connected', NULL FROM _ids
  $$,
  'second NULL-mask row at the same institution also inserts cleanly (NULLs are distinct)'
);

-- ============================================================
-- Task 5 — webhook `deactivated` / `reactivated` handlers
-- and identity-safe reconnect (design §4.1, §4.2)
-- ============================================================

SELECT has_function(
  'public', 'mark_connected_bank_deactivated', ARRAY['text', 'text'],
  'mark_connected_bank_deactivated(stripe_financial_account_id, sync_error) should exist'
);

SELECT has_function(
  'public', 'mark_connected_bank_reactivated', ARRAY['text'],
  'mark_connected_bank_reactivated(stripe_financial_account_id) should exist'
);

SELECT has_function(
  'public', 'reconnect_connected_bank',
  ARRAY['uuid', 'text', 'text', 'text', 'text'],
  'reconnect_connected_bank(restaurant_id, stripe_financial_account_id, institution_name, institution_logo_url, account_mask) should exist'
);

-- ------------------------------------------------------------
-- deactivated / reactivated (§4.1)
-- ------------------------------------------------------------

INSERT INTO public.connected_banks
  (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
SELECT r_one, 'fca_deact_test_001', 'Ally', 'connected', '9999' FROM _ids;

CREATE TEMP TABLE _deact_result_1 AS
SELECT * FROM public.mark_connected_bank_deactivated(
  'fca_deact_test_001',
  'Your bank ended this connection. Reconnect to resume transactions.'
);

SELECT is(
  (SELECT status::text FROM _deact_result_1),
  'requires_reauth',
  'a deactivated event sets status to requires_reauth'
);

SELECT ok(
  (SELECT deactivated_at FROM _deact_result_1) IS NOT NULL,
  'a deactivated event stamps deactivated_at'
);

SELECT is(
  (SELECT sync_error FROM _deact_result_1),
  'Your bank ended this connection. Reconnect to resume transactions.',
  'a deactivated event sets sync_error to the reconnect prompt'
);

-- Force deactivated_at to a fixed past instant (not now()) so a redelivery
-- can be proven to leave it alone rather than merely landing on the same
-- transaction-frozen now() by coincidence.
UPDATE public.connected_banks
   SET deactivated_at = '2020-01-01T00:00:00Z'::timestamptz
 WHERE stripe_financial_account_id = 'fca_deact_test_001';

CREATE TEMP TABLE _deact_result_2 AS
SELECT * FROM public.mark_connected_bank_deactivated(
  'fca_deact_test_001',
  'Your bank ended this connection. Reconnect to resume transactions.'
);

SELECT is(
  (SELECT deactivated_at FROM _deact_result_2),
  '2020-01-01T00:00:00Z'::timestamptz,
  'a second (redelivered) deactivated event leaves an existing deactivated_at unchanged — COALESCE, not now()'
);

CREATE TEMP TABLE _react_result AS
SELECT * FROM public.mark_connected_bank_reactivated('fca_deact_test_001');

SELECT is(
  (SELECT status::text FROM _react_result),
  'connected',
  'a reactivated event restores status to connected'
);

SELECT ok(
  (SELECT deactivated_at FROM _react_result) IS NULL,
  'a reactivated event nulls deactivated_at'
);

SELECT ok(
  (SELECT sync_error FROM _react_result) IS NULL,
  'a reactivated event nulls sync_error'
);

-- ------------------------------------------------------------
-- Step-1 identity UPDATE cannot steal a row already live under a
-- different stripe_financial_account_id (§4.2 step 1 guard).
-- Fresh institution/mask (not Chase/1234, which already carries two
-- 'disconnected' siblings from the identity-uniq coverage above — reusing
-- it would make an unqualified status-only UPDATE match both of them and
-- collide on connected_banks_identity_uniq, which is a different bug than
-- the one this assertion targets).
-- ------------------------------------------------------------

INSERT INTO public.connected_banks
  (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
SELECT r_one, 'fca_usbank_live', 'US Bank', 'connected', '2468' FROM _ids;

-- WITH containing a data-modifying statement must be at the statement's top
-- level, so the UPDATE + count live in this CREATE TABLE AS rather than as
-- a subexpression inside SELECT is(...).
CREATE TEMP TABLE _hijack_attempt AS
WITH upd AS (
  UPDATE public.connected_banks
     SET stripe_financial_account_id = 'fca_usbank_hijack',
         status = 'connected',
         connected_at = now(),
         disconnected_at = NULL,
         deactivated_at = NULL,
         sync_error = NULL
   WHERE restaurant_id = (SELECT r_one FROM _ids)
     AND institution_name = 'US Bank'
     AND account_mask = '2468'
     AND status IN ('disconnected', 'requires_reauth', 'error')
     AND stripe_financial_account_id IS DISTINCT FROM 'fca_usbank_hijack'
  RETURNING id
)
SELECT count(*)::int AS n FROM upd;

SELECT is(
  (SELECT n FROM _hijack_attempt),
  0,
  'the step-1 identity UPDATE affects 0 rows when the only matching-identity row is already connected — it cannot steal a live row'
);

SELECT is(
  (SELECT stripe_financial_account_id FROM public.connected_banks
    WHERE restaurant_id = (SELECT r_one FROM _ids)
      AND institution_name = 'US Bank' AND account_mask = '2468' AND status = 'connected'),
  'fca_usbank_live',
  'the live US Bank/2468 row keeps its original stripe_financial_account_id untouched'
);

-- ------------------------------------------------------------
-- Three accounts at one institution with distinct masks reconnect to
-- three distinct rows — no cross-graft (§4.2, the bug this design fixes).
-- ------------------------------------------------------------

INSERT INTO public.connected_banks
  (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
SELECT r_one, v.fca, 'Regions', 'disconnected', v.mask
FROM _ids, (VALUES
  ('fca_regions_old_1', '4001'),
  ('fca_regions_old_2', '4002'),
  ('fca_regions_old_3', '4003')
) AS v(fca, mask);

CREATE TEMP TABLE _reconnect_1 AS
SELECT * FROM public.reconnect_connected_bank(
  (SELECT r_one FROM _ids), 'fca_regions_new_1', 'Regions', NULL, '4001'
);
CREATE TEMP TABLE _reconnect_2 AS
SELECT * FROM public.reconnect_connected_bank(
  (SELECT r_one FROM _ids), 'fca_regions_new_2', 'Regions', NULL, '4002'
);
CREATE TEMP TABLE _reconnect_3 AS
SELECT * FROM public.reconnect_connected_bank(
  (SELECT r_one FROM _ids), 'fca_regions_new_3', 'Regions', NULL, '4003'
);

SELECT is(
  (SELECT count(DISTINCT id)::int FROM (
    SELECT id FROM _reconnect_1
    UNION ALL SELECT id FROM _reconnect_2
    UNION ALL SELECT id FROM _reconnect_3
  ) x),
  3,
  'three accounts at one institution with distinct masks reconnect to three distinct rows'
);

SELECT is(
  (SELECT stripe_financial_account_id FROM public.connected_banks
    WHERE restaurant_id = (SELECT r_one FROM _ids) AND institution_name = 'Regions' AND account_mask = '4001'),
  'fca_regions_new_1',
  'the 4001 row got its own new fca_ id, not a sibling''s'
);

SELECT is(
  (SELECT stripe_financial_account_id FROM public.connected_banks
    WHERE restaurant_id = (SELECT r_one FROM _ids) AND institution_name = 'Regions' AND account_mask = '4002'),
  'fca_regions_new_2',
  'the 4002 row got its own new fca_ id, not a sibling''s'
);

SELECT is(
  (SELECT stripe_financial_account_id FROM public.connected_banks
    WHERE restaurant_id = (SELECT r_one FROM _ids) AND institution_name = 'Regions' AND account_mask = '4003'),
  'fca_regions_new_3',
  'the 4003 row got its own new fca_ id, not a sibling''s'
);

SELECT is(
  (SELECT count(*)::int FROM public.connected_banks
    WHERE restaurant_id = (SELECT r_one FROM _ids) AND institution_name = 'Regions'),
  3,
  'no extra rows were created — exactly the three original rows remain, updated in place'
);

-- ------------------------------------------------------------
-- ON CONFLICT ... DO UPDATE turns a concurrent double-submitted
-- account.created race into an update rather than a 23505 (§4.2 step 2).
-- ------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT public.reconnect_connected_bank(
      (SELECT r_one FROM _ids), 'fca_frost_1', 'Frost Bank', NULL, '7777'
    )
  $$,
  'the first account.created for a brand-new identity inserts cleanly via reconnect_connected_bank'
);

-- Demonstrates why the ON CONFLICT clause is required: a bare INSERT into
-- the same now-live identity tuple raises unique_violation.
SELECT throws_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_frost_naive_insert', 'Frost Bank', 'connected', '7777' FROM _ids
  $$,
  '23505',
  NULL,
  'a bare INSERT (no ON CONFLICT) into the same live identity tuple raises unique_violation — the race reconnect_connected_bank must absorb'
);

-- A second, concurrent-style account.created for the SAME identity (a
-- double-submitted Link flow) must turn into an UPDATE, not a 23505.
SELECT lives_ok(
  $$
    SELECT public.reconnect_connected_bank(
      (SELECT r_one FROM _ids), 'fca_frost_2', 'Frost Bank', NULL, '7777'
    )
  $$,
  'a second concurrent reconnect for the same identity does not raise 23505 — ON CONFLICT DO UPDATE absorbs it'
);

SELECT is(
  (SELECT count(*)::int FROM public.connected_banks
    WHERE restaurant_id = (SELECT r_one FROM _ids) AND institution_name = 'Frost Bank' AND account_mask = '7777'),
  1,
  'the double-submit race leaves exactly one row for the identity, not two'
);

SELECT is(
  (SELECT stripe_financial_account_id FROM public.connected_banks
    WHERE restaurant_id = (SELECT r_one FROM _ids) AND institution_name = 'Frost Bank' AND account_mask = '7777'),
  'fca_frost_2',
  'ON CONFLICT DO UPDATE won the race — the row now tracks the latest fca_ id'
);

-- Cleanup
DELETE FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids);
DELETE FROM public.restaurants WHERE id = (SELECT r_one FROM _ids);

SELECT * FROM finish();
ROLLBACK;
