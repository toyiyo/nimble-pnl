-- File: supabase/tests/68_min_bank_txn_entry_day.sql
-- Description: pins min_bank_txn_entry_day. The minimum ranges over the
-- derived entry days, not the raw timestamps. An anchor at 00:00Z keeps
-- its UTC day. A later instant can land one local day earlier.

BEGIN;
SELECT plan(4);

SET LOCAL role TO postgres;

-- The result must not depend on the session TimeZone. Pin an
-- east-of-UTC zone so a hidden session cast fails these tests loudly.
SET LOCAL timezone TO 'Asia/Tokyo';

-- Fixtures -----------------------------------------------------------------
INSERT INTO restaurants (id, name, timezone) VALUES
  ('00000000-0000-0000-0000-000000006810'::uuid, 'MinDay Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000006815'::uuid, '00000000-0000-0000-0000-000000006810'::uuid, 'fa_test_minday_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

-- The anchor holds the minimum RAW timestamp. The instant maps to the
-- earlier LOCAL day (03:30Z on 2026-02-01 = 21:30 CST on 2026-01-31).
INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES
  ('00000000-0000-0000-0000-000000006851'::uuid, '00000000-0000-0000-0000-000000006810'::uuid,
   '00000000-0000-0000-0000-000000006815'::uuid, 'txn-minday-anchor-1',
   TIMESTAMPTZ '2026-02-01 00:00:00+00', -10.00, 'Date anchor', 'posted', true, false, false),
  ('00000000-0000-0000-0000-000000006852'::uuid, '00000000-0000-0000-0000-000000006810'::uuid,
   '00000000-0000-0000-0000-000000006815'::uuid, 'txn-minday-instant-1',
   TIMESTAMPTZ '2026-02-01 03:30:00+00', -20.00, 'Evening instant', 'posted', true, false, false)
ON CONFLICT (id) DO NOTHING;

-- Assertions -----------------------------------------------------------------
SELECT is(
  min_bank_txn_entry_day('00000000-0000-0000-0000-000000006810'::uuid),
  DATE '2026-01-31',
  'the minimum ranges over derived entry days, not raw timestamps');

DELETE FROM bank_transactions
  WHERE id = '00000000-0000-0000-0000-000000006852'::uuid;

SELECT is(
  min_bank_txn_entry_day('00000000-0000-0000-0000-000000006810'::uuid),
  DATE '2026-02-01',
  'an anchor-only restaurant keeps the anchor day');

SELECT is(
  min_bank_txn_entry_day('00000000-0000-0000-0000-000000006999'::uuid),
  NULL::date,
  'a restaurant without transactions returns NULL');

SELECT ok(
  has_function_privilege('authenticated', 'min_bank_txn_entry_day(uuid)', 'EXECUTE'),
  'authenticated can EXECUTE min_bank_txn_entry_day');

SELECT * FROM finish();
ROLLBACK;
