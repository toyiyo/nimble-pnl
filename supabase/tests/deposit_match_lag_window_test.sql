BEGIN;
SELECT plan(27);

-- Design ref: docs/superpowers/specs/2026-09-04-deposit-match-lag-window-design.md
-- ("Test plan" section). Named-weekday anchors from the design:
--   2026-08-10 is a Monday, 2026-08-14 is a Friday.
--   Aug 10 Mon, Aug 11 Tue, Aug 12 Wed, Aug 13 Thu, Aug 14 Fri,
--   Aug 15 Sat, Aug 16 Sun, Aug 17 Mon, Aug 18 Tue.

-- ---------------------------------------------------------------------
-- Case 1: deposit_match_business_days_after unit checks. Pure SQL,
-- no fixture needed.
-- ---------------------------------------------------------------------
SELECT is(
  public.deposit_match_business_days_after('2026-08-10'::date, 0),
  '2026-08-10'::date,
  'p_days = 0 returns the input date unchanged'
);

SELECT is(
  public.deposit_match_business_days_after('2026-08-14'::date, 1),
  '2026-08-17'::date,
  'Fri + 1 business day = the following Mon'
);

SELECT is(
  public.deposit_match_business_days_after('2026-08-13'::date, 2),
  '2026-08-17'::date,
  'Thu + 2 business days = the following Mon'
);

SELECT is(
  public.deposit_match_business_days_after('2026-08-15'::date, 1),
  '2026-08-17'::date,
  'Sat + 1 business day = the following Mon'
);

SELECT is(
  public.deposit_match_business_days_after('2026-08-16'::date, 2),
  '2026-08-18'::date,
  'Sun + 2 business days = the following Tue'
);

SELECT is(
  public.deposit_match_business_days_after('2026-08-10'::date, 2),
  '2026-08-12'::date,
  'Mon + 2 business days = the same-week Wed'
);

-- ---------------------------------------------------------------------
-- Fixture: two restaurants, two owners, three connected banks.
--   Restaurant 1 / Bank A "Fresh Bank": data synced far into the future —
--     drives cases 2, 3a, 3b, 4, 5a.
--   Restaurant 1 / Bank B "Partial Sync Bank": synced only partway into
--     the last lag day — drives case 5b.
--   Restaurant 2 / Bank C "Fresh Bank 2": drives case 6.
-- ---------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-6000-0000-0000-000000000001', 'dm-lag-owner-1@test.local'),
  ('aaaaaaaa-6000-0000-0000-000000000002', 'dm-lag-owner-2@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-6000-0000-0000-000000000001', 'Deposit Match Lag Window 1'),
  ('11111111-6000-0000-0000-000000000002', 'Deposit Match Lag Window 2');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('aaaaaaaa-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001',
   'owner', 'b0000000-0000-0000-0000-000000000001'),
  ('aaaaaaaa-6000-0000-0000-000000000002', '11111111-6000-0000-0000-000000000002',
   'owner', 'b0000000-0000-0000-0000-000000000001');

-- Rules, items, and bank transactions are seeded as postgres (bypasses RLS)
-- so the tests below exercise the refresh engine, not the RLS policies.
SET LOCAL role TO postgres;

INSERT INTO public.connected_banks
  (id, restaurant_id, stripe_financial_account_id, institution_name, status, data_current_through)
VALUES
  ('22222222-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001',
   -- A relative future date, not a hardcoded one — the fixed date
   -- 2026-12-31 would drift stale once wall-clock time passed it, flipping
   -- these fresh-bank cases from matched/needs_review to incomplete/late
   -- (found in review, sound-logic).
   'fca_lag_fresh', 'Fresh Bank', 'connected', (CURRENT_DATE + interval '1 year')),
  ('22222222-6000-0000-0000-000000000002', '11111111-6000-0000-0000-000000000001',
   'fca_lag_partial', 'Partial Sync Bank', 'connected',
   -- Covers only 12 hours past the start of the last lag business day for
   -- Case 5b's item (business_date = CURRENT_DATE - 10, lag_max = 2) — the
   -- window has closed, but the feed does not yet cover the full last day.
   (public.deposit_match_business_days_after((CURRENT_DATE - 10), 2))::timestamp
     AT TIME ZONE 'UTC' + interval '12 hours'),
  ('22222222-6000-0000-0000-000000000003', '11111111-6000-0000-0000-000000000002',
   'fca_lag_fresh_2', 'Fresh Bank 2', 'connected', (CURRENT_DATE + interval '1 year'));

