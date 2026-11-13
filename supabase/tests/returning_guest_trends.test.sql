-- Test: get_returning_guest_trends (returning guests RPC)
-- Design: docs/superpowers/specs/2026-11-12-returning-guests-design.md section 5.
-- This file is RED until the RPC migration exists.
--
-- Dates: rg_d(n) = restaurant "today" (America/Chicago) plus n days.
-- Campaign start C of restaurant T = rg_d(-28). Card A is VISA 411111 ending 7391.

BEGIN;
SELECT plan(65);

SET LOCAL role TO postgres;

-- Helper: today in the default restaurant zone, plus n days (rolled back at the end)
CREATE FUNCTION public.rg_d(n INT) RETURNS DATE
LANGUAGE sql STABLE AS $$ SELECT ((now() AT TIME ZONE 'America/Chicago')::date + n) $$;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Users: owner, manager, staff, chef, outsider
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''
FROM (VALUES
  ('b0000000-0000-0000-0000-000000000001', 'rg_owner@test.com'),
  ('b0000000-0000-0000-0000-000000000002', 'rg_manager@test.com'),
  ('b0000000-0000-0000-0000-000000000003', 'rg_staff@test.com'),
  ('b0000000-0000-0000-0000-000000000004', 'rg_chef@test.com'),
  ('b0000000-0000-0000-0000-000000000005', 'rg_outsider@test.com')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

-- Restaurants: T toast, T2 toast low first6, V revel, F focus, M mixed, S square, N none, B bad zone
INSERT INTO restaurants (id, name, timezone) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'RG Toast',      'America/Chicago'),
  ('c0000000-0000-0000-0000-000000000002', 'RG Toast Low6', 'America/Chicago'),
  ('c0000000-0000-0000-0000-000000000003', 'RG Revel',      'America/Chicago'),
  ('c0000000-0000-0000-0000-000000000004', 'RG Focus',      'America/Chicago'),
  ('c0000000-0000-0000-0000-000000000005', 'RG Mixed',      'America/Chicago'),
  ('c0000000-0000-0000-0000-000000000006', 'RG Square',     'America/Chicago'),
  ('c0000000-0000-0000-0000-000000000007', 'RG None',       'America/Chicago'),
  ('c0000000-0000-0000-0000-000000000008', 'RG BadZone',    'Not/AZone');

