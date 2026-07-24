-- pgTAP coverage for Phase 4 Task 2 of the bank re-authentication flow
-- (docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §3.2, §3.3).
--
-- Migration under test: 20260723130100_bank_reauth_notices.sql
--
-- Covers:
--   1. bank_reauth_notices exists with the stage CHECK constraint
--      (day_1/day_4/day_10/recovered).
--   2. bank_reauth_notices_once blocks a duplicate
--      (connected_bank_id, stage, deactivated_at); a *different*
--      deactivated_at inserts fine (a later outage re-notifies).
--   3. A restaurant member can SELECT; a non-member gets zero rows — proves
--      the GRANT *and* the policy (without the GRANT the query errors with
--      "permission denied" before RLS even runs, so a policy-only test would
--      pass vacuously).
--   4. notification_channel_settings accepts 'bank_reauth_required' and still
--      rejects a bogus key.

BEGIN;

SELECT plan(13);

SET LOCAL role TO postgres;

-- ============================================================
-- Table / column / constraint existence
-- ============================================================

SELECT has_table(
  'public', 'bank_reauth_notices',
  'bank_reauth_notices table should exist'
);

SELECT has_column(
  'public', 'bank_reauth_notices', 'stage',
  'bank_reauth_notices should have a stage column'
);

SELECT col_type_is(
  'public', 'bank_reauth_notices', 'deactivated_at', 'timestamp with time zone',
  'deactivated_at should be TIMESTAMPTZ'
);

SELECT col_is_fk(
  'public', 'bank_reauth_notices', 'connected_bank_id',
  'connected_bank_id should be a foreign key'
);

SELECT has_index(
  'public', 'bank_reauth_notices', 'bank_reauth_notices_once',
  'bank_reauth_notices should have the bank_reauth_notices_once dedupe constraint index'
);

SELECT throws_ok(
  $$
    INSERT INTO public.bank_reauth_notices
      (restaurant_id, connected_bank_id, stage, deactivated_at)
    VALUES (
      '00000000-0000-0000-0000-0000e0000099',
      '00000000-0000-0000-0000-0000e0000098',
      'bogus_stage',
      now()
    )
  $$,
  '23514',
  NULL,
  'stage CHECK constraint rejects a value outside day_1/day_4/day_10/recovered'
);

-- ============================================================
-- Fixtures for the dedupe-constraint and RLS tests
-- ============================================================

DELETE FROM public.bank_reauth_notices
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099';
DELETE FROM public.connected_banks
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099';
DELETE FROM public.user_restaurants
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099';
DELETE FROM public.restaurants
  WHERE id = '00000000-0000-0000-0000-0000e0000099';

INSERT INTO public.restaurants (id, name, address, phone)
VALUES (
  '00000000-0000-0000-0000-0000e0000099', 'Reauth Notices Test', '1 Test Way', '555-0199'
);

INSERT INTO public.connected_banks
  (id, restaurant_id, stripe_financial_account_id, institution_name, status)
VALUES (
  '00000000-0000-0000-0000-0000e0000098', '00000000-0000-0000-0000-0000e0000099',
  'fca_reauth_notices_test', 'Chase', 'requires_reauth'
);

-- Member auth user (has access via user_restaurants).
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000e0000001', 'test-reauth-member@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES (
  '00000000-0000-0000-0000-0000e0000002',
  '00000000-0000-0000-0000-0000e0000001',
  '00000000-0000-0000-0000-0000e0000099',
  'owner'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Non-member auth user (no user_restaurants row for this restaurant).
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000e0000003', 'test-reauth-nonmember@example.com')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- bank_reauth_notices_once dedupe constraint
-- ============================================================

SELECT lives_ok(
  $$
    INSERT INTO public.bank_reauth_notices
      (restaurant_id, connected_bank_id, stage, deactivated_at)
    VALUES (
      '00000000-0000-0000-0000-0000e0000099',
      '00000000-0000-0000-0000-0000e0000098',
      'day_1',
      '2026-07-01T00:00:00Z'
    )
  $$,
  'first (connected_bank_id, stage, deactivated_at) row inserts cleanly'
);

SELECT throws_ok(
  $$
    INSERT INTO public.bank_reauth_notices
      (restaurant_id, connected_bank_id, stage, deactivated_at)
    VALUES (
      '00000000-0000-0000-0000-0000e0000099',
      '00000000-0000-0000-0000-0000e0000098',
      'day_1',
      '2026-07-01T00:00:00Z'
    )
  $$,
  '23505',
  NULL,
  'a duplicate (connected_bank_id, stage, deactivated_at) raises unique_violation'
);

SELECT lives_ok(
  $$
    INSERT INTO public.bank_reauth_notices
      (restaurant_id, connected_bank_id, stage, deactivated_at)
    VALUES (
      '00000000-0000-0000-0000-0000e0000099',
      '00000000-0000-0000-0000-0000e0000098',
      'day_1',
      '2026-07-15T00:00:00Z'
    )
  $$,
  'same stage but a different deactivated_at (a later, separate outage) inserts fine'
);

-- ============================================================
-- GRANT + RLS: a member can SELECT; a non-member sees zero rows.
-- Run as `authenticated` with JWT claims per user, exactly as Supabase
-- evaluates RLS in production — proves both the GRANT and the policy.
-- ============================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000e0000001","role":"authenticated"}';

SELECT ok(
  (SELECT count(*) FROM public.bank_reauth_notices
     WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099'::uuid) > 0,
  'a restaurant member can SELECT bank_reauth_notices rows for their restaurant'
);

RESET request.jwt.claims;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000e0000003","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.bank_reauth_notices
     WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099'::uuid),
  0,
  'a non-member sees zero rows (RLS policy, not just an empty-table vacuity)'
);

RESET request.jwt.claims;
SET LOCAL role TO postgres;

-- ============================================================
-- notification_channel_settings CHECK constraint gains
-- 'bank_reauth_required' and still rejects a bogus key.
-- ============================================================

DELETE FROM public.notification_channel_settings
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099';

SELECT lives_ok(
  $$
    INSERT INTO public.notification_channel_settings
      (restaurant_id, notification_type)
    VALUES ('00000000-0000-0000-0000-0000e0000099', 'bank_reauth_required')
  $$,
  'notification_channel_settings accepts the new bank_reauth_required key'
);

SELECT throws_ok(
  $$
    INSERT INTO public.notification_channel_settings
      (restaurant_id, notification_type)
    VALUES ('00000000-0000-0000-0000-0000e0000099', 'not_a_real_notification_type')
  $$,
  '23514',
  NULL,
  'notification_channel_settings still rejects a bogus notification_type'
);

-- ============================================================
-- Cleanup
-- ============================================================

DELETE FROM public.notification_channel_settings
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099';
DELETE FROM public.bank_reauth_notices
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099';
DELETE FROM public.connected_banks
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099';
DELETE FROM public.user_restaurants
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000099';
DELETE FROM public.restaurants
  WHERE id = '00000000-0000-0000-0000-0000e0000099';

SELECT * FROM finish();
ROLLBACK;
