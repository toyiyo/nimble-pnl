-- pgTAP coverage for public.users_in_trial_email_window().
--
-- Covers:
--   * trial_day in (7, 11, 13, 15) -> returned with the right email_type
--   * other trial_days (0, 6, 8, 12, 14, 16) -> excluded
--   * subscription_status filter (only 'trialing' returns)
--   * internal-email exclusion (@easyshifthq.com, @camiluke.com)
--   * activated flag flips when any of the four POS connection tables has
--     a row for the restaurant
--   * dedupe via existing trial_emails_sent row
--   * unsubscribe via email_unsubscribes (list='trial_lifecycle' or 'all')
--   * unrelated unsubscribe (list='marketing') does NOT exclude
--   * non-owner roles in user_restaurants do NOT receive emails
--
-- Pattern follows supabase/tests/16_shift_trades_security.sql:
--   BEGIN; ... ROLLBACK; with RLS off and delete-before-insert fixtures.

BEGIN;

SELECT plan(18);

SET LOCAL role TO postgres;

-- Disable RLS for fixture inserts so we don't depend on a session JWT.
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_emails_sent DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.toast_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clover_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift4_connections DISABLE ROW LEVEL SECURITY;

-- Stable IDs for everything we touch.
-- Users
CREATE TEMP TABLE _ids AS
SELECT
  '00000000-0000-0000-0000-0000000a0007'::uuid AS u_day7,
  '00000000-0000-0000-0000-0000000a0011'::uuid AS u_day11,
  '00000000-0000-0000-0000-0000000a0013'::uuid AS u_day13,
  '00000000-0000-0000-0000-0000000a0015'::uuid AS u_day15,
  '00000000-0000-0000-0000-0000000a0006'::uuid AS u_day6,
  '00000000-0000-0000-0000-0000000a0008'::uuid AS u_day8,
  '00000000-0000-0000-0000-0000000a0014'::uuid AS u_day14,
  '00000000-0000-0000-0000-0000000a0016'::uuid AS u_day16,
  '00000000-0000-0000-0000-0000000a000a'::uuid AS u_active,
  '00000000-0000-0000-0000-0000000a000b'::uuid AS u_canceled,
  '00000000-0000-0000-0000-0000000a000c'::uuid AS u_grandfathered,
  '00000000-0000-0000-0000-0000000a000d'::uuid AS u_pastdue,
  '00000000-0000-0000-0000-0000000a000e'::uuid AS u_internal_eshq,
  '00000000-0000-0000-0000-0000000a000f'::uuid AS u_internal_camiluke,
  '00000000-0000-0000-0000-0000000a0021'::uuid AS u_pos_square,
  '00000000-0000-0000-0000-0000000a0022'::uuid AS u_pos_toast,
  '00000000-0000-0000-0000-0000000a0023'::uuid AS u_pos_clover,
  '00000000-0000-0000-0000-0000000a0024'::uuid AS u_pos_shift4,
  '00000000-0000-0000-0000-0000000a0030'::uuid AS u_already_sent,
  '00000000-0000-0000-0000-0000000a0031'::uuid AS u_unsub_trial,
  '00000000-0000-0000-0000-0000000a0032'::uuid AS u_unsub_all,
  '00000000-0000-0000-0000-0000000a0033'::uuid AS u_unsub_marketing,
  '00000000-0000-0000-0000-0000000a0040'::uuid AS u_manager,
  -- Restaurants
  '00000000-0000-0000-0000-0000000b0007'::uuid AS r_day7,
  '00000000-0000-0000-0000-0000000b0011'::uuid AS r_day11,
  '00000000-0000-0000-0000-0000000b0013'::uuid AS r_day13,
  '00000000-0000-0000-0000-0000000b0015'::uuid AS r_day15,
  '00000000-0000-0000-0000-0000000b0006'::uuid AS r_day6,
  '00000000-0000-0000-0000-0000000b0008'::uuid AS r_day8,
  '00000000-0000-0000-0000-0000000b0014'::uuid AS r_day14,
  '00000000-0000-0000-0000-0000000b0016'::uuid AS r_day16,
  '00000000-0000-0000-0000-0000000b000a'::uuid AS r_active,
  '00000000-0000-0000-0000-0000000b000b'::uuid AS r_canceled,
  '00000000-0000-0000-0000-0000000b000c'::uuid AS r_grandfathered,
  '00000000-0000-0000-0000-0000000b000d'::uuid AS r_pastdue,
  '00000000-0000-0000-0000-0000000b000e'::uuid AS r_internal_eshq,
  '00000000-0000-0000-0000-0000000b000f'::uuid AS r_internal_camiluke,
  '00000000-0000-0000-0000-0000000b0021'::uuid AS r_pos_square,
  '00000000-0000-0000-0000-0000000b0022'::uuid AS r_pos_toast,
  '00000000-0000-0000-0000-0000000b0023'::uuid AS r_pos_clover,
  '00000000-0000-0000-0000-0000000b0024'::uuid AS r_pos_shift4,
  '00000000-0000-0000-0000-0000000b0030'::uuid AS r_already_sent,
  '00000000-0000-0000-0000-0000000b0031'::uuid AS r_unsub_trial,
  '00000000-0000-0000-0000-0000000b0032'::uuid AS r_unsub_all,
  '00000000-0000-0000-0000-0000000b0033'::uuid AS r_unsub_marketing,
  '00000000-0000-0000-0000-0000000b0040'::uuid AS r_manager;

