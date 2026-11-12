BEGIN;
SELECT plan(43);

-- Design ref: docs/superpowers/specs/2026-11-11-deposit-match-pair-design.md
-- Dates: 2026-08-14 is a Friday. Aug 15 Sat, Aug 16 Sun, Aug 17 Mon, Aug 18 Tue.
-- All dates are in the past, so an unmatched item ends as late.
-- Each case uses its own restaurant (suffix = cases A..Q).

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-7000-0000-0000-000000000001', 'dm-group-owner@test.local');

SET LOCAL role TO postgres;

-- Seed helper: one restaurant, bank, gross rule, items and deposits.
CREATE FUNCTION pg_temp.seed_case(
  p_n int, p_item_dates date[], p_item_amts numeric[],
  p_dep_dates date[], p_dep_amts numeric[],
  p_settlement text DEFAULT 'gross', p_fee_min numeric DEFAULT 0, p_fee_max numeric DEFAULT 0
) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_rest uuid := ('11111111-7000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_bank uuid := ('22222222-7000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_rule uuid := ('33333333-7000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  i int;
BEGIN
  INSERT INTO public.restaurants (id, name) VALUES (v_rest, 'Group Pass ' || p_n);
  INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
  VALUES ('aaaaaaaa-7000-0000-0000-000000000001', v_rest, 'owner',
          'b0000000-0000-0000-0000-000000000001');
  INSERT INTO public.connected_banks
    (id, restaurant_id, stripe_financial_account_id, institution_name, status, data_current_through)
  VALUES (v_bank, v_rest, 'fca_group_' || p_n, 'Group Bank', 'connected',
          (CURRENT_DATE + interval '1 year'));
  INSERT INTO public.deposit_match_rules
    (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
     lag_days_min, lag_days_max, amount_tolerance, amount_tolerance_pct,
     descriptor_pattern, source_config, fee_pct_min, fee_pct_max)
  VALUES (v_rule, v_rest, 'focus', 'card', v_bank, p_settlement, 1, 3, 5, 0.005,
          'SHIFT4', '{"card_tender_names": ["Visa"]}'::jsonb, p_fee_min, p_fee_max);
  FOR i IN 1..array_length(p_item_dates, 1) LOOP
    INSERT INTO public.deposit_match_items
      (restaurant_id, rule_id, business_date, expected_amount, status)
    VALUES (v_rest, v_rule, p_item_dates[i], p_item_amts[i], 'pending');
  END LOOP;
  FOR i IN 1..array_length(p_dep_dates, 1) LOOP
    INSERT INTO public.bank_transactions
      (restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
    VALUES (v_rest, v_bank, 'stxn_group_' || p_n || '_' || i,
            p_dep_dates[i]::timestamptz, 'SHIFT4 DEPOSIT', p_dep_amts[i]);
  END LOOP;
END $f$;

-- A: prod shape 2 -> 2
SELECT pg_temp.seed_case(1,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[971.56, 1263.05],
  ARRAY['2026-08-17','2026-08-18']::date[], ARRAY[1000.72, 1233.89]);
-- B: weekend 2 -> 1
SELECT pg_temp.seed_case(2,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[400.00, 600.00],
  ARRAY['2026-08-17']::date[], ARRAY[1000.00]);
-- C: 3 -> 2
SELECT pg_temp.seed_case(3,
  ARRAY['2026-08-14','2026-08-15','2026-08-16']::date[], ARRAY[300.00, 500.00, 700.00],
  ARRAY['2026-08-17','2026-08-18']::date[], ARRAY[640.00, 860.00]);
-- D: no fit
SELECT pg_temp.seed_case(4,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[971.56, 1263.05],
  ARRAY['2026-08-17','2026-08-18']::date[], ARRAY[1000.72, 1250.00]);
-- E: 1:1 wins
SELECT pg_temp.seed_case(5,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[500.00, 700.00],
  ARRAY['2026-08-17','2026-08-18']::date[], ARRAY[500.00, 690.00]);
-- F: gap day
SELECT pg_temp.seed_case(6,
  ARRAY['2026-08-14','2026-08-16']::date[], ARRAY[400.00, 600.00],
  ARRAY['2026-08-17']::date[], ARRAY[1000.00]);

-- H: net 2 -> 2
SELECT pg_temp.seed_case(7,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[1000.00, 1000.00],
  ARRAY['2026-08-17','2026-08-18']::date[], ARRAY[600.00, 1360.00],
  'net', 1.6, 3.1);
-- I: ambiguous, each deposit fits as 2 -> 1
SELECT pg_temp.seed_case(8,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[400.00, 600.00],
  ARRAY['2026-08-17','2026-08-18']::date[], ARRAY[1000.00, 1001.00]);

-- J: item with expected_amount <= 0 (guard)
SELECT pg_temp.seed_case(9,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[-10.00, 1000.00],
  ARRAY['2026-08-17']::date[], ARRAY[990.00]);
-- K: shares are positive but the last share is outside the Step 5 band
-- (allocation guard). Shares are 0.02 and 0.01. The plan case with items
-- 0.01 and 0.01 cannot reach the guard: the 1:1 pass always matches it.
SELECT pg_temp.seed_case(10,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[0.02, 0.02],
  ARRAY['2026-08-17']::date[], ARRAY[0.03]);
UPDATE public.deposit_match_rules SET amount_tolerance = 0, amount_tolerance_pct = 0.4
WHERE id = '33333333-7000-0000-0000-000000000010';
-- L: deposit confirmed by another rule
SELECT pg_temp.seed_case(11,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[400.00, 600.00],
  ARRAY['2026-08-17']::date[], ARRAY[1000.00]);
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance, amount_tolerance_pct,
   descriptor_pattern, source_config, fee_pct_min, fee_pct_max)
VALUES ('33333333-7000-0000-0001-000000000011', '11111111-7000-0000-0000-000000000011', 'toast', 'card',
        '22222222-7000-0000-0000-000000000011', 'gross', 1, 3, 5, 0.005,
        'SHIFT4', '{"card_tender_names": ["Visa"]}'::jsonb, 0, 0);
INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES ('44444444-7000-0000-0000-000000000011', '11111111-7000-0000-0000-000000000011',
        '33333333-7000-0000-0001-000000000011', '2026-08-14', 1000.00, 'pending');
INSERT INTO public.deposit_match_links
  (restaurant_id, item_id, bank_transaction_id, allocated_amount, method, state, match_reason)
SELECT '11111111-7000-0000-0000-000000000011', '44444444-7000-0000-0000-000000000011', bt.id, 1000.00,
       'manual', 'confirmed', 'manual'
FROM public.bank_transactions bt WHERE bt.restaurant_id = '11111111-7000-0000-0000-000000000011';
-- M: manual link on one item of a group
SELECT pg_temp.seed_case(12,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[971.56, 1263.05],
  ARRAY['2026-08-17','2026-08-18']::date[], ARRAY[1000.72, 1233.89]);
INSERT INTO public.bank_transactions
  (restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES ('11111111-7000-0000-0000-000000000012', '22222222-7000-0000-0000-000000000012',
        'stxn_group_12_other', '2026-08-20'::timestamptz, 'OTHER DEPOSIT', 55.00);
INSERT INTO public.deposit_match_links
  (restaurant_id, item_id, bank_transaction_id, allocated_amount, method, state, match_reason)
SELECT '11111111-7000-0000-0000-000000000012', i.id, bt.id, 55.00, 'manual', 'confirmed', 'manual'
FROM public.deposit_match_items i, public.bank_transactions bt
WHERE i.restaurant_id = '11111111-7000-0000-0000-000000000012' AND i.business_date = '2026-08-15'
  AND bt.stripe_transaction_id = 'stxn_group_12_other';
-- N: stale bank
SELECT pg_temp.seed_case(13,
  ARRAY['2026-08-15','2026-08-16']::date[], ARRAY[971.56, 1263.05],
  ARRAY['2026-08-17','2026-08-18']::date[], ARRAY[1000.72, 1233.89]);
UPDATE public.connected_banks SET data_current_through = '2026-08-16'
WHERE id = '22222222-7000-0000-0000-000000000013';

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-7000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-7000-0000-0000-000000000001', true);

SELECT public.refresh_deposit_matches(
  ('11111111-7000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '2026-08-01', '2026-08-31')
FROM generate_series(1, 13) AS n;

SET LOCAL role TO postgres;

-- Snapshot for the idempotency case (G).
CREATE TEMP TABLE snap_a AS
SELECT l.item_id, l.bank_transaction_id, l.allocated_amount, l.state
FROM public.deposit_match_links l
WHERE l.restaurant_id = '11111111-7000-0000-0000-000000000001';

-- ---------------------------------------------------------------------
-- Case A
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000001'),
  'matched,matched', 'A: both items are matched');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000001'),
  3, 'A: 3 links');
SELECT is(
  (SELECT string_agg(s::text, ',' ORDER BY d) FROM (
     SELECT i.business_date d, sum(l.allocated_amount) s
     FROM public.deposit_match_items i JOIN public.deposit_match_links l ON l.item_id = i.id
     WHERE i.restaurant_id = '11111111-7000-0000-0000-000000000001' GROUP BY i.business_date) q),
  '971.56,1263.05', 'A: allocation per item equals expected_amount');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_items i
   WHERE i.restaurant_id = '11111111-7000-0000-0000-000000000001'
     AND i.expected_amount = (SELECT sum(allocated_amount) FROM public.deposit_match_links WHERE item_id = i.id)),
  2, 'A: item allocation sum check (count of items that agree)');
SELECT is(
  (SELECT string_agg(s::text, ',' ORDER BY d) FROM (
     SELECT bt.transaction_date d, sum(l.allocated_amount) s
     FROM public.bank_transactions bt JOIN public.deposit_match_links l ON l.bank_transaction_id = bt.id
     WHERE bt.restaurant_id = '11111111-7000-0000-0000-000000000001' GROUP BY bt.transaction_date) q),
  '1000.72,1233.89', 'A: allocation per deposit equals amount');
SELECT is(
  (SELECT count(*)::int FROM public.bank_transactions bt
   WHERE bt.restaurant_id = '11111111-7000-0000-0000-000000000001'
     AND bt.amount = (SELECT sum(allocated_amount) FROM public.deposit_match_links WHERE bank_transaction_id = bt.id)),
  2, 'A: deposit allocation sum check (count of deposits that agree)');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000001'
     AND match_reason = 'group_gross_fit' AND state = 'confirmed' AND method = 'auto'),
  3, 'A: every link is group_gross_fit, confirmed, auto');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000001'),
  3, 'A: no extra links');

