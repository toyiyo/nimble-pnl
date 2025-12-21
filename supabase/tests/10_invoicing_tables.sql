-- Tests for invoicing tables and RLS policies
BEGIN;
SELECT plan(27);

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
    $$ SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices' AND rowsecurity = true $$,
    'RLS should be enabled on invoices table'
);

SELECT isnt_empty(
    $$ SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoice_line_items' AND rowsecurity = true $$,
    'RLS should be enabled on invoice_line_items table'
);

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

SELECT * FROM finish();
ROLLBACK;
