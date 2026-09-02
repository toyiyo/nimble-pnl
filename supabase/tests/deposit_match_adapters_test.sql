BEGIN;
SELECT plan(17);

-- Fixture: one restaurant, one business date, known card and non-card rows
-- per POS source. Each adapter test sums only the card rows.
INSERT INTO public.restaurants (id, name) VALUES
  ('44444444-1000-0000-0000-000000000001', 'Deposit Match Adapters');

-- focus: card tenders 'Visa' (100.00) + 'MC' (50.00) = 150.00, cash excluded.
-- focus_payments_order_fk requires a matching focus_orders row per check.
INSERT INTO public.focus_orders (restaurant_id, business_date, focus_check_id, total) VALUES
  ('44444444-1000-0000-0000-000000000001', '2026-08-25', 'chk-1', 100.00),
  ('44444444-1000-0000-0000-000000000001', '2026-08-25', 'chk-2', 50.00),
  ('44444444-1000-0000-0000-000000000001', '2026-08-25', 'chk-3', 20.00);
INSERT INTO public.focus_payments
  (restaurant_id, business_date, focus_check_id, payment_key, name, amount, tip)
VALUES
  ('44444444-1000-0000-0000-000000000001', '2026-08-25', 'chk-1', 'pay-1', 'Visa', 100.00, 0),
  ('44444444-1000-0000-0000-000000000001', '2026-08-25', 'chk-2', 'pay-2', 'MC', 50.00, 0),
  ('44444444-1000-0000-0000-000000000001', '2026-08-25', 'chk-3', 'pay-3', 'Cash', 20.00, 0);

-- toast: CREDIT amount 80.00 + tip 10.00 = 90.00, CASH row excluded.
INSERT INTO public.toast_payments
  (restaurant_id, toast_payment_guid, toast_order_guid, payment_type, amount, tip_amount, payment_date)
VALUES
  ('44444444-1000-0000-0000-000000000001', 'tp-1', 'to-1', 'CREDIT', 80.00, 10.00, '2026-08-25'),
  ('44444444-1000-0000-0000-000000000001', 'tp-2', 'to-2', 'CASH', 20.00, 0, '2026-08-25');

-- square: CARD payment 100.00 minus CARD refund 15.00 = 85.00, CASH payment excluded.
INSERT INTO public.square_payments
  (restaurant_id, payment_id, location_id, amount_money, created_at, raw_json)
VALUES
  ('44444444-1000-0000-0000-000000000001', 'sqp-1', 'loc-1', 100.00, '2026-08-25T12:00:00Z', '{"source_type":"CARD"}'),
  ('44444444-1000-0000-0000-000000000001', 'sqp-2', 'loc-1', 20.00, '2026-08-25T12:00:00Z', '{"source_type":"CASH"}');
INSERT INTO public.square_refunds
  (restaurant_id, refund_id, amount_money, created_at, raw_json)
VALUES
  ('44444444-1000-0000-0000-000000000001', 'sqr-1', 15.00, '2026-08-25T13:00:00Z', '{"source_type":"CARD"}');

-- revel: CREDITCARD amount 60.00 + tip 5.00 = 65.00, CASH row excluded.
INSERT INTO public.revel_payments
  (restaurant_id, revel_payment_id, revel_order_id, payment_type, amount, tip_amount, payment_date)
VALUES
  ('44444444-1000-0000-0000-000000000001', 'rp-1', 'ro-1', 'CREDITCARD', 60.00, 5.00, '2026-08-25'),
  ('44444444-1000-0000-0000-000000000001', 'rp-2', 'ro-2', 'CASH', 10.00, 0, '2026-08-25');

-- shift4: amounts are stored in cents. Charge 10000 (100.00) minus refund
-- 2000 (20.00) = 80.00.
INSERT INTO public.shift4_charges
  (restaurant_id, charge_id, merchant_id, amount, currency, status, created_at_ts, created_time, service_date)
VALUES
  ('44444444-1000-0000-0000-000000000001', 'ch-1', 'merch-1', 10000, 'USD', 'successful', 1700000000, '2026-08-25T12:00:00Z', '2026-08-25');
INSERT INTO public.shift4_refunds
  (restaurant_id, refund_id, charge_id, merchant_id, amount, currency, status, created_at_ts, created_time, service_date)
VALUES
  ('44444444-1000-0000-0000-000000000001', 'rf-1', 'ch-1', 'merch-1', 2000, 'USD', 'successful', 1700000001, '2026-08-25T13:00:00Z', '2026-08-25');

