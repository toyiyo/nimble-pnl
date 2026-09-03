BEGIN;
SELECT plan(24);

-- Fixture: one restaurant, one owner (view:banking + view:pos_sales +
-- edit:banking via the 'owner' role), two connected banks — one fresh, one
-- never synced (data_current_through IS NULL) for the staleness test.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-3000-0000-0000-000000000001', 'dm-refresh-owner@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-3000-0000-0000-000000000001', 'Deposit Match Refresh');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('aaaaaaaa-3000-0000-0000-000000000001', '11111111-3000-0000-0000-000000000001',
   'owner', 'b0000000-0000-0000-0000-000000000001');

INSERT INTO public.connected_banks
  (id, restaurant_id, stripe_financial_account_id, institution_name, status, data_current_through)
VALUES
  ('22222222-3000-0000-0000-000000000001', '11111111-3000-0000-0000-000000000001',
   'fca_refresh_fresh', 'Fresh Bank', 'connected', '2026-12-31T00:00:00Z'),
  ('22222222-3000-0000-0000-000000000002', '11111111-3000-0000-0000-000000000001',
   'fca_refresh_stale', 'Never Synced Bank', 'connected', NULL);

-- Rules, items, and bank transactions are seeded as postgres (bypasses RLS)
-- so the tests below exercise the refresh engine, not the RLS policies.
SET LOCAL role TO postgres;

-- Rule A (active, gross, lag 0-2): drives both the idempotent-refresh test
-- and the greedy-order regression, on two adjacent business dates.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance, source_config)
VALUES
  ('33333333-3000-0000-0000-000000000001', '11111111-3000-0000-0000-000000000001',
   'focus', 'card', '22222222-3000-0000-0000-000000000001', 'gross', 0, 2, 0.50,
   '{"card_tender_names": ["Visa"]}'::jsonb);

-- Day 1 expects 100.00; Day 2 expects 99.50. Two candidate deposits:
-- 99.50 (exact for Day 2) and 100.50 (0.50 off, within tolerance, for
-- either day). A date-order-first pass on Day 1 could grab the 99.50 exact
-- match for itself (it is within Day 1's own tolerance too), leaving Day 2
-- only the 100.50 deposit — a 1.00 shortfall outside Day 2's 0.50
-- tolerance. The design's global fit-ranked assignment must instead
-- recognize (Day 2, 99.50) as the single best-scored pair in the whole
-- range and assign it first, leaving (Day 1, 100.50) as the only pairing
-- left — both days then match.
INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-3000-0000-0000-000000000001', '11111111-3000-0000-0000-000000000001',
   '33333333-3000-0000-0000-000000000001', '2026-08-10', 100.00, 'pending'),
  ('44444444-3000-0000-0000-000000000002', '11111111-3000-0000-0000-000000000001',
   '33333333-3000-0000-0000-000000000001', '2026-08-11', 99.50, 'pending');

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-3000-0000-0000-000000000001', '11111111-3000-0000-0000-000000000001',
   '22222222-3000-0000-0000-000000000001', 'stxn_refresh_regr_1', '2026-08-11', 'Card deposit', 99.50),
  ('55555555-3000-0000-0000-000000000002', '11111111-3000-0000-0000-000000000001',
   '22222222-3000-0000-0000-000000000001', 'stxn_refresh_regr_2', '2026-08-12', 'Card deposit', 100.50);

-- Rule B (active, gross, lag 0-2): the never-synced bank. A perfect
-- candidate deposit exists, but the bank must never yield late or short.
-- pos_source is 'shift4' (distinct from Rule A's 'focus') so it does not
-- collide with the (restaurant_id, pos_source, rail) unique key.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance)
VALUES
  ('33333333-3000-0000-0000-000000000002', '11111111-3000-0000-0000-000000000001',
   'shift4', 'card', '22222222-3000-0000-0000-000000000002', 'gross', 0, 2, 0.50);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-3000-0000-0000-000000000003', '11111111-3000-0000-0000-000000000001',
   '33333333-3000-0000-0000-000000000002', '2020-01-01', 50.00, 'pending');

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-3000-0000-0000-000000000003', '11111111-3000-0000-0000-000000000001',
   '22222222-3000-0000-0000-000000000002', 'stxn_refresh_stale_1', '2020-01-02', 'Card deposit', 50.00);