-- ---------------------------------------------------------------------
-- Case B
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000002'),
  'matched,matched', 'B: both items are matched');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000002'),
  2, 'B: 2 links');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000002' AND match_reason = 'group_gross_fit'),
  2, 'B: both links are group_gross_fit');

-- ---------------------------------------------------------------------
-- Case C
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000003'),
  'matched,matched,matched', 'C: all 3 items are matched');
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000003'),
  '<=', 4, 'C: at most 4 links');

-- ---------------------------------------------------------------------
-- Case D
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000004'),
  'late,late', 'D: both items are late');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000004'),
  0, 'D: no links');

-- ---------------------------------------------------------------------
-- Case E
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT l.match_reason FROM public.deposit_match_links l
   JOIN public.deposit_match_items i ON i.id = l.item_id
   WHERE i.restaurant_id = '11111111-7000-0000-0000-000000000005' AND i.business_date = '2026-08-15'),
  'gross_fit', 'E: Saturday links 1:1 with gross_fit');
SELECT is(
  (SELECT status FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000005' AND business_date = '2026-08-16'),
  'late', 'E: Sunday stays late');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links l
   JOIN public.deposit_match_items i ON i.id = l.item_id
   WHERE i.restaurant_id = '11111111-7000-0000-0000-000000000005' AND i.business_date = '2026-08-16'),
  0, 'E: Sunday has 0 links');