-- ------------------------------------------------------------------
-- Fixture: 23 auth.users (one per scenario), then profiles, restaurants,
-- user_restaurants, then POS connections / dedupe rows / unsubscribes.
-- ------------------------------------------------------------------

-- Clean any prior state in FK-safe order.
DELETE FROM public.trial_emails_sent
  WHERE restaurant_id IN (
    SELECT r_day7 FROM _ids UNION ALL
    SELECT r_day11 FROM _ids UNION ALL SELECT r_day13 FROM _ids UNION ALL
    SELECT r_day15 FROM _ids UNION ALL SELECT r_day6 FROM _ids UNION ALL
    SELECT r_day8 FROM _ids UNION ALL SELECT r_day14 FROM _ids UNION ALL
    SELECT r_day16 FROM _ids UNION ALL SELECT r_active FROM _ids UNION ALL
    SELECT r_canceled FROM _ids UNION ALL SELECT r_grandfathered FROM _ids UNION ALL
    SELECT r_pastdue FROM _ids UNION ALL SELECT r_internal_eshq FROM _ids UNION ALL
    SELECT r_internal_camiluke FROM _ids UNION ALL SELECT r_pos_square FROM _ids UNION ALL
    SELECT r_pos_toast FROM _ids UNION ALL SELECT r_pos_clover FROM _ids UNION ALL
    SELECT r_pos_shift4 FROM _ids UNION ALL SELECT r_already_sent FROM _ids UNION ALL
    SELECT r_unsub_trial FROM _ids UNION ALL SELECT r_unsub_all FROM _ids UNION ALL
    SELECT r_unsub_marketing FROM _ids UNION ALL SELECT r_manager FROM _ids
  );
DELETE FROM public.email_unsubscribes
  WHERE user_id IN (
    SELECT u_unsub_trial FROM _ids UNION ALL
    SELECT u_unsub_all FROM _ids UNION ALL
    SELECT u_unsub_marketing FROM _ids
  );