-- focus adapter: sums only the configured card tender names.
SELECT is(
  (SELECT expected_amount FROM public.deposit_match_source_focus(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date,
    '{"card_tender_names": ["Visa", "MC"]}'::jsonb
  )),
  150.00::numeric,
  'focus adapter sums only the configured card tender names'
);
SELECT is(
  (SELECT row_count FROM public.deposit_match_source_focus(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date,
    '{"card_tender_names": ["Visa", "MC"]}'::jsonb
  )),
  2,
  'focus adapter counts only the card rows'
);
SELECT throws_like(
  $$SELECT * FROM public.deposit_match_source_focus(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date, '{}'::jsonb
  )$$,
  '%card_tender_names%',
  'focus adapter raises when card_tender_names is absent from source_config'
);

-- toast adapter: sums amount + tip_amount for the configured payment type.
SELECT is(
  (SELECT expected_amount FROM public.deposit_match_source_toast(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date,
    '{"card_payment_type": "CREDIT"}'::jsonb
  )),
  90.00::numeric,
  'toast adapter sums amount + tip_amount for CREDIT rows only'
);
SELECT is(
  (SELECT row_count FROM public.deposit_match_source_toast(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date,
    '{"card_payment_type": "CREDIT"}'::jsonb
  )),
  1,
  'toast adapter counts only the CREDIT rows'
);
SELECT throws_like(
  $$SELECT * FROM public.deposit_match_source_toast(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date, '{}'::jsonb
  )$$,
  '%card_payment_type%',
  'toast adapter raises when card_payment_type is absent from source_config'
);

-- square adapter: card payments minus card refunds, keyed off raw_json source_type.
SELECT is(
  (SELECT expected_amount FROM public.deposit_match_source_square(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date,
    '{"card_source_types": ["CARD", "WALLET"]}'::jsonb
  )),
  85.00::numeric,
  'square adapter nets card payments minus card refunds by raw_json source_type'
);
SELECT is(
  (SELECT row_count FROM public.deposit_match_source_square(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date,
    '{"card_source_types": ["CARD", "WALLET"]}'::jsonb
  )),
  2,
  'square adapter counts the card payment row and the card refund row'
);
SELECT throws_like(
  $$SELECT * FROM public.deposit_match_source_square(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date, '{}'::jsonb
  )$$,
  '%card_source_types%',
  'square adapter raises when card_source_types is absent from source_config'
);

-- revel adapter: sums amount + tip_amount for the configured payment types.
SELECT is(
  (SELECT expected_amount FROM public.deposit_match_source_revel(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date,
    '{"card_payment_types": ["CREDITCARD"]}'::jsonb
  )),
  65.00::numeric,
  'revel adapter sums amount + tip_amount for the configured payment types'
);
SELECT is(
  (SELECT row_count FROM public.deposit_match_source_revel(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date,
    '{"card_payment_types": ["CREDITCARD"]}'::jsonb
  )),
  1,
  'revel adapter counts only the configured payment type rows'
);
SELECT throws_like(
  $$SELECT * FROM public.deposit_match_source_revel(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date, '{}'::jsonb
  )$$,
  '%card_payment_types%',
  'revel adapter raises when card_payment_types is absent from source_config'
);

-- shift4 adapter: charges minus refunds by service_date, converted from cents.
SELECT is(
  (SELECT expected_amount FROM public.deposit_match_source_shift4(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date, '{}'::jsonb
  )),
  80.00::numeric,
  'shift4 adapter nets charges minus refunds by service_date, in dollars'
);
SELECT is(
  (SELECT row_count FROM public.deposit_match_source_shift4(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date, '{}'::jsonb
  )),
  2,
  'shift4 adapter counts the charge row and the refund row'
);

-- clover adapter: no normalized tender rows exist yet, so it returns zero rows.
SELECT is(
  (SELECT count(*) FROM public.deposit_match_source_clover(
    '44444444-1000-0000-0000-000000000001'::uuid, '2026-08-25'::date, '2026-08-25'::date, '{}'::jsonb
  )),
  0::bigint,
  'clover adapter always returns zero rows'
);

-- dispatcher: rejects an unknown pos_source and names the bad value.
SELECT throws_like(
  $$SELECT * FROM public.deposit_match_dispatch(
    'bogus_source', '44444444-1000-0000-0000-000000000001'::uuid,
    '2026-08-25'::date, '2026-08-25'::date, '{}'::jsonb
  )$$,
  '%bogus_source%',
  'dispatcher raises and names the unknown pos_source'
);

-- dispatcher: routes 'focus' to the focus adapter with matching output.
SELECT is(
  (SELECT expected_amount FROM public.deposit_match_dispatch(
    'focus', '44444444-1000-0000-0000-000000000001'::uuid,
    '2026-08-25'::date, '2026-08-25'::date, '{"card_tender_names": ["Visa", "MC"]}'::jsonb
  )),
  150.00::numeric,
  'dispatcher routes pos_source focus to deposit_match_source_focus'
);

SELECT * FROM finish();
ROLLBACK;