-- ---------------------------------------------------------------------
-- Case F
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000006'),
  'late,late', 'F: gap day, both items are late');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000006'),
  0, 'F: gap day, no links');

-- ---------------------------------------------------------------------
-- Case G: a second refresh gives the same links
-- ---------------------------------------------------------------------
SET LOCAL role TO authenticated;
SELECT public.refresh_deposit_matches(
  '11111111-7000-0000-0000-000000000001', '2026-08-01', '2026-08-31');
SET LOCAL role TO postgres;

SELECT results_eq(
  $$SELECT item_id, bank_transaction_id, allocated_amount, state
    FROM public.deposit_match_links
    WHERE restaurant_id = '11111111-7000-0000-0000-000000000001'
    ORDER BY 1, 2$$,
  $$SELECT item_id, bank_transaction_id, allocated_amount, state FROM snap_a ORDER BY 1, 2$$,
  'G: a second refresh gives the same links');

-- ---------------------------------------------------------------------
-- Case H: net group
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000007'),
  'matched_net,matched_net', 'H: both items are matched_net');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000007'
     AND match_reason = 'group_net_fee_fit'),
  3, 'H: 3 links with group_net_fee_fit');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000007' AND fee_amount > 0),
  2, 'H: both items have a fee');

-- ---------------------------------------------------------------------
-- Case I: ambiguous group
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT string_agg(DISTINCT state, ',') FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000008'),
  'suggested', 'I: every link is suggested');