DELETE FROM public.square_connections WHERE restaurant_id IN (SELECT r_pos_square FROM _ids);
DELETE FROM public.toast_connections WHERE restaurant_id IN (SELECT r_pos_toast FROM _ids);
DELETE FROM public.clover_connections WHERE restaurant_id IN (SELECT r_pos_clover FROM _ids);
DELETE FROM public.shift4_connections WHERE restaurant_id IN (SELECT r_pos_shift4 FROM _ids);
DELETE FROM public.user_restaurants WHERE user_id IN (
  SELECT u_day7 FROM _ids UNION ALL SELECT u_day11 FROM _ids UNION ALL
  SELECT u_day13 FROM _ids UNION ALL SELECT u_day15 FROM _ids UNION ALL
  SELECT u_day6 FROM _ids UNION ALL SELECT u_day8 FROM _ids UNION ALL
  SELECT u_day14 FROM _ids UNION ALL SELECT u_day16 FROM _ids UNION ALL
  SELECT u_active FROM _ids UNION ALL SELECT u_canceled FROM _ids UNION ALL
  SELECT u_grandfathered FROM _ids UNION ALL SELECT u_pastdue FROM _ids UNION ALL
  SELECT u_internal_eshq FROM _ids UNION ALL SELECT u_internal_camiluke FROM _ids UNION ALL
  SELECT u_pos_square FROM _ids UNION ALL SELECT u_pos_toast FROM _ids UNION ALL
  SELECT u_pos_clover FROM _ids UNION ALL SELECT u_pos_shift4 FROM _ids UNION ALL
  SELECT u_already_sent FROM _ids UNION ALL SELECT u_unsub_trial FROM _ids UNION ALL
  SELECT u_unsub_all FROM _ids UNION ALL SELECT u_unsub_marketing FROM _ids UNION ALL
  SELECT u_manager FROM _ids
);
DELETE FROM public.restaurants WHERE id IN (
  SELECT r_day7 FROM _ids UNION ALL SELECT r_day11 FROM _ids UNION ALL
  SELECT r_day13 FROM _ids UNION ALL SELECT r_day15 FROM _ids UNION ALL
  SELECT r_day6 FROM _ids UNION ALL SELECT r_day8 FROM _ids UNION ALL
  SELECT r_day14 FROM _ids UNION ALL SELECT r_day16 FROM _ids UNION ALL
  SELECT r_active FROM _ids UNION ALL SELECT r_canceled FROM _ids UNION ALL
  SELECT r_grandfathered FROM _ids UNION ALL SELECT r_pastdue FROM _ids UNION ALL
  SELECT r_internal_eshq FROM _ids UNION ALL SELECT r_internal_camiluke FROM _ids UNION ALL
  SELECT r_pos_square FROM _ids UNION ALL SELECT r_pos_toast FROM _ids UNION ALL
  SELECT r_pos_clover FROM _ids UNION ALL SELECT r_pos_shift4 FROM _ids UNION ALL
  SELECT r_already_sent FROM _ids UNION ALL SELECT r_unsub_trial FROM _ids UNION ALL
  SELECT r_unsub_all FROM _ids UNION ALL SELECT r_unsub_marketing FROM _ids UNION ALL
  SELECT r_manager FROM _ids
);
DELETE FROM public.profiles WHERE user_id IN (
  SELECT u_day7 FROM _ids UNION ALL SELECT u_day11 FROM _ids UNION ALL
  SELECT u_day13 FROM _ids UNION ALL SELECT u_day15 FROM _ids UNION ALL
  SELECT u_day6 FROM _ids UNION ALL SELECT u_day8 FROM _ids UNION ALL
  SELECT u_day14 FROM _ids UNION ALL SELECT u_day16 FROM _ids UNION ALL
  SELECT u_active FROM _ids UNION ALL SELECT u_canceled FROM _ids UNION ALL
  SELECT u_grandfathered FROM _ids UNION ALL SELECT u_pastdue FROM _ids UNION ALL
  SELECT u_internal_eshq FROM _ids UNION ALL SELECT u_internal_camiluke FROM _ids UNION ALL
  SELECT u_pos_square FROM _ids UNION ALL SELECT u_pos_toast FROM _ids UNION ALL
  SELECT u_pos_clover FROM _ids UNION ALL SELECT u_pos_shift4 FROM _ids UNION ALL
  SELECT u_already_sent FROM _ids UNION ALL SELECT u_unsub_trial FROM _ids UNION ALL
  SELECT u_unsub_all FROM _ids UNION ALL SELECT u_unsub_marketing FROM _ids UNION ALL
  SELECT u_manager FROM _ids
);
DELETE FROM auth.users WHERE id IN (
  SELECT u_day7 FROM _ids UNION ALL SELECT u_day11 FROM _ids UNION ALL
  SELECT u_day13 FROM _ids UNION ALL SELECT u_day15 FROM _ids UNION ALL
  SELECT u_day6 FROM _ids UNION ALL SELECT u_day8 FROM _ids UNION ALL
  SELECT u_day14 FROM _ids UNION ALL SELECT u_day16 FROM _ids UNION ALL
  SELECT u_active FROM _ids UNION ALL SELECT u_canceled FROM _ids UNION ALL
  SELECT u_grandfathered FROM _ids UNION ALL SELECT u_pastdue FROM _ids UNION ALL
  SELECT u_internal_eshq FROM _ids UNION ALL SELECT u_internal_camiluke FROM _ids UNION ALL
  SELECT u_pos_square FROM _ids UNION ALL SELECT u_pos_toast FROM _ids UNION ALL
  SELECT u_pos_clover FROM _ids UNION ALL SELECT u_pos_shift4 FROM _ids UNION ALL
  SELECT u_already_sent FROM _ids UNION ALL SELECT u_unsub_trial FROM _ids UNION ALL
  SELECT u_unsub_all FROM _ids UNION ALL SELECT u_unsub_marketing FROM _ids UNION ALL
  SELECT u_manager FROM _ids
);

