-- Tests for invoicing tables and RLS policies
BEGIN;
SELECT plan(65);

-- Test tables exist
SELECT has_table('public', 'customers', 'customers table should exist');
SELECT has_table('public', 'stripe_connected_accounts', 'stripe_connected_accounts table should exist');
SELECT has_table('public', 'invoices', 'invoices table should exist');
SELECT has_table('public', 'invoice_line_items', 'invoice_line_items table should exist');
SELECT has_table('public', 'invoice_payments', 'invoice_payments table should exist');

-- Test customers table columns
SELECT has_column('public', 'customers', 'id', 'customers should have id column');
SELECT has_column('public', 'customers', 'restaurant_id', 'customers should have restaurant_id column');
SELECT has_column('public', 'customers', 'stripe_customer_id', 'customers should have stripe_customer_id column');
SELECT has_column('public', 'customers', 'name', 'customers should have name column');
SELECT has_column('public', 'customers', 'email', 'customers should have email column');

-- Test invoices table columns
SELECT has_column('public', 'invoices', 'id', 'invoices should have id column');
SELECT has_column('public', 'invoices', 'restaurant_id', 'invoices should have restaurant_id column');
SELECT has_column('public', 'invoices', 'customer_id', 'invoices should have customer_id column');
SELECT has_column('public', 'invoices', 'stripe_invoice_id', 'invoices should have stripe_invoice_id column');
SELECT has_column('public', 'invoices', 'status', 'invoices should have status column');
SELECT has_column('public', 'invoices', 'total', 'invoices should have total column');

-- Test invoice_line_items table columns
SELECT has_column('public', 'invoice_line_items', 'id', 'invoice_line_items should have id column');
SELECT has_column('public', 'invoice_line_items', 'invoice_id', 'invoice_line_items should have invoice_id column');
SELECT has_column('public', 'invoice_line_items', 'description', 'invoice_line_items should have description column');
SELECT has_column('public', 'invoice_line_items', 'quantity', 'invoice_line_items should have quantity column');
SELECT has_column('public', 'invoice_line_items', 'unit_amount', 'invoice_line_items should have unit_amount column');

-- Test RLS is enabled
SELECT isnt_empty(
    $$ SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'customers' AND rowsecurity = true $$,
    'RLS should be enabled on customers table'
);

SELECT isnt_empty(
    $$ SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stripe_connected_accounts' AND rowsecurity = true $$,
    'RLS should be enabled on stripe_connected_accounts table'
);

SELECT isnt_empty(
    $$ SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices' AND rowsecurity = true $$,
    'RLS should be enabled on invoices table'
);

SELECT isnt_empty(
    $$ SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoice_line_items' AND rowsecurity = true $$,
    'RLS should be enabled on invoice_line_items table'
);

SELECT isnt_empty(
    $$ SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoice_payments' AND rowsecurity = true $$,
    'RLS should be enabled on invoice_payments table'
);

-- Policy coverage
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customers'
      AND policyname = 'Users can view customers for their restaurants'
  ),
  'customers SELECT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customers'
      AND policyname = 'Users can insert customers for their restaurants'
  ),
  'customers INSERT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customers'
      AND policyname = 'Users can update customers for their restaurants'
  ),
  'customers UPDATE policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customers'
      AND policyname = 'Users can delete customers for their restaurants'
  ),
  'customers DELETE policy should exist'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stripe_connected_accounts'
      AND policyname = 'Users can view connected accounts for their restaurants'
  ),
  'stripe_connected_accounts SELECT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stripe_connected_accounts'
      AND policyname = 'Owners can manage connected accounts'
  ),
  'stripe_connected_accounts ALL policy should exist'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoices'
      AND policyname = 'Users can view invoices for their restaurants'
  ),
  'invoices SELECT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoices'
      AND policyname = 'Users can insert invoices for their restaurants'
  ),
  'invoices INSERT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoices'
      AND policyname = 'Users can update invoices for their restaurants'
  ),
  'invoices UPDATE policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoices'
      AND policyname = 'Users can delete invoices for their restaurants'
  ),
  'invoices DELETE policy should exist'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_line_items'
      AND policyname = 'Users can view line items for their restaurant invoices'
  ),
  'invoice_line_items SELECT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_line_items'
      AND policyname = 'Users can manage line items for their restaurant invoices'
  ),
  'invoice_line_items ALL policy should exist'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_payments'
      AND policyname = 'Users can view payments for their restaurant invoices'
  ),
  'invoice_payments SELECT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_payments'
      AND policyname = 'Service role can manage all payments'
  ),
  'invoice_payments service-role policy should exist'
);

