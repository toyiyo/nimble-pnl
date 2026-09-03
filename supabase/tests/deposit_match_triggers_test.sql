BEGIN;
SELECT plan(6);

-- Fixture: one restaurant, two connected banks — one belonging to the
-- restaurant, one belonging to a different (unrelated) restaurant, to
-- exercise the tenant-mismatch guard on deposit_match_rules.
INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-2000-0000-0000-000000000001', 'Trigger Test A'),
  ('11111111-2000-0000-0000-000000000002', 'Trigger Test B');

INSERT INTO public.connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name) VALUES
  ('22222222-2000-0000-0000-000000000001', '11111111-2000-0000-0000-000000000001',
   'fca_trig_a_1', 'Trigger Bank A'),
  ('22222222-2000-0000-0000-000000000002', '11111111-2000-0000-0000-000000000002',
   'fca_trig_b_1', 'Trigger Bank B');

-- ---------------------------------------------------------------------
-- Tenant check trigger: connected_bank_id must belong to restaurant_id.
-- ---------------------------------------------------------------------
SELECT throws_like(
  $$INSERT INTO public.deposit_match_rules
      (id, restaurant_id, pos_source, rail, connected_bank_id, settlement, lag_days_min, lag_days_max)
    VALUES ('33333333-2000-0000-0000-000000000001', '11111111-2000-0000-0000-000000000001',
            'square', 'card', '22222222-2000-0000-0000-000000000002', 'gross', 1, 3)$$,
  '%does not belong to restaurant_id%',
  'a rule cannot point at a connected_bank_id owned by another restaurant'
);

SELECT lives_ok(
  $$INSERT INTO public.deposit_match_rules
      (id, restaurant_id, pos_source, rail, connected_bank_id, settlement, lag_days_min, lag_days_max)
    VALUES ('33333333-2000-0000-0000-000000000002', '11111111-2000-0000-0000-000000000001',
            'square', 'card', '22222222-2000-0000-0000-000000000001', 'gross', 1, 3)$$,
  'a rule pointing at its own restaurant''s connected bank succeeds'
);

-- ---------------------------------------------------------------------
-- Allocation cap trigger: confirmed links cannot sum past the bank
-- transaction amount. Bank transaction amount is 100.00.
-- ---------------------------------------------------------------------
INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount)
VALUES
  ('44444444-2000-0000-0000-000000000001', '11111111-2000-0000-0000-000000000001',
   '33333333-2000-0000-0000-000000000002', '2026-08-30', 100.00),
  ('44444444-2000-0000-0000-000000000002', '11111111-2000-0000-0000-000000000001',
   '33333333-2000-0000-0000-000000000002', '2026-08-31', 50.00);

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-2000-0000-0000-000000000001', '11111111-2000-0000-0000-000000000001',
   '22222222-2000-0000-0000-000000000001', 'stxn_trig_cap_1', '2026-09-01', 'Card deposit', 100.00);

SELECT lives_ok(
  $$INSERT INTO public.deposit_match_links
      (id, restaurant_id, item_id, bank_transaction_id, allocated_amount, method, state)
    VALUES ('66666666-2000-0000-0000-000000000001', '11111111-2000-0000-0000-000000000001',
            '44444444-2000-0000-0000-000000000001', '55555555-2000-0000-0000-000000000001',
            100.00, 'auto', 'confirmed')$$,
  'a confirmed link exactly at the transaction amount is accepted'
);

SELECT throws_like(
  $$INSERT INTO public.deposit_match_links
      (id, restaurant_id, item_id, bank_transaction_id, allocated_amount, method, state)
    VALUES ('66666666-2000-0000-0000-000000000002', '11111111-2000-0000-0000-000000000001',
            '44444444-2000-0000-0000-000000000002', '55555555-2000-0000-0000-000000000001',
            0.01, 'auto', 'confirmed')$$,
  '%would exceed bank transaction%',
  'a second confirmed link that would push the sum past the transaction amount is rejected'
);

-- A merely-suggested (not confirmed) link is not capped — it does not
-- count toward received_amount, per the design.
SELECT lives_ok(
  $$INSERT INTO public.deposit_match_links
      (id, restaurant_id, item_id, bank_transaction_id, allocated_amount, method, state)
    VALUES ('66666666-2000-0000-0000-000000000003', '11111111-2000-0000-0000-000000000001',
            '44444444-2000-0000-0000-000000000002', '55555555-2000-0000-0000-000000000001',
            50.00, 'auto', 'suggested')$$,
  'a suggested (unconfirmed) link is not subject to the confirmed-allocation cap'
);

-- Confirming that same link now would push confirmed allocations to 150
-- against a 100 transaction, so it must be rejected too.
SELECT throws_like(
  $$UPDATE public.deposit_match_links SET state = 'confirmed'
    WHERE id = '66666666-2000-0000-0000-000000000003'$$,
  '%would exceed bank transaction%',
  'promoting a suggested link to confirmed is capped the same way as an insert'
);

SELECT * FROM finish();
ROLLBACK;
