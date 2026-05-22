-- pgTAP tests for the same-restaurant guard on pending_outflows.category_id.
--
-- Pinning: writing a pending_outflows row whose category_id resolves to a
-- chart_of_accounts row in a different restaurant must fail with SQLSTATE
-- 23503 (foreign_key_violation), both on INSERT and on UPDATE.

BEGIN;
SELECT plan(8);

-- Setup: Disable RLS so fixture INSERTs work without auth context.
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_outflows DISABLE ROW LEVEL SECURITY;

-- Fixture: two restaurants, each with its own chart-of-accounts row.
INSERT INTO public.restaurants (id, name)
VALUES
  ('00000000-0000-0000-0000-000000000a01', 'Test Restaurant A'),
  ('00000000-0000-0000-0000-000000000a02', 'Test Restaurant B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chart_of_accounts
  (id, restaurant_id, account_code, account_name, account_type, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000b01',
   '00000000-0000-0000-0000-000000000a01',
   '5100', 'Test Food Costs A', 'cogs', 'debit'),
  ('00000000-0000-0000-0000-000000000b02',
   '00000000-0000-0000-0000-000000000a02',
   '5100', 'Test Food Costs B', 'cogs', 'debit')
ON CONFLICT (id) DO NOTHING;

-- 1. Trigger function exists.
SELECT has_function(
  'public',
  'assert_pending_outflow_category_same_restaurant',
  'trigger function exists'
);

-- 2. Trigger is wired up on pending_outflows.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'pending_outflows_category_same_restaurant'
      AND tgrelid = 'public.pending_outflows'::regclass
  ),
  'trigger is attached to pending_outflows'
);

-- 3. Insert with a same-restaurant category succeeds.
SELECT lives_ok(
  $$
    INSERT INTO public.pending_outflows (
      restaurant_id, vendor_name, category_id, payment_method,
      amount, issue_date
    )
    VALUES (
      '00000000-0000-0000-0000-000000000a01',
      'Same-Restaurant Vendor',
      '00000000-0000-0000-0000-000000000b01',
      'check',
      100.00,
      CURRENT_DATE
    );
  $$,
  'insert with same-restaurant category succeeds'
);

-- 4. Insert with a cross-restaurant category fails with 23503.
SELECT throws_ok(
  $$
    INSERT INTO public.pending_outflows (
      restaurant_id, vendor_name, category_id, payment_method,
      amount, issue_date
    )
    VALUES (
      '00000000-0000-0000-0000-000000000a01',
      'Cross-Restaurant Vendor',
      '00000000-0000-0000-0000-000000000b02',
      'check',
      200.00,
      CURRENT_DATE
    );
  $$,
  '23503',
  NULL,
  'cross-restaurant insert raises foreign_key_violation'
);

-- 5. Insert with NULL category_id still works (category is optional).
SELECT lives_ok(
  $$
    INSERT INTO public.pending_outflows (
      restaurant_id, vendor_name, payment_method, amount, issue_date
    )
    VALUES (
      '00000000-0000-0000-0000-000000000a01',
      'Uncategorized Vendor',
      'check',
      300.00,
      CURRENT_DATE
    );
  $$,
  'NULL category_id is still permitted'
);

-- 6. Update from NULL → cross-restaurant category fails with 23503.
SELECT throws_ok(
  $$
    UPDATE public.pending_outflows
       SET category_id = '00000000-0000-0000-0000-000000000b02'
     WHERE vendor_name = 'Uncategorized Vendor'
       AND restaurant_id = '00000000-0000-0000-0000-000000000a01';
  $$,
  '23503',
  NULL,
  'cross-restaurant update raises foreign_key_violation'
);

-- 7. Update to same-restaurant category succeeds.
SELECT lives_ok(
  $$
    UPDATE public.pending_outflows
       SET category_id = '00000000-0000-0000-0000-000000000b01'
     WHERE vendor_name = 'Uncategorized Vendor'
       AND restaurant_id = '00000000-0000-0000-0000-000000000a01';
  $$,
  'same-restaurant update succeeds'
);

-- 8. Partial index on category_id exists (non-null rows).
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'pending_outflows'
      AND indexname = 'idx_pending_outflows_category'
  ),
  'idx_pending_outflows_category index exists'
);

SELECT * FROM finish();
ROLLBACK;