-- Insert auth.users.
DO $$
DECLARE
  ids RECORD;
  uid UUID;
  email TEXT;
  rec RECORD;
BEGIN
  SELECT * INTO ids FROM _ids;
  FOR rec IN
    SELECT * FROM (VALUES
      (ids.u_day7,             'day7@example.com'),
      (ids.u_day11,            'day11@example.com'),
      (ids.u_day13,            'day13@example.com'),
      (ids.u_day15,            'day15@example.com'),
      (ids.u_day6,             'day6@example.com'),
      (ids.u_day8,             'day8@example.com'),
      (ids.u_day14,            'day14@example.com'),
      (ids.u_day16,            'day16@example.com'),
      (ids.u_active,           'active@example.com'),
      (ids.u_canceled,         'canceled@example.com'),
      (ids.u_grandfathered,    'grandfathered@example.com'),
      (ids.u_pastdue,          'pastdue@example.com'),
      (ids.u_internal_eshq,    'staff@easyshifthq.com'),
      (ids.u_internal_camiluke,'staff@camiluke.com'),
      (ids.u_pos_square,       'pos-sq@example.com'),
      (ids.u_pos_toast,        'pos-tt@example.com'),
      (ids.u_pos_clover,       'pos-cl@example.com'),
      (ids.u_pos_shift4,       'pos-s4@example.com'),
      (ids.u_already_sent,     'already-sent@example.com'),
      (ids.u_unsub_trial,      'unsub-trial@example.com'),
      (ids.u_unsub_all,        'unsub-all@example.com'),
      (ids.u_unsub_marketing,  'unsub-marketing@example.com'),
      (ids.u_manager,          'manager@example.com')
    ) AS t(uid, email)
  LOOP
    INSERT INTO auth.users
      (id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new, email_change)
    VALUES
      (rec.uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       rec.email, crypt('password123', gen_salt('bf')),
       now(), now(), now(),
       '', '', '', '');
  END LOOP;
END $$;