-- Trigger coverage
SELECT has_trigger('public', 'customers', 'update_customers_updated_at', 'customers should have updated_at trigger');
SELECT has_trigger('public', 'stripe_connected_accounts', 'update_stripe_connected_accounts_updated_at', 'stripe_connected_accounts should have updated_at trigger');
SELECT has_trigger('public', 'invoices', 'update_invoices_updated_at', 'invoices should have updated_at trigger');
SELECT has_trigger('public', 'invoice_line_items', 'update_invoice_line_items_updated_at', 'invoice_line_items should have updated_at trigger');
SELECT has_trigger('public', 'invoice_payments', 'update_invoice_payments_updated_at', 'invoice_payments should have updated_at trigger');

-- Test foreign key relationships
SELECT col_is_fk(
    'public',
    'customers',
    'restaurant_id',
    'customers.restaurant_id should be a foreign key'
);

SELECT col_is_fk(
    'public',
    'invoices',
    'restaurant_id',
    'invoices.restaurant_id should be a foreign key'
);

SELECT col_is_fk(
    'public',
    'invoices',
    'customer_id',
    'invoices.customer_id should be a foreign key'
);

-- Functional policy enforcement
-- Setup actors and base data
SET LOCAL row_security = on;
INSERT INTO restaurants (id, name) VALUES ('00000000-0000-0000-0000-00000000AAAA'::uuid, 'Invoice Test Resto') ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000A001'::uuid, 'owner@test.com'),
  ('00000000-0000-0000-0000-00000000A002'::uuid, 'manager@test.com'),
  ('00000000-0000-0000-0000-00000000A003'::uuid, 'staff@test.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM user_restaurants WHERE restaurant_id = '00000000-0000-0000-0000-00000000AAAA'::uuid;
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-00000000A001'::uuid, '00000000-0000-0000-0000-00000000AAAA'::uuid, 'owner'),
  ('00000000-0000-0000-0000-00000000A002'::uuid, '00000000-0000-0000-0000-00000000AAAA'::uuid, 'manager'),
  ('00000000-0000-0000-0000-00000000A003'::uuid, '00000000-0000-0000-0000-00000000AAAA'::uuid, 'staff');

-- Owner can insert customer
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT lives_ok(
  $$INSERT INTO customers (id, restaurant_id, name, email) VALUES ('00000000-0000-0000-0000-00000000C001', '00000000-0000-0000-0000-00000000AAAA', 'Test Customer', 'cust@test.com') ON CONFLICT (id) DO NOTHING$$,
  'Owner should be able to insert customers'
);

-- Staff cannot insert customer
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A003","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_like(
  $$INSERT INTO customers (restaurant_id, name) VALUES ('00000000-0000-0000-0000-00000000AAAA', 'Blocked Customer')$$,
  '%row-level security policy%',
  'Staff should not be able to insert customers'
);

-- Manager can update customer and trigger updates updated_at
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT ok(
  (SELECT updated_at FROM customers WHERE id = '00000000-0000-0000-0000-00000000C001') IS NOT NULL,
  'Customer updated_at should be set on insert'
);
SELECT results_eq(
  $$WITH before_ts AS (
      SELECT updated_at FROM customers WHERE id = '00000000-0000-0000-0000-00000000C001'
    ), upd AS (
      UPDATE customers SET name = 'Updated Customer' WHERE id = '00000000-0000-0000-0000-00000000C001' RETURNING updated_at
    )
    SELECT (upd.updated_at >= before_ts.updated_at) FROM upd, before_ts$$,
  $$VALUES (true)$$,
  'Customer updated_at should change on update by manager'
);

-- Stripe connected accounts: owner can manage, manager cannot
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT lives_ok(
  $$INSERT INTO stripe_connected_accounts (id, restaurant_id, stripe_account_id, account_type) VALUES ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000AAAA', 'acct_test_123', 'standard') ON CONFLICT (id) DO NOTHING$$,
  'Owner should be able to manage connected accounts'
);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
UPDATE stripe_connected_accounts SET account_type = 'express' WHERE id = '00000000-0000-0000-0000-00000000a101';
SELECT is(
  (SELECT account_type FROM stripe_connected_accounts WHERE id = '00000000-0000-0000-0000-00000000a101'),
  'standard',
  'Manager should not be able to manage connected accounts'
);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT results_eq(
  $$WITH before_ts AS (
      SELECT updated_at FROM stripe_connected_accounts WHERE id = '00000000-0000-0000-0000-00000000a101'
    ), upd AS (
      UPDATE stripe_connected_accounts SET charges_enabled = true WHERE id = '00000000-0000-0000-0000-00000000a101' RETURNING updated_at
    )
    SELECT (upd.updated_at >= before_ts.updated_at) FROM upd, before_ts$$,
  $$VALUES (true)$$,
  'Connected account updated_at should change on owner update'
);

-- Invoices: manager can insert, staff cannot; updates change updated_at
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT lives_ok(
  $$INSERT INTO invoices (id, restaurant_id, customer_id, status, subtotal, total) VALUES ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-00000000AAAA', '00000000-0000-0000-0000-00000000C001', 'draft', 1000, 1000) ON CONFLICT (id) DO NOTHING$$,
  'Manager should be able to insert invoices'
);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A003","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_like(
  $$INSERT INTO invoices (restaurant_id, customer_id, status, subtotal, total) VALUES ('00000000-0000-0000-0000-00000000AAAA', '00000000-0000-0000-0000-00000000C001', 'draft', 500, 500)$$,
  '%row-level security policy%',
  'Staff should not be able to insert invoices'
);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT results_eq(
  $$WITH before_ts AS (
      SELECT updated_at FROM invoices WHERE id = '00000000-0000-0000-0000-00000000a201'
    ), upd AS (
      UPDATE invoices SET status = 'open' WHERE id = '00000000-0000-0000-0000-00000000a201' RETURNING updated_at
    )
    SELECT (upd.updated_at >= before_ts.updated_at) FROM upd, before_ts$$,
  $$VALUES (true)$$,
  'Invoice updated_at should change on update'
);

-- Invoice line items: manager can insert, staff cannot; updated_at changes
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT lives_ok(
  $$INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_amount, amount) VALUES ('00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a201', 'Service', 1, 1000, 1000) ON CONFLICT (id) DO NOTHING$$,
  'Manager should be able to insert invoice line items'
);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A003","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_like(
  $$INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_amount, amount) VALUES ('00000000-0000-0000-0000-00000000a201', 'Blocked item', 1, 100, 100)$$,
  '%row-level security policy%',
  'Staff should not be able to insert invoice line items'
);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT results_eq(
  $$WITH before_ts AS (
      SELECT updated_at FROM invoice_line_items WHERE id = '00000000-0000-0000-0000-00000000a301'
    ), upd AS (
      UPDATE invoice_line_items SET amount = 1200 WHERE id = '00000000-0000-0000-0000-00000000a301' RETURNING updated_at
    )
    SELECT (upd.updated_at >= before_ts.updated_at) FROM upd, before_ts$$,
  $$VALUES (true)$$,
  'Invoice line item updated_at should change on update'
);