SELECT is(
  (SELECT string_agg(status || '/' || status_reason, ',' ORDER BY business_date)
   FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000008'),
  'needs_review/ambiguous_match,needs_review/ambiguous_match', 'I: both items need review');
SELECT is(
  (SELECT count(DISTINCT state)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000008'),
  1, 'I: one state for the whole group');

-- ---------------------------------------------------------------------
-- Guard cases J..N
-- ---------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.deposit_match_links WHERE restaurant_id = '11111111-7000-0000-0000-000000000009'),
  0, 'J: 0 links');
SELECT is((SELECT status FROM public.deposit_match_items WHERE restaurant_id = '11111111-7000-0000-0000-000000000009' AND business_date = '2026-08-16'),
  'late', 'J: Sun is late');
SELECT is((SELECT count(*)::int FROM public.deposit_match_items WHERE restaurant_id = '11111111-7000-0000-0000-000000000009' AND status_reason = 'rule_error'),
  0, 'J: no rule_error');
SELECT is((SELECT count(*)::int FROM public.deposit_match_links WHERE restaurant_id = '11111111-7000-0000-0000-000000000010'),
  0, 'K: 0 links');
SELECT is((SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items WHERE restaurant_id = '11111111-7000-0000-0000-000000000010'),
  'late,late', 'K: both items late');
SELECT is((SELECT count(*)::int FROM public.deposit_match_items WHERE restaurant_id = '11111111-7000-0000-0000-000000000010' AND status_reason = 'rule_error'),
  0, 'K: no rule_error');
SELECT is((SELECT count(*)::int FROM public.deposit_match_links l JOIN public.deposit_match_items i ON i.id = l.item_id
            WHERE i.restaurant_id = '11111111-7000-0000-0000-000000000011' AND i.rule_id = '33333333-7000-0000-0000-000000000011'),
  0, 'L: no group link uses the other rule deposit');
SELECT is((SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items
            WHERE restaurant_id = '11111111-7000-0000-0000-000000000011' AND rule_id = '33333333-7000-0000-0000-000000000011'),
  'late,late', 'L: both items late');
SELECT is((SELECT count(*)::int FROM public.deposit_match_links l JOIN public.deposit_match_items i ON i.id = l.item_id
            WHERE i.restaurant_id = '11111111-7000-0000-0000-000000000012' AND i.business_date = '2026-08-16' AND l.method = 'auto'),
  0, 'M: Sun has 0 auto links');
SELECT is((SELECT count(*)::int FROM public.deposit_match_links WHERE restaurant_id = '11111111-7000-0000-0000-000000000013')
          + (SELECT count(*)::int FROM public.deposit_match_items WHERE restaurant_id = '11111111-7000-0000-0000-000000000013' AND status = 'incomplete' AND status_reason = 'bank_stale'),
  2, 'N: 0 group links and both items incomplete / bank_stale');

-- ---------------------------------------------------------------------
-- Case P: a partial range starts inside a group
-- ---------------------------------------------------------------------
SET LOCAL role TO authenticated;
SELECT public.refresh_deposit_matches(
  '11111111-7000-0000-0000-000000000001', '2026-08-16', '2026-08-31');
SET LOCAL role TO postgres;
SELECT is(
  (SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000001'),
  'matched,matched', 'P: both items are matched');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000001'),
  3, 'P: 3 links');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_items i
   WHERE i.restaurant_id = '11111111-7000-0000-0000-000000000001'
     AND i.expected_amount = (SELECT sum(allocated_amount) FROM public.deposit_match_links WHERE item_id = i.id)),
  2, 'P: allocation per item equals expected_amount');

-- ---------------------------------------------------------------------
-- Case Q: a partial range cuts a 3 -> 2 chain (a-x, b-x, b-y, c-y)
-- The closure needs two rounds to reach item a from item c.
-- ---------------------------------------------------------------------
SET LOCAL role TO authenticated;
SELECT public.refresh_deposit_matches(
  '11111111-7000-0000-0000-000000000003', '2026-08-16', '2026-08-31');
SET LOCAL role TO postgres;
SELECT is(
  (SELECT string_agg(status, ',' ORDER BY business_date) FROM public.deposit_match_items
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000003'),
  'matched,matched,matched', 'Q: all 3 items are matched');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE restaurant_id = '11111111-7000-0000-0000-000000000003'),
  4, 'Q: 4 links');
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_items i
   WHERE i.restaurant_id = '11111111-7000-0000-0000-000000000003'
     AND i.expected_amount = (SELECT sum(allocated_amount) FROM public.deposit_match_links WHERE item_id = i.id)),
  3, 'Q: allocation per item equals expected_amount');

SELECT * FROM finish();
ROLLBACK;
