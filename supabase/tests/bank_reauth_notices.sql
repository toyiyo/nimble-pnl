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

SELECT plan(29);

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

-- Composite FK (connected_bank_id, restaurant_id) -> connected_banks(id,
-- restaurant_id) — not a single-column FK on connected_bank_id alone, so
-- col_is_fk is called with both columns (CodeRabbit finding: prevents a
-- notice's connected_bank_id from belonging to a different restaurant_id
-- than the one on the row, which RLS trusts).
SELECT col_is_fk(
  'public', 'bank_reauth_notices', ARRAY['connected_bank_id', 'restaurant_id'],
  'connected_bank_id + restaurant_id should be a composite foreign key to connected_banks'
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
-- Composite FK actually blocks a cross-tenant mismatch (the vulnerability
-- CodeRabbit flagged: two independent single-column FKs would have allowed
-- a notice for restaurant A's bank to be tagged with restaurant B, and RLS
-- authorizes purely from bank_reauth_notices.restaurant_id).
-- ============================================================

DELETE FROM public.user_restaurants
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000097';
DELETE FROM public.restaurants
  WHERE id = '00000000-0000-0000-0000-0000e0000097';

INSERT INTO public.restaurants (id, name, address, phone)
VALUES (
  '00000000-0000-0000-0000-0000e0000097', 'Reauth Notices Test (Other Tenant)', '2 Test Way', '555-0197'
);

SELECT throws_ok(
  $$
    INSERT INTO public.bank_reauth_notices
      (restaurant_id, connected_bank_id, stage, deactivated_at)
    VALUES (
      '00000000-0000-0000-0000-0000e0000097',
      '00000000-0000-0000-0000-0000e0000098',
      'day_1',
      '2026-07-20T00:00:00Z'
    )
  $$,
  '23503',
  NULL,
  'a notice tagging restaurant B with restaurant A''s connected_bank_id is rejected (composite FK)'
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
-- Cleanup (Tasks 1-13's fixtures)
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
DELETE FROM public.restaurants
  WHERE id = '00000000-0000-0000-0000-0000e0000097';

-- ============================================================
-- Task 14: bank-reauth-notices worker RPCs (design §4.6):
-- bank_reauth_cohort_a_candidates() / bank_reauth_cohort_b_recovered() /
-- bank_reauth_notice_recipients(uuid, text[]).
-- Migration: 20260723130200_schedule_bank_reauth_notices.sql
-- ============================================================

SELECT has_function(
  'public', 'bank_reauth_cohort_a_candidates',
  'bank_reauth_cohort_a_candidates() should exist'
);

SELECT has_function(
  'public', 'bank_reauth_cohort_b_recovered',
  'bank_reauth_cohort_b_recovered() should exist'
);

SELECT has_function(
  'public', 'bank_reauth_notice_recipients', ARRAY['uuid', 'text[]'],
  'bank_reauth_notice_recipients(uuid, text[]) should exist'
);

-- ------------------------------------------------------------
-- Fixtures: a dedicated restaurant, two connected_banks (one still down,
-- one reconnected), and owner/manager/staff users.
-- ------------------------------------------------------------

DELETE FROM public.bank_reauth_notices
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000199';
DELETE FROM public.connected_banks
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000199';
DELETE FROM public.user_restaurants
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000199';
DELETE FROM public.restaurants
  WHERE id = '00000000-0000-0000-0000-0000e0000199';

INSERT INTO public.restaurants (id, name, address, phone)
VALUES (
  '00000000-0000-0000-0000-0000e0000199', 'Reauth Worker Test', '1 Test Way', '555-0299'
);

-- Bank A: still down. deactivated_at is `now() - 5 days` (not a date-floored
-- literal) so the elapsed-days math is exact regardless of what time of day
-- this test runs — `now()` is frozen to transaction start, so the INSERT
-- below and the RPC's own `now()` agree exactly.
INSERT INTO public.connected_banks
  (id, restaurant_id, stripe_financial_account_id, institution_name, status, deactivated_at)
VALUES (
  '00000000-0000-0000-0000-0000e0000198', '00000000-0000-0000-0000-0000e0000199',
  'fca_reauth_worker_test_a', 'Chase', 'requires_reauth', now() - interval '5 days'
);

-- Bank B: was down, a day_1 notice was already sent, then it reconnected —
-- status is back to 'connected' and deactivated_at has been nulled by the
-- webhook. This is the whole point of cohort B: the correlation key for the
-- recovery notice must come from bank_reauth_notices, not from this
-- now-NULL column.
INSERT INTO public.connected_banks
  (id, restaurant_id, stripe_financial_account_id, institution_name, status, deactivated_at)
VALUES (
  '00000000-0000-0000-0000-0000e0000197', '00000000-0000-0000-0000-0000e0000199',
  'fca_reauth_worker_test_b', 'Ally', 'connected', NULL
);

INSERT INTO public.bank_reauth_notices
  (restaurant_id, connected_bank_id, stage, deactivated_at)
VALUES (
  '00000000-0000-0000-0000-0000e0000199', '00000000-0000-0000-0000-0000e0000197',
  'day_1', '2026-07-10T00:00:00Z'
);

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000e0000101', 'reauth-worker-owner@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000e0000102', 'reauth-worker-manager@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000e0000103', 'reauth-worker-staff@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES
  ('00000000-0000-0000-0000-0000e0000101', '00000000-0000-0000-0000-0000e0000199', 'owner'),
  ('00000000-0000-0000-0000-0000e0000102', '00000000-0000-0000-0000-0000e0000199', 'manager'),
  ('00000000-0000-0000-0000-0000e0000103', '00000000-0000-0000-0000-0000e0000199', 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

SET LOCAL role TO postgres;

-- ------------------------------------------------------------
-- Cohort A — still down.
-- ------------------------------------------------------------

SELECT is(
  (SELECT elapsed_days FROM public.bank_reauth_cohort_a_candidates()
     WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000198'),
  5,
  'cohort A reports 5 whole UTC days elapsed for a bank deactivated 5 days ago'
);

SELECT is(
  (SELECT sent_stages FROM public.bank_reauth_cohort_a_candidates()
     WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000198'),
  ARRAY[]::text[],
  'cohort A reports no sent_stages yet for a bank with no bank_reauth_notices rows'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.bank_reauth_cohort_a_candidates()
    WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000197'
  ),
  'cohort A never includes a connected bank (no live outage clock)'
);

INSERT INTO public.bank_reauth_notices
  (restaurant_id, connected_bank_id, stage, deactivated_at)
VALUES (
  '00000000-0000-0000-0000-0000e0000199', '00000000-0000-0000-0000-0000e0000198', 'day_1',
  (SELECT deactivated_at FROM public.connected_banks WHERE id = '00000000-0000-0000-0000-0000e0000198')
);

SELECT is(
  (SELECT sent_stages FROM public.bank_reauth_cohort_a_candidates()
     WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000198'),
  ARRAY['day_1']::text[],
  'cohort A picks up a day_1 notice already sent for this exact outage'
);

-- TZ sweep cluster F (.superpowers/sdd/tz-f-bank-reauth-brief.md,
-- 20260731020000_bank_reauth_cohort_restaurant_timezone.sql): the worker's
-- TS layer renders deactivated_at/data_current_through in the restaurant's
-- own timezone, not the server's — cohort A must actually select it.
SELECT is(
  (SELECT restaurant_timezone FROM public.bank_reauth_cohort_a_candidates()
     WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000198'),
  (SELECT timezone FROM public.restaurants WHERE id = '00000000-0000-0000-0000-0000e0000199'),
  'cohort A includes the restaurant''s own IANA timezone (restaurants.timezone), not a default the RPC invents'
);

-- ------------------------------------------------------------
-- Cohort B — recovered. The core RED scenario for this task: the recovery
-- notice's correlation key comes from bank_reauth_notices, not from
-- connected_banks.deactivated_at (which is NULL on bank B — the webhook
-- already cleared it on reconnect).
-- ------------------------------------------------------------

SELECT is(
  (SELECT count(*)::int FROM public.bank_reauth_cohort_b_recovered()
     WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000197'),
  1,
  'cohort B finds the reconnected bank via bank_reauth_notices even though connected_banks.deactivated_at is NULL'
);

SELECT is(
  (SELECT deactivated_at FROM public.bank_reauth_cohort_b_recovered()
     WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000197'),
  '2026-07-10T00:00:00Z'::timestamptz,
  'cohort B sources deactivated_at from the notices table, not the (now-NULL) bank row'
);

-- See the cohort A restaurant_timezone test above for why this matters.
SELECT is(
  (SELECT restaurant_timezone FROM public.bank_reauth_cohort_b_recovered()
     WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000197'),
  (SELECT timezone FROM public.restaurants WHERE id = '00000000-0000-0000-0000-0000e0000199'),
  'cohort B also includes the restaurant''s own IANA timezone for the recovery-receipt email'
);

-- Acknowledge the recovery: once a 'recovered' row exists for this exact
-- (connected_bank_id, deactivated_at), cohort B stops returning it.
INSERT INTO public.bank_reauth_notices
  (restaurant_id, connected_bank_id, stage, deactivated_at)
VALUES (
  '00000000-0000-0000-0000-0000e0000199', '00000000-0000-0000-0000-0000e0000197',
  'recovered', '2026-07-10T00:00:00Z'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.bank_reauth_cohort_b_recovered()
    WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000197'
  ),
  'cohort B stops returning a bank once its recovery has been acknowledged'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.bank_reauth_cohort_b_recovered()
    WHERE connected_bank_id = '00000000-0000-0000-0000-0000e0000198'
  ),
  'cohort B never includes a bank that is still requires_reauth'
);

-- ------------------------------------------------------------
-- Recipients — filtered by the roles the current stage calls for.
-- ------------------------------------------------------------

SELECT is(
  (SELECT count(*)::int FROM public.bank_reauth_notice_recipients(
     '00000000-0000-0000-0000-0000e0000199', ARRAY['owner', 'manager'])),
  2,
  'bank_reauth_notice_recipients(owner+manager) returns exactly the owner and manager, not staff'
);

SELECT is(
  (SELECT count(*)::int FROM public.bank_reauth_notice_recipients(
     '00000000-0000-0000-0000-0000e0000199', ARRAY['owner'])),
  1,
  'bank_reauth_notice_recipients(owner) narrows to owners only, e.g. for the day_10 stage'
);

-- ------------------------------------------------------------
-- Cleanup (this section's own fixtures)
-- ------------------------------------------------------------

DELETE FROM public.bank_reauth_notices
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000199';
DELETE FROM public.connected_banks
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000199';
DELETE FROM public.user_restaurants
  WHERE restaurant_id = '00000000-0000-0000-0000-0000e0000199';
DELETE FROM public.restaurants
  WHERE id = '00000000-0000-0000-0000-0000e0000199';

SELECT * FROM finish();
ROLLBACK;