-- Rule C (inactive / "unconfirmed"): the owner has not turned it on yet.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, active)
VALUES
  ('33333333-3000-0000-0000-000000000003', '11111111-3000-0000-0000-000000000001',
   'toast', 'card', '22222222-3000-0000-0000-000000000001', 'gross', 0, 2, false);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-3000-0000-0000-000000000004', '11111111-3000-0000-0000-000000000001',
   '33333333-3000-0000-0000-000000000003', '2026-08-10', 30.00, 'pending');

-- Rule D (active, gross): an item an owner already reviewed and accepted.
-- The refresh must never overwrite that resolution. pos_source is 'revel'
-- (distinct from Rules A and B) so it does not collide with the
-- (restaurant_id, pos_source, rail) unique key.
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, source_config)
VALUES
  ('33333333-3000-0000-0000-000000000004', '11111111-3000-0000-0000-000000000001',
   'revel', 'card', '22222222-3000-0000-0000-000000000001', 'gross', 0, 2,
   '{"card_payment_types": ["Visa"]}'::jsonb);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status,
   resolution, resolution_note, resolved_by, resolved_at)
VALUES
  ('44444444-3000-0000-0000-000000000005', '11111111-3000-0000-0000-000000000001',
   '33333333-3000-0000-0000-000000000004', '2026-08-05', 75.00, 'short',
   'accepted', 'Owner confirmed the missing $75 is a known processor delay.',
   'aaaaaaaa-3000-0000-0000-000000000001', '2026-08-20T10:00:00Z');

-- Second restaurant, owner, and bank: the two review-finding regressions
-- below need three POS sources (square, toast, clover) that the static
-- dispatch CASE actually recognizes, and restaurant 1 above already spent
-- four of the six on Rules A-D (focus, shift4, toast, revel).
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-3000-0000-0000-000000000002', 'dm-refresh-owner-2@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-3000-0000-0000-000000000002', 'Deposit Match Refresh 2');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('aaaaaaaa-3000-0000-0000-000000000002', '11111111-3000-0000-0000-000000000002',
   'owner', 'b0000000-0000-0000-0000-000000000001');

INSERT INTO public.connected_banks
  (id, restaurant_id, stripe_financial_account_id, institution_name, status, data_current_through)
VALUES
  ('22222222-3000-0000-0000-000000000003', '11111111-3000-0000-0000-000000000002',
   'fca_refresh_fresh_2', 'Fresh Bank 2', 'connected', '2026-12-31T00:00:00Z');

-- Rule E (active, net, fee band 1.6%-3.1%): a normal processing fee must
-- classify matched_net with the fee recorded, not short with no fee
-- (chatgpt-codex-connector review finding on this migration).
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, fee_pct_min, fee_pct_max, source_config)
VALUES
  ('33333333-3000-0000-0000-000000000005', '11111111-3000-0000-0000-000000000002',
   'square', 'card', '22222222-3000-0000-0000-000000000003', 'net', 0, 2, 1.6, 3.1,
   '{"card_source_types": ["CARD"]}'::jsonb);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-3000-0000-0000-000000000006', '11111111-3000-0000-0000-000000000002',
   '33333333-3000-0000-0000-000000000005', '2026-08-15', 100.00, 'pending');

-- $98.00 on a $100.00 expectation is a 2% fee — inside the 1.6%-3.1% band.
INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-3000-0000-0000-000000000004', '11111111-3000-0000-0000-000000000002',
   '22222222-3000-0000-0000-000000000003', 'stxn_refresh_net_1', '2026-08-16', 'Card deposit', 98.00);

-- Rules F1/F2 (active, gross, same connected bank, same business date,
-- same expected amount): only one $50.00 deposit exists for both to
-- compete over. Without excluding a transaction already confirmed
-- elsewhere from a rule's own candidate set, the second rule to process
-- would insert a second full-amount confirmed link on the same bank
-- transaction, tripping the allocation-cap trigger and rolling that
-- rule's whole refresh back to rule_error (chatgpt-codex-connector review
-- finding on this migration).
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement,
   lag_days_min, lag_days_max, amount_tolerance, source_config)