-- Owner has all restaurants. Manager, staff and chef belong to T only.
INSERT INTO user_restaurants (user_id, restaurant_id, role)
SELECT 'b0000000-0000-0000-0000-000000000001', id, 'owner' FROM restaurants WHERE name LIKE 'RG %';
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'manager'),
  ('b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'staff'),
  ('b0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 'chef');

-- ---------------------------------------------------------------------------
-- Toast restaurant T (campaign start C = rg_d(-28)). Card offsets are from C.
--   A  VISA 411111 7391 : C-10 $20, C-3 $15, C+1 $30 (tip 5) and $10, C+8 $25
--   B  MC   555555 1111 : C+2 $40, C+9 $50
--   E  DISC 601100 2222 : C-20 -$50 (must not set first_seen), C+5 $60
--   Rows that must not count: VOIDED, DENIED, NEW_STATUS, empty last 4, cash
-- ---------------------------------------------------------------------------
INSERT INTO toast_payments (restaurant_id, toast_payment_guid, toast_order_guid, payment_type, amount, tip_amount, payment_date, payment_status, raw_json) VALUES
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 20,  0, public.rg_d(-38), 'CAPTURED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"7391"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 15,  0, public.rg_d(-31), 'CAPTURED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"7391"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 30,  5, public.rg_d(-27), 'CAPTURED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"7391"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 10,  0, public.rg_d(-27), 'AUTHORIZED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"7391"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 25,  0, public.rg_d(-20), 'CAPTURED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"7391"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 40,  0, public.rg_d(-26), 'CAPTURED',
     '{"cardType":"MC","first6Digits":"555555","last4Digits":"1111"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 50,  0, public.rg_d(-19), 'CAPTURED',
     '{"cardType":"MC","first6Digits":"555555","last4Digits":"1111"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', -50, 0, public.rg_d(-48), 'CAPTURED',
     '{"cardType":"DISC","first6Digits":"601100","last4Digits":"2222"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 60,  0, public.rg_d(-23), 'CAPTURED',
     '{"cardType":"DISC","first6Digits":"601100","last4Digits":"2222"}'),
  -- must not count
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 999, 0, public.rg_d(-25), 'VOIDED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"7391"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 999, 0, public.rg_d(-25), 'DENIED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"7391"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 999, 0, public.rg_d(-24), 'NEW_STATUS',
     '{"cardType":"AMEX","first6Digits":"370000","last4Digits":"0005"}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 777, 0, public.rg_d(-24), 'CAPTURED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":""}'),
  ('c0000000-0000-0000-0000-000000000001', gen_random_uuid()::text, gen_random_uuid()::text, 'CASH',   99, 0, public.rg_d(-26), 'CAPTURED', '{}');

-- Toast restaurant T2: one card, first 6 on 1 of 2 rows (under 95 %). One key expected.
INSERT INTO toast_payments (restaurant_id, toast_payment_guid, toast_order_guid, payment_type, amount, tip_amount, payment_date, payment_status, raw_json) VALUES
  ('c0000000-0000-0000-0000-000000000002', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 10, 0, public.rg_d(-37), 'CAPTURED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"9999"}'),
  ('c0000000-0000-0000-0000-000000000002', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 20, 0, public.rg_d(-27), 'CAPTURED',
     '{"cardType":"VISA","last4Digits":"9999"}');

-- Revel restaurant V (C = rg_d(-14)): X first at C-5, returns C+1. Y NULL status at C-6, then C+2.
INSERT INTO revel_payments (restaurant_id, revel_payment_id, revel_order_id, payment_type, amount, tip_amount, payment_date, payment_status, raw_json) VALUES
  ('c0000000-0000-0000-0000-000000000003', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 20,  0, public.rg_d(-19), 'Captured',
     '{"card_type":"VISA","last_4_cc_digits":"1234"}'),
  ('c0000000-0000-0000-0000-000000000003', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 50,  0, public.rg_d(-13), 'Accepted',
     '{"card_type":"VISA","last_4_cc_digits":"1234"}'),
  ('c0000000-0000-0000-0000-000000000003', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 500, 0, public.rg_d(-20), NULL,
     '{"card_type":"MC","last_4_cc_digits":"5678"}'),
  ('c0000000-0000-0000-0000-000000000003', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 30,  0, public.rg_d(-12), 'Captured',
     '{"card_type":"MC","last_4_cc_digits":"5678"}');

-- Focus restaurant F (C = rg_d(-14)): last 4 only
INSERT INTO focus_orders (restaurant_id, business_date, focus_check_id) VALUES
  ('c0000000-0000-0000-0000-000000000004', public.rg_d(-19), 'chk1'),
  ('c0000000-0000-0000-0000-000000000004', public.rg_d(-13), 'chk2');
INSERT INTO focus_payments (restaurant_id, business_date, focus_check_id, payment_key, amount, card_last4) VALUES
  ('c0000000-0000-0000-0000-000000000004', public.rg_d(-19), 'chk1', 'p1', 10, '4242'),
  ('c0000000-0000-0000-0000-000000000004', public.rg_d(-13), 'chk2', 'p1', 15, '4242');

-- Mixed restaurant M: Toast and Focus card rows
INSERT INTO toast_payments (restaurant_id, toast_payment_guid, toast_order_guid, payment_type, amount, tip_amount, payment_date, payment_status, raw_json) VALUES
  ('c0000000-0000-0000-0000-000000000005', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 10, 0, public.rg_d(-19), 'CAPTURED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"3333"}');
INSERT INTO focus_orders (restaurant_id, business_date, focus_check_id) VALUES
  ('c0000000-0000-0000-0000-000000000005', public.rg_d(-13), 'chk1');
INSERT INTO focus_payments (restaurant_id, business_date, focus_check_id, payment_key, amount, card_last4) VALUES
  ('c0000000-0000-0000-0000-000000000005', public.rg_d(-13), 'chk1', 'p1', 15, '4242');

-- Square restaurant S (C = rg_d(-14)).
--   fp_1: C-3 $12, then C+6 at 23:30 local time ($25). UTC date is C+7.
--   Cash and FAILED rows must not count.
INSERT INTO square_payments (restaurant_id, payment_id, location_id, status, amount_money, created_at, raw_json) VALUES
  ('c0000000-0000-0000-0000-000000000006', gen_random_uuid()::text, 'loc1', 'COMPLETED', 12,
     ((public.rg_d(-17) + time '12:00') AT TIME ZONE 'America/Chicago'),
     '{"card_details":{"card":{"fingerprint":"fp_1"}}}'),
  ('c0000000-0000-0000-0000-000000000006', gen_random_uuid()::text, 'loc1', 'COMPLETED', 25,
     ((public.rg_d(-8) + time '23:30') AT TIME ZONE 'America/Chicago'),
     '{"card_details":{"card":{"fingerprint":"fp_1"}}}'),
  ('c0000000-0000-0000-0000-000000000006', gen_random_uuid()::text, 'loc1', 'COMPLETED', 99,
     ((public.rg_d(-12) + time '12:00') AT TIME ZONE 'America/Chicago'),
     '{"source_type":"CASH"}'),
  ('c0000000-0000-0000-0000-000000000006', gen_random_uuid()::text, 'loc1', 'FAILED', 50,
     ((public.rg_d(-11) + time '12:00') AT TIME ZONE 'America/Chicago'),
     '{"card_details":{"card":{"fingerprint":"fp_2"}}}');

-- Bad zone restaurant B: one Toast card row
INSERT INTO toast_payments (restaurant_id, toast_payment_guid, toast_order_guid, payment_type, amount, tip_amount, payment_date, payment_status, raw_json) VALUES
  ('c0000000-0000-0000-0000-000000000008', gen_random_uuid()::text, gen_random_uuid()::text, 'CREDIT', 10, 0, public.rg_d(-19), 'CAPTURED',
     '{"cardType":"VISA","first6Digits":"411111","last4Digits":"4444"}');

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;

-- Result tables, filled by the owner. Readable by every role.
CREATE TEMP TABLE res (k TEXT PRIMARY KEY, j JSONB);
CREATE TEMP TABLE wk (k TEXT, week_start DATE, period TEXT, warmup BOOLEAN,
                      rs NUMERIC, ns NUMERIC, rv INT, rc INT, nc INT);
CREATE TEMP TABLE sm (k TEXT, period TEXT, spw NUMERIC, vpc NUMERIC, ac NUMERIC, rc INT, nc INT);
GRANT ALL ON res, wk, sm TO PUBLIC;

-- ============================================================
-- Group 1: access. Non-member, NULL uid, staff, chef denied.
-- ============================================================
SET LOCAL role TO authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000005"}', true);
SELECT throws_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 8) $$,
  '42501', NULL, 'non-member is denied');