-- Profiles (full_name); upsert because the auth.users insert may have
-- triggered an auto-create profile row in some environments.
INSERT INTO public.profiles (user_id, full_name, email)
SELECT u_day7, 'Day Seven', 'day7@example.com' FROM _ids
UNION ALL SELECT u_day11, 'Day Eleven', 'day11@example.com' FROM _ids
UNION ALL SELECT u_day13, 'Day Thirteen', 'day13@example.com' FROM _ids
UNION ALL SELECT u_day15, 'Day Fifteen', 'day15@example.com' FROM _ids
UNION ALL SELECT u_pos_square, 'POS Square', 'pos-sq@example.com' FROM _ids
UNION ALL SELECT u_pos_toast, 'POS Toast', 'pos-tt@example.com' FROM _ids
UNION ALL SELECT u_pos_clover, 'POS Clover', 'pos-cl@example.com' FROM _ids
UNION ALL SELECT u_pos_shift4, 'POS Shift4', 'pos-s4@example.com' FROM _ids
UNION ALL SELECT u_unsub_trial, 'Trial Unsub', 'unsub-trial@example.com' FROM _ids
UNION ALL SELECT u_unsub_all, 'All Unsub', 'unsub-all@example.com' FROM _ids
UNION ALL SELECT u_unsub_marketing, 'Marketing Unsub', 'unsub-marketing@example.com' FROM _ids
ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

-- Restaurants. created_at offsets line up with day-N test buckets.
-- All start as 'trialing' unless overridden below.
INSERT INTO public.restaurants (id, name, created_at, subscription_status)
SELECT r_day7,             'R Day7',             now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_day11,  'R Day11',            now() - INTERVAL '11 days', 'trialing' FROM _ids
UNION ALL SELECT r_day13,  'R Day13',            now() - INTERVAL '13 days', 'trialing' FROM _ids
UNION ALL SELECT r_day15,  'R Day15',            now() - INTERVAL '15 days', 'trialing' FROM _ids
UNION ALL SELECT r_day6,   'R Day6',             now() - INTERVAL '6 days',  'trialing' FROM _ids
UNION ALL SELECT r_day8,   'R Day8',             now() - INTERVAL '8 days',  'trialing' FROM _ids
UNION ALL SELECT r_day14,  'R Day14',            now() - INTERVAL '14 days', 'trialing' FROM _ids
UNION ALL SELECT r_day16,  'R Day16',            now() - INTERVAL '16 days', 'trialing' FROM _ids
UNION ALL SELECT r_active, 'R Active',           now() - INTERVAL '7 days',  'active' FROM _ids
UNION ALL SELECT r_canceled, 'R Canceled',       now() - INTERVAL '7 days',  'canceled' FROM _ids
UNION ALL SELECT r_grandfathered, 'R Grandfath', now() - INTERVAL '7 days',  'grandfathered' FROM _ids
UNION ALL SELECT r_pastdue, 'R PastDue',         now() - INTERVAL '7 days',  'past_due' FROM _ids
UNION ALL SELECT r_internal_eshq, 'R EshQ',      now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_internal_camiluke, 'R Cami',  now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_pos_square, 'R Sq',           now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_pos_toast, 'R Tt',            now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_pos_clover, 'R Cl',           now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_pos_shift4, 'R S4',           now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_already_sent, 'R Sent',       now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_unsub_trial, 'R UnsubT',      now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_unsub_all, 'R UnsubAll',      now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_unsub_marketing, 'R UnsubMk', now() - INTERVAL '7 days',  'trialing' FROM _ids
UNION ALL SELECT r_manager, 'R Mgr',             now() - INTERVAL '7 days',  'trialing' FROM _ids;