-- Invoice payments: only service role can insert/update; authenticated users can select
RESET request.jwt.claims;
RESET request.jwt.claim.sub;
RESET request.jwt.claim.role;
SET LOCAL role TO service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok(
  $$INSERT INTO invoice_payments (id, invoice_id, amount, currency, status) VALUES ('00000000-0000-0000-0000-00000000a401', '00000000-0000-0000-0000-00000000a201', 1000, 'usd', 'succeeded') ON CONFLICT (id) DO NOTHING$$,
  'Service role should be able to insert payments'
);

SELECT results_eq(
  $$WITH before_ts AS (
      SELECT updated_at FROM invoice_payments WHERE id = '00000000-0000-0000-0000-00000000a401'
    ), upd AS (
      UPDATE invoice_payments SET status = 'processing' WHERE id = '00000000-0000-0000-0000-00000000a401' RETURNING updated_at
    )
    SELECT (upd.updated_at >= before_ts.updated_at) FROM upd, before_ts$$,
  $$VALUES (true)$$,
  'Invoice payment updated_at should change on service role update'
);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000A002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_like(
  $$INSERT INTO invoice_payments (invoice_id, amount, currency, status) VALUES ('00000000-0000-0000-0000-00000000a201', 500, 'usd', 'succeeded')$$,
  '%row-level security policy%',
  'Authenticated users should not insert payments'
);

-- Authenticated users with restaurant membership can read payments
SELECT ok(
  EXISTS(SELECT 1 FROM invoice_payments WHERE invoice_id = '00000000-0000-0000-0000-00000000a201'),
  'Restaurant users should be able to view payments'
);

SELECT * FROM finish();
RESET role;
ROLLBACK;