SELECT set_config('request.jwt.claims', '{}', true);
SELECT throws_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 8) $$,
  '42501', NULL, 'NULL auth.uid() is denied');

SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000003"}', true);
SELECT throws_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 8) $$,
  '42501', NULL, 'staff member is denied');

SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000004"}', true);
SELECT throws_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 8) $$,
  '42501', NULL, 'chef member is denied');

SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002"}', true);
SELECT lives_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 8) $$,
  'manager is allowed');

-- Owner from here on
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001"}', true);
SELECT lives_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 8) $$,
  'owner is allowed');

-- ============================================================
-- Group 3: argument guards (22023)
-- ============================================================
SELECT throws_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 0) $$,
  '22023', NULL, 'p_weeks = 0 is rejected');
SELECT throws_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 27) $$,
  '22023', NULL, 'p_weeks = 27 is rejected');
SELECT throws_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), NULL) $$,
  '22023', NULL, 'NULL p_weeks is rejected');
SELECT throws_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', NULL, 8) $$,
  '22023', NULL, 'NULL campaign start is rejected');
SELECT throws_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(1), 8) $$,
  '22023', NULL, 'future campaign start is rejected');

-- ============================================================
-- Group 4: grants
-- ============================================================
SELECT is(
  has_function_privilege('anon', 'public.get_returning_guest_trends(uuid,date,integer)', 'EXECUTE'),
  false, 'anon cannot execute the RPC');