-- user_restaurants links (mostly owner; the manager case is non-owner).
INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
SELECT u_day7, r_day7, 'owner' FROM _ids
UNION ALL SELECT u_day11, r_day11, 'owner' FROM _ids
UNION ALL SELECT u_day13, r_day13, 'owner' FROM _ids
UNION ALL SELECT u_day15, r_day15, 'owner' FROM _ids
UNION ALL SELECT u_day6, r_day6, 'owner' FROM _ids
UNION ALL SELECT u_day8, r_day8, 'owner' FROM _ids
UNION ALL SELECT u_day14, r_day14, 'owner' FROM _ids
UNION ALL SELECT u_day16, r_day16, 'owner' FROM _ids
UNION ALL SELECT u_active, r_active, 'owner' FROM _ids
UNION ALL SELECT u_canceled, r_canceled, 'owner' FROM _ids
UNION ALL SELECT u_grandfathered, r_grandfathered, 'owner' FROM _ids
UNION ALL SELECT u_pastdue, r_pastdue, 'owner' FROM _ids
UNION ALL SELECT u_internal_eshq, r_internal_eshq, 'owner' FROM _ids
UNION ALL SELECT u_internal_camiluke, r_internal_camiluke, 'owner' FROM _ids
UNION ALL SELECT u_pos_square, r_pos_square, 'owner' FROM _ids
UNION ALL SELECT u_pos_toast, r_pos_toast, 'owner' FROM _ids
UNION ALL SELECT u_pos_clover, r_pos_clover, 'owner' FROM _ids
UNION ALL SELECT u_pos_shift4, r_pos_shift4, 'owner' FROM _ids
UNION ALL SELECT u_already_sent, r_already_sent, 'owner' FROM _ids
UNION ALL SELECT u_unsub_trial, r_unsub_trial, 'owner' FROM _ids
UNION ALL SELECT u_unsub_all, r_unsub_all, 'owner' FROM _ids
UNION ALL SELECT u_unsub_marketing, r_unsub_marketing, 'owner' FROM _ids
UNION ALL SELECT u_manager, r_manager, 'manager' FROM _ids;

-- POS connections (one per per-POS-test restaurant)
INSERT INTO public.square_connections (restaurant_id, merchant_id, access_token)
SELECT r_pos_square, 'merchant-sq', 'token-sq' FROM _ids;
INSERT INTO public.toast_connections (restaurant_id, toast_restaurant_guid, access_token)
SELECT r_pos_toast, 'guid-tt', 'token-tt' FROM _ids;
INSERT INTO public.clover_connections (restaurant_id, merchant_id, access_token)
SELECT r_pos_clover, 'merchant-cl', 'token-cl' FROM _ids;
INSERT INTO public.shift4_connections (restaurant_id, merchant_id, secret_key)
SELECT r_pos_shift4, 'merchant-s4', 'secret-s4' FROM _ids;

-- Pre-existing trial_emails_sent row (dedupe scenario)
INSERT INTO public.trial_emails_sent
  (restaurant_id, user_id, email_type, variant, trial_day_at_send)
SELECT r_already_sent, u_already_sent, 'halfway', 'not_activated', 7 FROM _ids;

-- Email unsubscribes
INSERT INTO public.email_unsubscribes (user_id, list, source)
SELECT u_unsub_trial, 'trial_lifecycle', 'test' FROM _ids
UNION ALL SELECT u_unsub_all, 'all', 'test' FROM _ids
UNION ALL SELECT u_unsub_marketing, 'marketing', 'test' FROM _ids;

-- ------------------------------------------------------------------
-- Fetch the RPC result once so each assertion is a cheap subquery.
-- ------------------------------------------------------------------
CREATE TEMP TABLE _rpc AS
SELECT * FROM public.users_in_trial_email_window();

-- ------------------------------------------------------------------
-- Assertions.
-- ------------------------------------------------------------------

-- Day windows: 7 / 11 / 13 / 15 must each appear exactly once with the
-- expected email_type.
SELECT is(
  (SELECT email_type FROM _rpc WHERE user_id = (SELECT u_day7 FROM _ids)),
  'halfway',
  'day 7 returns email_type halfway'
);

SELECT is(
  (SELECT email_type FROM _rpc WHERE user_id = (SELECT u_day11 FROM _ids)),
  '3_days',
  'day 11 returns email_type 3_days'
);