VALUES
  ('33333333-3000-0000-0000-000000000006', '11111111-3000-0000-0000-000000000002',
   'toast', 'card', '22222222-3000-0000-0000-000000000003', 'gross', 0, 2, 0.50,
   '{"card_payment_type": "CREDIT"}'::jsonb),
  ('33333333-3000-0000-0000-000000000007', '11111111-3000-0000-0000-000000000002',
   'clover', 'card', '22222222-3000-0000-0000-000000000003', 'gross', 0, 2, 0.50, '{}'::jsonb);

INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, status)
VALUES
  ('44444444-3000-0000-0000-000000000007', '11111111-3000-0000-0000-000000000002',
   '33333333-3000-0000-0000-000000000006', '2026-08-17', 50.00, 'pending'),
  ('44444444-3000-0000-0000-000000000008', '11111111-3000-0000-0000-000000000002',
   '33333333-3000-0000-0000-000000000007', '2026-08-17', 50.00, 'pending');

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-3000-0000-0000-000000000005', '11111111-3000-0000-0000-000000000002',
   '22222222-3000-0000-0000-000000000003', 'stxn_refresh_shared_1', '2026-08-17', 'Card deposit', 50.00);

RESET role;

-- ---------------------------------------------------------------------
-- Capability check: refresh_deposit_matches runs the check before any
-- data read, so a caller lacking view:banking (or view:pos_sales) is
-- rejected outright.
-- ---------------------------------------------------------------------
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"99999999-3000-0000-0000-000000000099","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '99999999-3000-0000-0000-000000000099', true);

SELECT throws_like(
  $$SELECT public.refresh_deposit_matches(
      '11111111-3000-0000-0000-000000000001', '2020-01-01', '2026-12-31')$$,
  '%lacks view:banking%',
  'a caller with no restaurant membership cannot run the refresh'
);

SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-3000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-3000-0000-0000-000000000001', true);

-- ---------------------------------------------------------------------
-- Greedy-order regression + first refresh call.
-- ---------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.refresh_deposit_matches(
      '11111111-3000-0000-0000-000000000001', '2020-01-01', '2026-12-31')$$,
  'the owner can run the refresh across the whole fixture range'
);

SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000001'),
  'matched',
  'Day 1 matches its 0.50-off deposit rather than losing the exact one to Day 2'
);

SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000002'),
  'matched',
  'Day 2 gets the exact deposit — the global fit-ranked pass avoids the false shortfall'
);

SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE item_id IN ('44444444-3000-0000-0000-000000000001', '44444444-3000-0000-0000-000000000002')),
  2,
  'exactly one link per day was created, not a duplicate or a cross-assignment'
);

-- ---------------------------------------------------------------------
-- Idempotent refresh: running it again over the same range must not
-- change the outcome or duplicate links.
-- ---------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.refresh_deposit_matches(
      '11111111-3000-0000-0000-000000000001', '2020-01-01', '2026-12-31')$$,
  'a second refresh over the same range runs cleanly'
);

SELECT is(
  (SELECT array_agg(status ORDER BY id) FROM public.deposit_match_items
   WHERE id IN ('44444444-3000-0000-0000-000000000001', '44444444-3000-0000-0000-000000000002')),
  ARRAY['matched', 'matched'],
  'the second refresh reproduces the same statuses'
);

SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links
   WHERE item_id IN ('44444444-3000-0000-0000-000000000001', '44444444-3000-0000-0000-000000000002')),
  2,
  'the second refresh did not duplicate the links'
);

-- ---------------------------------------------------------------------
-- Stale bank: a perfect candidate deposit exists, but data_current_through
-- is NULL (never synced), so the item must land on incomplete — never
-- late, never short.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000003'),
  'incomplete',
  'an item on a never-synced bank is incomplete, even with a perfect deposit sitting there'
);

