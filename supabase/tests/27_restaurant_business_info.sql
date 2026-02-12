BEGIN;
-- Disable RLS so tests exercise CHECK constraints directly
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

SELECT plan(16);

-- Test all 10 new columns exist with correct types
SELECT has_column('public', 'restaurants', 'legal_name', 'legal_name column exists');
SELECT col_type_is('public', 'restaurants', 'legal_name', 'text', 'legal_name is text');

SELECT has_column('public', 'restaurants', 'address_line1', 'address_line1 column exists');
SELECT has_column('public', 'restaurants', 'address_line2', 'address_line2 column exists');
SELECT has_column('public', 'restaurants', 'city', 'city column exists');
SELECT has_column('public', 'restaurants', 'state', 'state column exists');
SELECT has_column('public', 'restaurants', 'zip', 'zip column exists');
SELECT has_column('public', 'restaurants', 'country', 'country column exists');
SELECT has_column('public', 'restaurants', 'business_email', 'business_email column exists');
SELECT has_column('public', 'restaurants', 'ein', 'ein column exists');
SELECT has_column('public', 'restaurants', 'entity_type', 'entity_type column exists');

-- Test country defaults to US
SELECT col_default_is('public', 'restaurants', 'country', 'US'::text, 'country defaults to US');

-- Test valid values are accepted
SELECT lives_ok(
  $$INSERT INTO restaurants (name, entity_type, state) VALUES ('Valid Biz', 'llc', 'NY')$$,
  'valid entity_type and state are accepted'
);

-- Test entity_type constraint rejects invalid values
SELECT throws_ok(
  $$INSERT INTO restaurants (name, entity_type) VALUES ('Test', 'invalid_type')$$,
  '23514',
  NULL,
  'entity_type constraint rejects invalid values'
);

-- Test state constraint rejects > 2 chars
SELECT throws_ok(
  $$INSERT INTO restaurants (name, state) VALUES ('Test', 'CAL')$$,
  '23514',
  NULL,
  'state constraint rejects more than 2 characters'
);

SELECT * FROM finish();
ROLLBACK;