-- Rule 2 (case 2, intraday regression / defect 1): lag 1-2, business date
-- Mon 2026-08-10. Window is [Tue Aug11 00:00, Thu Aug13 00:00) UTC. The
-- deposit lands on Wed Aug12 — the lag_max business day — at 12:30 UTC.
-- Under the old DATE-cast BETWEEN bound this deposit fell outside the
-- window; the half-open TIMESTAMPTZ bound now includes it.
-- source_config carries card_tender_names: deposit_match_source_focus
-- requires this key, or the dispatch step raises and the whole rule lands
-- on status_reason = rule_error instead of exercising the lag window.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance, source_config)
VALUES
  ('33333333-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001',
   'focus', 'card', '22222222-6000-0000-0000-000000000001', 'gross', 1, 2, 0.50,
   '{"card_tender_names": ["Visa"]}'::jsonb);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001',
   '33333333-6000-0000-0000-000000000001', '2026-08-10', 100.00, 'pending');

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001',
   '22222222-6000-0000-0000-000000000001', 'stxn_lag_intraday_1',
   '2026-08-12T12:30:00Z', 'Card deposit', 100.00);

-- Rule 3a (case 3, weekend rollover / defect 2, Fri anchor): lag 1-2,
-- business date Fri 2026-08-14. Window is [Mon Aug17, Wed Aug19) UTC. The
-- deposit is a bare date on Mon Aug17 — the next business day after the
-- weekend. A calendar lag of 1-2 could never reach a Monday from a Friday.
-- source_config carries card_payment_type: deposit_match_source_toast
-- requires this key, or the dispatch step raises.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance, source_config)
VALUES
  ('33333333-6000-0000-0000-000000000002', '11111111-6000-0000-0000-000000000001',
   'toast', 'card', '22222222-6000-0000-0000-000000000001', 'gross', 1, 2, 0.50,
   '{"card_payment_type": "CREDIT"}'::jsonb);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-6000-0000-0000-000000000002', '11111111-6000-0000-0000-000000000001',
   '33333333-6000-0000-0000-000000000002', '2026-08-14', 200.00, 'pending');

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-6000-0000-0000-000000000002', '11111111-6000-0000-0000-000000000001',
   '22222222-6000-0000-0000-000000000001', 'stxn_lag_fri_mon',
   '2026-08-17', 'Card deposit', 200.00);

-- Rule 3b (case 3, weekend rollover, Thu anchor): lag 1-2, business date
-- Thu 2026-08-13. Window is [Fri Aug14, Tue Aug18) UTC. Deposit is a bare
-- date on Mon Aug17.
-- source_config carries card_source_types: deposit_match_source_square
-- requires this key, or the dispatch step raises.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance, source_config)
VALUES
  ('33333333-6000-0000-0000-000000000003', '11111111-6000-0000-0000-000000000001',
   'square', 'card', '22222222-6000-0000-0000-000000000001', 'gross', 1, 2, 0.50,
   '{"card_source_types": ["CARD"]}'::jsonb);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-6000-0000-0000-000000000003', '11111111-6000-0000-0000-000000000001',
   '33333333-6000-0000-0000-000000000003', '2026-08-13', 300.00, 'pending');

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-6000-0000-0000-000000000003', '11111111-6000-0000-0000-000000000001',
   '22222222-6000-0000-0000-000000000001', 'stxn_lag_thu_mon',
   '2026-08-17', 'Card deposit', 300.00);

-- Rule 4 (case 4, out-of-window / late): lag 1-2, business date Mon
-- 2026-08-10. Window is [Tue Aug11, Thu Aug13) UTC. The deposit sits
-- exactly on the 3rd business day out (Thu Aug13 00:00), which is the
-- window's exclusive upper bound — one business day past lag_max, so it
-- must not match. The bank is fully fresh and CURRENT_DATE is long past
-- the window, so the item must land on late/past_lag_max, not pending or
-- incomplete.
-- source_config carries card_payment_types: deposit_match_source_revel
-- requires this key, or the dispatch step raises.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance, source_config)
VALUES
  ('33333333-6000-0000-0000-000000000004', '11111111-6000-0000-0000-000000000001',
   'revel', 'card', '22222222-6000-0000-0000-000000000001', 'gross', 1, 2, 0.50,
   '{"card_payment_types": ["credit_card"]}'::jsonb);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-6000-0000-0000-000000000004', '11111111-6000-0000-0000-000000000001',
   '33333333-6000-0000-0000-000000000004', '2026-08-10', 400.00, 'pending');

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-6000-0000-0000-000000000004', '11111111-6000-0000-0000-000000000001',
   '22222222-6000-0000-0000-000000000001', 'stxn_lag_out_of_window',
   '2026-08-13T00:00:00Z', 'Card deposit', 400.00);