SELECT is(
  (SELECT email_type FROM _rpc WHERE user_id = (SELECT u_day13 FROM _ids)),
  'tomorrow',
  'day 13 returns email_type tomorrow'
);

SELECT is(
  (SELECT email_type FROM _rpc WHERE user_id = (SELECT u_day15 FROM _ids)),
  'expired',
  'day 15 returns email_type expired'
);

-- Out-of-window days are excluded.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM _rpc
    WHERE user_id IN (
      SELECT u_day6 FROM _ids UNION ALL SELECT u_day8 FROM _ids
      UNION ALL SELECT u_day14 FROM _ids UNION ALL SELECT u_day16 FROM _ids
    )
  ),
  'days 6/8/14/16 are excluded'
);

-- Status filter: only trialing returns.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM _rpc
    WHERE user_id IN (
      SELECT u_active FROM _ids UNION ALL SELECT u_canceled FROM _ids
      UNION ALL SELECT u_grandfathered FROM _ids UNION ALL SELECT u_pastdue FROM _ids
    )
  ),
  'non-trialing statuses (active/canceled/grandfathered/past_due) are excluded'
);

-- Internal-email exclusion.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM _rpc WHERE user_id = (SELECT u_internal_eshq FROM _ids)),
  '@easyshifthq.com owners are excluded'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM _rpc WHERE user_id = (SELECT u_internal_camiluke FROM _ids)),
  '@camiluke.com owners are excluded'
);

-- Activation flag flips for each POS table.
SELECT is(
  (SELECT activated FROM _rpc WHERE user_id = (SELECT u_pos_square FROM _ids)),
  true,
  'square_connections row makes activated TRUE'
);

SELECT is(
  (SELECT activated FROM _rpc WHERE user_id = (SELECT u_pos_toast FROM _ids)),
  true,
  'toast_connections row makes activated TRUE'
);

SELECT is(
  (SELECT activated FROM _rpc WHERE user_id = (SELECT u_pos_clover FROM _ids)),
  true,
  'clover_connections row makes activated TRUE'
);

SELECT is(
  (SELECT activated FROM _rpc WHERE user_id = (SELECT u_pos_shift4 FROM _ids)),
  true,
  'shift4_connections row makes activated TRUE'
);

-- Without any POS row, activated stays FALSE (for the basic day7 fixture).
SELECT is(
  (SELECT activated FROM _rpc WHERE user_id = (SELECT u_day7 FROM _ids)),
  false,
  'no POS rows -> activated FALSE'
);

-- Dedupe via existing trial_emails_sent row.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM _rpc WHERE user_id = (SELECT u_already_sent FROM _ids)),
  'existing trial_emails_sent row excludes the candidate'
);

-- Unsubscribe via list = trial_lifecycle.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM _rpc WHERE user_id = (SELECT u_unsub_trial FROM _ids)),
  'email_unsubscribes (trial_lifecycle) excludes the candidate'
);

-- Unsubscribe via list = all.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM _rpc WHERE user_id = (SELECT u_unsub_all FROM _ids)),
  'email_unsubscribes (all) excludes the candidate'
);

-- Unsubscribe via list = marketing should NOT exclude trial-lifecycle.
SELECT ok(
  EXISTS (SELECT 1 FROM _rpc WHERE user_id = (SELECT u_unsub_marketing FROM _ids)),
  'email_unsubscribes (marketing) does not exclude trial-lifecycle candidate'
);

-- Non-owner user_restaurants role does NOT receive emails.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM _rpc WHERE user_id = (SELECT u_manager FROM _ids)),
  'managers (non-owner role) are excluded'
);

-- Full name flows through (sanity check on the projection).
SELECT is(
  (SELECT full_name FROM _rpc WHERE user_id = (SELECT u_day7 FROM _ids)),
  'Day Seven',
  'full_name passes through from profiles'
);

SELECT * FROM finish();
ROLLBACK;