SELECT is(
  (SELECT status_reason FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000003'),
  'bank_stale',
  'the incomplete status is attributed to the stale bank, not a real shortfall'
);

SELECT is(
  (SELECT received_amount FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000003'),
  0::numeric,
  'the stale bank''s deposit was never linked, so nothing was received'
);

-- ---------------------------------------------------------------------
-- Unconfirmed (inactive) rule: its items go to incomplete/rule_inactive,
-- never late or short, regardless of what they looked like before.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000004'),
  'incomplete',
  'an item under an unconfirmed (inactive) rule is incomplete'
);

SELECT is(
  (SELECT status_reason FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000004'),
  'rule_inactive',
  'the reason names the inactive rule, not a POS or bank problem'
);

-- ---------------------------------------------------------------------
-- Resolution survives a refresh: the engine may recompute status, but it
-- must never touch resolution or resolution_note.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT resolution FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000005'),
  'accepted',
  'a refresh does not clear an owner''s accepted resolution'
);

SELECT is(
  (SELECT resolution_note FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000005'),
  'Owner confirmed the missing $75 is a known processor delay.',
  'a refresh does not touch the resolution note either'
);

-- ---------------------------------------------------------------------
-- Report: the summary totals equal the sum of the ledger rows the same
-- call returns, so the client never has to recompute a total itself.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT (public.get_deposit_match_report(
     '11111111-3000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
   )->'summary'->>'total_expected')::numeric),
  (SELECT SUM((l->>'expected_amount')::numeric) FROM jsonb_array_elements(
     public.get_deposit_match_report(
       '11111111-3000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
     )->'ledger'
   ) l),
  'summary.total_expected equals the sum of the ledger rows'' expected_amount'
);

SELECT is(
  (SELECT (public.get_deposit_match_report(
     '11111111-3000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
   )->'summary'->>'total_received')::numeric),
  (SELECT SUM((l->>'received_amount')::numeric) FROM jsonb_array_elements(
     public.get_deposit_match_report(
       '11111111-3000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
     )->'ledger'
   ) l),
  'summary.total_received equals the sum of the ledger rows'' received_amount'
);

SELECT is(
  (SELECT (public.get_deposit_match_report(
     '11111111-3000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
   )->'summary'->>'total_fees')::numeric),
  (SELECT SUM((l->>'fee_amount')::numeric) FROM jsonb_array_elements(
     public.get_deposit_match_report(
       '11111111-3000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
     )->'ledger'
   ) l),
  'summary.total_fees equals the sum of the ledger rows'' fee_amount'
);

-- ---------------------------------------------------------------------
-- Refresh the second restaurant (Rules E, F1, F2 live there) as its owner.
-- ---------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-3000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-3000-0000-0000-000000000002', true);

SELECT lives_ok(
  $$SELECT public.refresh_deposit_matches(
      '11111111-3000-0000-0000-000000000002', '2020-01-01', '2026-12-31')$$,
  'the second restaurant''s owner can run the refresh over its own fixture range'
);

-- ---------------------------------------------------------------------
-- Net settlement fee-band classification: a normal processing fee inside
-- the rule's fee band must land on matched_net with the fee recorded, not
-- short with no fee (Rule E fixture).
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT status FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000006'),
  'matched_net',
  'a $98 deposit on a $100 net expectation with a 1.6%-3.1% fee band matches, not short'
);

SELECT is(
  (SELECT fee_amount FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000006'),
  2.00::numeric,
  'the $2 gap is recorded as the fee, not dropped'
);

SELECT is(
  (SELECT received_amount FROM public.deposit_match_items WHERE id = '44444444-3000-0000-0000-000000000006'),
  98.00::numeric,
  'received_amount is the full deposit, fee and all'
);

-- ---------------------------------------------------------------------
-- Cross-rule allocation: two rules sharing a bank and competing for the
-- same single deposit must never trip the allocation-cap trigger (Rules
-- F1/F2 fixture). Rule processing order is not guaranteed, so this
-- asserts on the outcome shape, not on which rule wins.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_items
   WHERE rule_id IN ('33333333-3000-0000-0000-000000000006', '33333333-3000-0000-0000-000000000007')
     AND status_reason = 'rule_error'),
  0,
  'sharing one deposit across two rules never trips the allocation-cap trigger'
);

SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_links l
   JOIN public.deposit_match_items i ON i.id = l.item_id
   WHERE i.rule_id IN ('33333333-3000-0000-0000-000000000006', '33333333-3000-0000-0000-000000000007')
     AND l.state = 'confirmed'),
  1,
  'only one rule confirms the shared deposit; the loser is left pending, not double-allocated'
);

SELECT * FROM finish();
ROLLBACK;