-- Rule 5a (case 5, ladder order — window open, bank healthy -> pending):
-- lag 1-2, business date CURRENT_DATE. expected_by is at least 1 business
-- day ahead of CURRENT_DATE, so the window is still open. No candidate
-- deposit exists.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance)
VALUES
  ('33333333-6000-0000-0000-000000000005', '11111111-6000-0000-0000-000000000001',
   'shift4', 'card', '22222222-6000-0000-0000-000000000001', 'gross', 1, 2, 0.50);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-6000-0000-0000-000000000005', '11111111-6000-0000-0000-000000000001',
   '33333333-6000-0000-0000-000000000005', CURRENT_DATE, 500.00, 'pending');

-- Rule 5b (case 5, ladder order — window closed, feed short of the full
-- last day -> incomplete/bank_stale, not late): lag 1-2, business date
-- CURRENT_DATE - 10, on Bank B whose data_current_through covers only
-- 12 hours into the last lag day. No candidate deposit exists.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance)
VALUES
  ('33333333-6000-0000-0000-000000000006', '11111111-6000-0000-0000-000000000001',
   'clover', 'card', '22222222-6000-0000-0000-000000000002', 'gross', 1, 2, 0.50);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-6000-0000-0000-000000000006', '11111111-6000-0000-0000-000000000001',
   '33333333-6000-0000-0000-000000000006', (CURRENT_DATE - 10), 600.00, 'pending');

-- Rule 6 (case 6, ambiguity-window parity, restaurant 2): lag 1-2,
-- business date Mon 2026-08-10. Window is [Tue Aug11, Thu Aug13) UTC. Two
-- candidate deposits: an exact bare-date match on Tue Aug11 (best fit),
-- and a second, off-by-0.50 deposit with an intraday timestamp on Wed
-- Aug12 — the lag_max business day. Both fall inside the window, so the
-- engine must count the second one and write the winning link as
-- suggested, not confirmed. If site 1 (candidate join) and site 3
-- (ambiguity count) ever used different windows, this diverges.
-- source_config carries card_tender_names, same requirement as rule 2.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance, source_config)
VALUES
  ('33333333-6000-0000-0000-000000000007', '11111111-6000-0000-0000-000000000002',
   'focus', 'card', '22222222-6000-0000-0000-000000000003', 'gross', 1, 2, 1.00,
   '{"card_tender_names": ["Visa"]}'::jsonb);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-6000-0000-0000-000000000007', '11111111-6000-0000-0000-000000000002',
   '33333333-6000-0000-0000-000000000007', '2026-08-10', 700.00, 'pending');

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-6000-0000-0000-000000000005', '11111111-6000-0000-0000-000000000002',
   '22222222-6000-0000-0000-000000000003', 'stxn_lag_ambig_best',
   '2026-08-11', 'Card deposit', 700.00),
  ('55555555-6000-0000-0000-000000000006', '11111111-6000-0000-0000-000000000002',
   '22222222-6000-0000-0000-000000000003', 'stxn_lag_ambig_second',
   '2026-08-12T15:00:00Z', 'Card deposit', 700.50);

-- ---------------------------------------------------------------------
-- Case 7: the new CHECK constraints on deposit_match_rules. Neither
-- insert must ever commit — a distinct pos_source ('shift4') that has no
-- other row for restaurant 2 keeps the failure attributable to the CHECK,
-- not the (restaurant_id, pos_source, rail) unique constraint.
-- ---------------------------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO public.deposit_match_rules
      (restaurant_id, pos_source, rail, connected_bank_id, settlement, lag_days_min, lag_days_max)
    VALUES
      ('11111111-6000-0000-0000-000000000002', 'shift4', 'card',
       '22222222-6000-0000-0000-000000000003', 'gross', 1, 45)$$,
  '23514', NULL,
  'lag_days_max = 45 violates the 0-30 range CHECK constraint'
);

SELECT throws_ok(
  $$INSERT INTO public.deposit_match_rules
      (restaurant_id, pos_source, rail, connected_bank_id, settlement, lag_days_min, lag_days_max)
    VALUES
      ('11111111-6000-0000-0000-000000000002', 'shift4', 'card',
       '22222222-6000-0000-0000-000000000003', 'gross', 3, 1)$$,
  '23514', NULL,
  'lag_days_min > lag_days_max violates the ordering CHECK constraint'
);

SELECT throws_ok(
  $$INSERT INTO public.deposit_match_rules
      (restaurant_id, pos_source, rail, connected_bank_id, settlement, lag_days_min, lag_days_max)
    VALUES
      ('11111111-6000-0000-0000-000000000002', 'shift4', 'card',
       '22222222-6000-0000-0000-000000000003', 'gross', -1, 0)$$,
  '23514', NULL,
  'lag_days_min = -1 violates the 0-30 range CHECK constraint'
);

