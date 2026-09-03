BEGIN;
SELECT plan(10);

-- Fixture: one restaurant, one owner (view:banking + view:pos_sales via the
-- 'owner' role), four connected banks. Each bank isolates one scan case, so
-- a failing assertion names the exact rule that broke.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-5000-0000-0000-000000000001', 'dm-banks-owner@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-5000-0000-0000-000000000001', 'Deposit Match Banks');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('aaaaaaaa-5000-0000-0000-000000000001', '11111111-5000-0000-0000-000000000001',
   'owner', 'b0000000-0000-0000-0000-000000000001');

-- Bank 1: carries account_mask '9510' and exactly 3 TST* rows (the
-- threshold's exact side: 3 qualifies).
-- Bank 2: 2 TST* rows only (the threshold's low side: 2 does not qualify).
-- Bank 3: no mask, 3 SHIFT4 rows (the dual-source case: both focus and
-- shift4 point at the same descriptor).
-- Bank 4: 3 TST* rows, but only one is a real candidate — one is a
-- negative refund, one is a transfer — so the count that reaches the
-- threshold check is 1, not 3.
-- Bank 5: status 'requires_reauth', 3 TST* rows that would otherwise clear
-- the threshold — the scan must skip a bank the refresh engine cannot
-- match against, so suggested_sources stays empty regardless of hits.
-- Bank 6: 3 TST* rows all dated with today's timestamp (now()), not
-- CURRENT_DATE - N — the scan's upper bound must include a transaction
-- posted later today, not only transactions from a prior day.
INSERT INTO public.connected_banks
  (id, restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
VALUES
  ('22222222-5000-0000-0000-000000000001', '11111111-5000-0000-0000-000000000001',
   'fca_banks_1', 'Mercury', 'connected', '9510'),
  ('22222222-5000-0000-0000-000000000002', '11111111-5000-0000-0000-000000000001',
   'fca_banks_2', 'Chase', 'connected', NULL),
  ('22222222-5000-0000-0000-000000000003', '11111111-5000-0000-0000-000000000001',
   'fca_banks_3', 'Citizens', 'connected', NULL),
  ('22222222-5000-0000-0000-000000000004', '11111111-5000-0000-0000-000000000001',
   'fca_banks_4', 'Wells', 'connected', NULL),
  ('22222222-5000-0000-0000-000000000005', '11111111-5000-0000-0000-000000000001',
   'fca_banks_5', 'Ally', 'requires_reauth', '4471'),
  ('22222222-5000-0000-0000-000000000006', '11111111-5000-0000-0000-000000000001',
   'fca_banks_6', 'Bluevine', 'connected', '3302');

-- Bank transactions are seeded as postgres (bypasses RLS) so the tests
-- below exercise the report function, not the RLS policies.
SET LOCAL role TO postgres;

-- Bank 1: 3 TST* rows, positive, not a transfer, inside the 90-day window.
INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-5000-0000-0000-000000000001', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000001', 'stxn_banks_1_1', CURRENT_DATE - 1, 'TST* Nimble Diner', 70.00),
  ('55555555-5000-0000-0000-000000000002', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000001', 'stxn_banks_1_2', CURRENT_DATE - 2, 'TST* Nimble Diner', 71.00),
  ('55555555-5000-0000-0000-000000000003', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000001', 'stxn_banks_1_3', CURRENT_DATE - 3, 'TST* Nimble Diner', 72.00);

-- Bank 2: only 2 TST* rows.
INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-5000-0000-0000-000000000004', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000002', 'stxn_banks_2_1', CURRENT_DATE - 1, 'TST* Nimble Diner', 40.00),
  ('55555555-5000-0000-0000-000000000005', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000002', 'stxn_banks_2_2', CURRENT_DATE - 2, 'TST* Nimble Diner', 41.00);

-- Bank 3: 3 SHIFT4 rows.
INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-5000-0000-0000-000000000006', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000003', 'stxn_banks_3_1', CURRENT_DATE - 1, 'SHIFT4; PYMT PROC', 30.00),
  ('55555555-5000-0000-0000-000000000007', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000003', 'stxn_banks_3_2', CURRENT_DATE - 2, 'SHIFT4; PYMT PROC', 31.00),
  ('55555555-5000-0000-0000-000000000008', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000003', 'stxn_banks_3_3', CURRENT_DATE - 3, 'SHIFT4; PYMT PROC', 32.00);

-- Bank 4: one valid TST* row, one negative-amount TST* row (a refund), one
-- TST* row marked is_transfer. Only the first is a real candidate.
INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, is_transfer)
VALUES
  ('55555555-5000-0000-0000-000000000009', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000004', 'stxn_banks_4_1', CURRENT_DATE - 1, 'TST* Nimble Diner', 20.00, false),
  ('55555555-5000-0000-0000-000000000010', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000004', 'stxn_banks_4_2', CURRENT_DATE - 2, 'TST* Nimble Diner', -20.00, false),
  ('55555555-5000-0000-0000-000000000011', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000004', 'stxn_banks_4_3', CURRENT_DATE - 3, 'TST* Nimble Diner', 21.00, true);

-- Bank 5: 3 TST* rows, positive, not a transfer — would clear the
-- threshold if the bank were 'connected'. It is 'requires_reauth'.
INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-5000-0000-0000-000000000012', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000005', 'stxn_banks_5_1', CURRENT_DATE - 1, 'TST* Nimble Diner', 50.00),
  ('55555555-5000-0000-0000-000000000013', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000005', 'stxn_banks_5_2', CURRENT_DATE - 2, 'TST* Nimble Diner', 51.00),
  ('55555555-5000-0000-0000-000000000014', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000005', 'stxn_banks_5_3', CURRENT_DATE - 3, 'TST* Nimble Diner', 52.00);

-- Bank 6: 3 TST* rows, all timestamped with now() (today, after midnight
-- UTC) — the upper bound of the scan window must not drop these.
INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-5000-0000-0000-000000000015', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000006', 'stxn_banks_6_1', now(), 'TST* Nimble Diner', 60.00),
  ('55555555-5000-0000-0000-000000000016', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000006', 'stxn_banks_6_2', now(), 'TST* Nimble Diner', 61.00),
  ('55555555-5000-0000-0000-000000000017', '11111111-5000-0000-0000-000000000001',
   '22222222-5000-0000-0000-000000000006', 'stxn_banks_6_3', now(), 'TST* Nimble Diner', 62.00);

RESET role;

-- Call the report as the owner.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-5000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-5000-0000-0000-000000000001', true);

-- ---------------------------------------------------------------------
-- account_mask travels through to the banks payload.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT b->>'account_mask'
     FROM jsonb_array_elements(
       public.get_deposit_match_report(
         '11111111-5000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
       )->'banks'
     ) b
    WHERE b->>'connected_bank_id' = '22222222-5000-0000-0000-000000000001'),
  '9510',
  'the banks payload carries account_mask for the masked bank'
);

-- ---------------------------------------------------------------------
-- Threshold: 3 matching rows is enough for a suggestion.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT (b->'suggested_sources'->>'toast')::int
     FROM jsonb_array_elements(
       public.get_deposit_match_report(
         '11111111-5000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
       )->'banks'
     ) b
    WHERE b->>'connected_bank_id' = '22222222-5000-0000-0000-000000000001'),
  3,
  '3 TST* rows give suggested_sources.toast = 3'
);

-- ---------------------------------------------------------------------
-- Threshold: 2 matching rows is not enough — no toast key at all.
-- ---------------------------------------------------------------------
SELECT ok(
  NOT (
    (SELECT b->'suggested_sources' ? 'toast'
       FROM jsonb_array_elements(
         public.get_deposit_match_report(
           '11111111-5000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
         )->'banks'
       ) b
      WHERE b->>'connected_bank_id' = '22222222-5000-0000-0000-000000000002')
  ),
  '2 TST* rows fall below the threshold — no toast key in suggested_sources'
);

-- ---------------------------------------------------------------------
-- Dual source: a SHIFT4 descriptor puts both focus and shift4 in the
-- payload, since the two sources share one pattern.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT (b->'suggested_sources'->>'focus')::int
     FROM jsonb_array_elements(
       public.get_deposit_match_report(
         '11111111-5000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
       )->'banks'
     ) b
    WHERE b->>'connected_bank_id' = '22222222-5000-0000-0000-000000000003'),
  3,
  '3 SHIFT4 rows give suggested_sources.focus = 3'
);

SELECT is(
  (SELECT (b->'suggested_sources'->>'shift4')::int
     FROM jsonb_array_elements(
       public.get_deposit_match_report(
         '11111111-5000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
       )->'banks'
     ) b
    WHERE b->>'connected_bank_id' = '22222222-5000-0000-0000-000000000003'),
  3,
  '3 SHIFT4 rows give suggested_sources.shift4 = 3'
);

-- ---------------------------------------------------------------------
-- A negative-amount row and an is_transfer row do not count toward the
-- threshold — only 1 of the 3 TST* rows on Bank 4 is a real candidate.
-- ---------------------------------------------------------------------
SELECT ok(
  NOT (
    (SELECT b->'suggested_sources' ? 'toast'
       FROM jsonb_array_elements(
         public.get_deposit_match_report(
           '11111111-5000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
         )->'banks'
       ) b
      WHERE b->>'connected_bank_id' = '22222222-5000-0000-0000-000000000004')
  ),
  'a negative-amount row and a transfer row do not count — no toast key in suggested_sources'
);

-- ---------------------------------------------------------------------
-- A bank that is not 'connected' gets no suggestion, even with 3+ hits --
-- the refresh engine can never match against it.
-- ---------------------------------------------------------------------
SELECT ok(
  NOT (
    (SELECT b->'suggested_sources' ? 'toast'
       FROM jsonb_array_elements(
         public.get_deposit_match_report(
           '11111111-5000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
         )->'banks'
       ) b
      WHERE b->>'connected_bank_id' = '22222222-5000-0000-0000-000000000005')
  ),
  'a requires_reauth bank gets no suggestion, even with 3 TST* rows'
);

-- ---------------------------------------------------------------------
-- The scan's upper bound includes today: 3 TST* rows timestamped with
-- now() still clear the threshold, so suggested_sources.toast = 3.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT (b->'suggested_sources'->>'toast')::int
     FROM jsonb_array_elements(
       public.get_deposit_match_report(
         '11111111-5000-0000-0000-000000000001', '2020-01-01', '2026-12-31'
       )->'banks'
     ) b
    WHERE b->>'connected_bank_id' = '22222222-5000-0000-0000-000000000006'),
  3,
  '3 TST* rows timestamped today (now()) give suggested_sources.toast = 3'
);

-- ---------------------------------------------------------------------
-- The replaced function keeps SECURITY DEFINER and its pinned search_path.
-- ---------------------------------------------------------------------
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'get_deposit_match_report'),
  'get_deposit_match_report is SECURITY DEFINER (prosecdef = true)'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_deposit_match_report'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ),
  'get_deposit_match_report has SET search_path = public, pg_temp'
);

SELECT * FROM finish();
ROLLBACK;