SELECT is(
  has_function_privilege('authenticated', 'public.get_returning_guest_trends(uuid,date,integer)', 'EXECUTE'),
  true, 'authenticated can execute the RPC');

-- ============================================================
-- Fill the result tables (owner)
-- ============================================================
INSERT INTO res VALUES
  ('T',      public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 8)),
  ('T_today',public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(0), 8)),
  ('T_yest', public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-1), 8)),
  ('T_20',   public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-20), 8)),
  ('T_cap',  public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000001', public.rg_d(-28), 2)),
  ('T2',     public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000002', public.rg_d(-28), 8)),
  ('V',      public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000003', public.rg_d(-14), 8)),
  ('F',      public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000004', public.rg_d(-14), 8)),
  ('M',      public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000005', public.rg_d(-14), 8)),
  ('S',      public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000006', public.rg_d(-14), 8)),
  ('N',      public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000007', public.rg_d(-14), 8));

INSERT INTO wk
SELECT r.k, (w->>'week_start')::date, w->>'period', (w->>'warmup')::boolean,
       (w->>'returning_spend')::numeric, (w->>'new_spend')::numeric,
       (w->>'returning_visits')::int, (w->>'returning_cards')::int, (w->>'new_cards')::int
FROM res r, jsonb_array_elements(r.j->'weeks') w;

INSERT INTO sm
SELECT r.k, p.period, (r.j->'summary'->p.period->>'spend_per_week')::numeric,
       (r.j->'summary'->p.period->>'visits_per_card')::numeric,
       (r.j->'summary'->p.period->>'avg_check')::numeric,
       (r.j->'summary'->p.period->>'returning_cards')::int,
       (r.j->'summary'->p.period->>'new_cards')::int
FROM res r, (VALUES ('before'), ('after')) AS p(period)
WHERE r.j->'summary' IS NOT NULL AND r.j->>'source' <> 'none';

-- ============================================================
-- Group 5: returning versus new (restaurant T)
-- ============================================================
SELECT is((SELECT j->>'source' FROM res WHERE k = 'T'), 'toast', 'T: source is toast');
SELECT is((SELECT rs FROM wk WHERE k = 'T' AND week_start = public.rg_d(-28)), 40::numeric,
  'T week 0: returning spend counts card A (seen before week 0), without tip');
SELECT is((SELECT ns FROM wk WHERE k = 'T' AND week_start = public.rg_d(-28)), 100::numeric,
  'T week 0: new spend counts cards B and E');
SELECT is((SELECT rs FROM wk WHERE k = 'T' AND week_start = public.rg_d(-21)), 75::numeric,
  'T week 1: card B is now returning');
SELECT is((SELECT ns FROM wk WHERE k = 'T' AND week_start = public.rg_d(-21)), 0::numeric,
  'T week 1: new spend is 0');

-- ============================================================
-- Group 6: status allow-list
-- ============================================================
SELECT is((SELECT rv FROM wk WHERE k = 'T' AND week_start = public.rg_d(-28)), 1,
  'T week 0: VOIDED and DENIED rows add no visit');
SELECT is((SELECT nc FROM wk WHERE k = 'T' AND week_start = public.rg_d(-28)), 2,
  'T week 0: NEW_STATUS row adds no new card');

-- ============================================================
-- Group 7: Revel NULL status does not count
-- ============================================================
SELECT is((SELECT rs FROM wk WHERE k = 'V' AND week_start = public.rg_d(-14)), 50::numeric,
  'V week 0: Revel returning spend');
SELECT is((SELECT ns FROM wk WHERE k = 'V' AND week_start = public.rg_d(-14)), 30::numeric,
  'V week 0: NULL-status row did not set first_seen, so card Y is new');
SELECT is((SELECT j->>'history_start' FROM res WHERE k = 'V'), public.rg_d(-19)::text,
  'V: NULL-status row does not set history_start');
SELECT is((SELECT j->>'source' FROM res WHERE k = 'V'), 'revel', 'V: source is revel');
SELECT is((SELECT j->>'match_quality' FROM res WHERE k = 'V'), 'fair', 'V: Revel quality is fair');

-- ============================================================
-- Group 8: tip and negative amount
-- ============================================================
SELECT is((SELECT j->>'history_start' FROM res WHERE k = 'T'), public.rg_d(-38)::text,
  'T: negative amount does not set history_start or first_seen');

-- ============================================================
-- Group 9: Toast first 6 rule per restaurant
-- ============================================================
SELECT is((SELECT j->>'match_quality' FROM res WHERE k = 'T'), 'good',
  'T: first 6 on all card rows gives good');
SELECT is((SELECT j->>'match_quality' FROM res WHERE k = 'T2'), 'fair',
  'T2: first 6 under 95 percent gives fair');
SELECT is((SELECT rs FROM wk WHERE k = 'T2' AND week_start = public.rg_d(-28)), 20::numeric,
  'T2: same card with and without first 6 is one key (returning)');

-- ============================================================
-- Group 10: empty-string last 4 does not count
-- ============================================================
SELECT is((SELECT sum(rs + ns) FROM wk WHERE k = 'T' AND period = 'after'), 215::numeric,
  'T: after-period spend ignores empty last 4, cash, VOIDED, DENIED and NEW_STATUS');

-- ============================================================
-- Group 11: Focus and mixed
-- ============================================================
SELECT is((SELECT j->>'source' FROM res WHERE k = 'F'), 'focus', 'F: source is focus');
SELECT is((SELECT j->>'match_quality' FROM res WHERE k = 'F'), 'weak', 'F: Focus quality is weak');
SELECT is((SELECT j->>'source' FROM res WHERE k = 'M'), 'mixed', 'M: Toast plus Focus is mixed');
SELECT is((SELECT j->>'match_quality' FROM res WHERE k = 'M'), 'weak', 'M: mixed reports the weakest quality');

-- ============================================================
-- Group 12: Square
-- ============================================================
SELECT is((SELECT j->>'source' FROM res WHERE k = 'S'), 'square', 'S: source is square');
SELECT is((SELECT j->>'match_quality' FROM res WHERE k = 'S'), 'strong', 'S: fingerprint gives strong');
SELECT is((SELECT rs FROM wk WHERE k = 'S' AND week_start = public.rg_d(-14)), 25::numeric,
  'S week 0: 23:30 local payment counts on the local day');
SELECT is((SELECT rs FROM wk WHERE k = 'S' AND week_start = public.rg_d(-7)), 0::numeric,
  'S week 1: the 23:30 local payment does not move to the UTC day');
SELECT is((SELECT ns FROM wk WHERE k = 'S' AND week_start = public.rg_d(-14)), 0::numeric,
  'S week 0: Square cash and FAILED rows do not count');

-- ============================================================
-- Group 13: invalid time zone falls back, no failure
-- ============================================================
SELECT lives_ok(
  $$ SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000008', public.rg_d(-14), 8) $$,
  'invalid restaurant timezone does not fail');
SELECT is(
  (SELECT public.get_returning_guest_trends('c0000000-0000-0000-0000-000000000008', public.rg_d(-14), 8)->>'source'),
  'toast', 'invalid timezone still returns data');

-- ============================================================
-- Group 14: no card data
-- ============================================================
SELECT is((SELECT j->>'source' FROM res WHERE k = 'N'), 'none', 'N: source is none');
SELECT is((SELECT j->>'match_quality' FROM res WHERE k = 'N'), 'none', 'N: quality is none');
SELECT ok((SELECT j->>'history_start' IS NULL FROM res WHERE k = 'N'), 'N: history_start is null');
SELECT is((SELECT jsonb_array_length(j->'weeks') FROM res WHERE k = 'N'), 0, 'N: weeks array is empty');

-- ============================================================
-- Group 15: weeks compared
-- ============================================================
SELECT is((SELECT (j->>'weeks_compared')::int FROM res WHERE k = 'T'), 4, 'start 28 days ago gives 4 weeks');
SELECT is((SELECT (j->>'weeks_compared')::int FROM res WHERE k = 'T_today'), 0, 'start today gives 0 weeks');
SELECT is((SELECT (j->>'weeks_compared')::int FROM res WHERE k = 'T_yest'), 0, 'start yesterday gives 0 weeks');
SELECT is((SELECT (j->>'weeks_compared')::int FROM res WHERE k = 'T_20'), 2, 'start 20 days ago gives 2 weeks');
SELECT is((SELECT (j->>'weeks_compared')::int FROM res WHERE k = 'T_cap'), 2, 'weeks compared is capped at p_weeks');

-- ============================================================
-- Group 16: summary math (restaurant T)
-- ============================================================
SELECT is((SELECT spw FROM sm WHERE k = 'T' AND period = 'after'), 28.75::numeric,
  'T after: spend per week = 115 / 4 weeks');
SELECT is((SELECT vpc FROM sm WHERE k = 'T' AND period = 'after'), 1.5::numeric,
  'T after: two payments by one card on one day are one visit (3 visits / 2 cards)');
SELECT is((SELECT ac FROM sm WHERE k = 'T' AND period = 'after'), 38.33::numeric,
  'T after: avg check = 115 / 3 visits, rounded once');
SELECT is((SELECT rc FROM sm WHERE k = 'T' AND period = 'after'), 2, 'T after: returning cards');
SELECT is((SELECT nc FROM sm WHERE k = 'T' AND period = 'after'), 2, 'T after: new cards');
SELECT is((SELECT spw FROM sm WHERE k = 'T' AND period = 'before'), 3.75::numeric,
  'T before: spend per week = 15 / 4 weeks');
SELECT is((SELECT vpc FROM sm WHERE k = 'T' AND period = 'before'), 1::numeric,
  'T before: visits per card');
SELECT is((SELECT ac FROM sm WHERE k = 'T' AND period = 'before'), 15::numeric,
  'T before: avg check');
SELECT ok((SELECT vpc IS NULL FROM sm WHERE k = 'V' AND period = 'before'),
  'V before: visits per card is NULL when there are no returning cards');
SELECT ok((SELECT ac IS NULL FROM sm WHERE k = 'V' AND period = 'before'),
  'V before: avg check is NULL when there are no visits');

-- Warm-up flag: week_start < history_start + 28 days. T history_start = C-10.
SELECT is((SELECT warmup FROM wk WHERE k = 'T' AND week_start = public.rg_d(-28)), true,
  'T week 0 is a warm-up week');
SELECT is((SELECT warmup FROM wk WHERE k = 'T' AND week_start = public.rg_d(-7)), false,
  'T week 3 is not a warm-up week');

-- ============================================================
-- Group 17: PCI. No card digit and no digit key in any result.
-- ============================================================
SELECT ok(NOT EXISTS (SELECT 1 FROM res WHERE j::text LIKE '%7391%'),
  'no result contains the last 4 digits 7391');
SELECT ok(NOT EXISTS (SELECT 1 FROM res WHERE j::text LIKE '%411111%'),
  'no result contains the first 6 digits 411111');
SELECT ok(NOT EXISTS (SELECT 1 FROM res WHERE j::text ~* '"[a-z_0-9]*(last4|first6|digits)[a-z_0-9]*"\s*:'),
  'no JSON key name contains last4, first6 or digits');

SELECT * FROM finish();
ROLLBACK;