RESET role;

-- ---------------------------------------------------------------------
-- Run the refresh for both restaurants as their owners.
-- ---------------------------------------------------------------------
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-6000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-6000-0000-0000-000000000001', true);

SELECT lives_ok(
  $$SELECT public.refresh_deposit_matches(
      '11111111-6000-0000-0000-000000000001', '2020-01-01', '2026-12-31')$$,
  'restaurant 1''s owner can run the refresh'
);

-- Every check below through case 9 reads deposit_match_items /
-- deposit_match_links for restaurant 1, so it stays under restaurant 1's
-- owner while its RLS session is still active. The restaurant 2 checks
-- (case 6) come after the jwt switch further down.

-- ---------------------------------------------------------------------
-- Case 2: intraday regression (defect 1).
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000001'),
  'matched',
  'a deposit at 12:30 UTC on the lag_max business day now matches (defect 1 fix)'
);

-- ---------------------------------------------------------------------
-- Case 3: weekend rollover (defect 2), Fri and Thu anchors.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000002'),
  'matched',
  'business date Friday, deposit the next Monday, lag 1-2 -> matched'
);

SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000003'),
  'matched',
  'business date Thursday, deposit the next Monday, lag 1-2 -> matched'
);

-- ---------------------------------------------------------------------
-- Case 4: out-of-window and late.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE item_id = '44444444-6000-0000-0000-000000000004'),
  0,
  'a deposit 3 business days out with lag 1-2 does not match'
);

SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000004'),
  'late',
  'past the window, full bank data, CURRENT_DATE past expected_by -> late'
);

SELECT is(
  (SELECT status_reason FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000004'),
  'past_lag_max',
  'the late status carries reason past_lag_max'
);

-- ---------------------------------------------------------------------
-- Case 5: ladder order.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000005'),
  'pending',
  'window still open, bank healthy -> pending, not incomplete'
);

SELECT is(
  (SELECT status_reason FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000005'),
  'within_lag_window',
  'the pending status carries reason within_lag_window'
);

SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000006'),
  'incomplete',
  'window closed, feed short of the full last day -> incomplete, not late'
);

SELECT is(
  (SELECT status_reason FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000006'),
  'bank_stale',
  'the incomplete status is attributed to the stale feed'
);

-- ---------------------------------------------------------------------
-- Case 9: get_deposit_match_report was not touched by this migration —
-- every bank in its payload still carries suggested_sources. Checked here,
-- still under restaurant 1's owner, before the jwt switch below.
-- ---------------------------------------------------------------------
SELECT ok(
  (SELECT bool_and(b ? 'suggested_sources')
   FROM jsonb_array_elements(
     public.get_deposit_match_report(
       '11111111-6000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
     )->'banks'
   ) b),
  'get_deposit_match_report still returns suggested_sources in the banks payload'
);

-- ---------------------------------------------------------------------
-- Switch to restaurant 2's owner for the refresh and the case 6 checks —
-- deposit_match_items / deposit_match_links are RLS-protected, so reading
-- restaurant 2's rows needs restaurant 2's owner jwt.
-- ---------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-6000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-6000-0000-0000-000000000002', true);

SELECT lives_ok(
  $$SELECT public.refresh_deposit_matches(
      '11111111-6000-0000-0000-000000000002', '2020-01-01', '2026-12-31')$$,
  'restaurant 2''s owner can run the refresh'
);

-- ---------------------------------------------------------------------
-- Case 6: ambiguity-window parity between site 1 and site 3.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE item_id = '44444444-6000-0000-0000-000000000007'),
  1,
  'exactly one link was written for the ambiguous item'
);

SELECT is(
  (SELECT state FROM public.deposit_match_links
   WHERE item_id = '44444444-6000-0000-0000-000000000007'),
  'suggested',
  'the second candidate inside the same window forces state = suggested, not confirmed'
);

SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-6000-0000-0000-000000000007'),
  'needs_review',
  'a suggested-only link leaves the item needs_review'
);

-- ---------------------------------------------------------------------
-- Case 8: the replaced function keeps SECURITY DEFINER and its pinned
-- search path.
-- ---------------------------------------------------------------------
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'refresh_deposit_matches'),
  'refresh_deposit_matches is SECURITY DEFINER (prosecdef = true)'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'refresh_deposit_matches'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ),
  'refresh_deposit_matches has SET search_path = public, pg_temp'
);

SELECT * FROM finish();
ROLLBACK;
