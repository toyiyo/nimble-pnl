-- ============================================================================
-- Tests for restaurant_financial_settings table
--
-- Verifies table structure, constraints, defaults, and RLS policies for the
-- per-restaurant COGS calculation preference table.
--
-- Migration: 20260303120000_create_restaurant_financial_settings.sql
-- ============================================================================

BEGIN;
SELECT plan(15);

-- ============================================================================
-- TEST CATEGORY 1: Table and Column Structure (Tests 1-6)
-- ============================================================================

-- Test 1: Table exists
SELECT has_table('public', 'restaurant_financial_settings', 'restaurant_financial_settings table should exist');

-- Test 2: id column
SELECT has_column('public', 'restaurant_financial_settings', 'id', 'should have id column');

-- Test 3: restaurant_id column
SELECT has_column('public', 'restaurant_financial_settings', 'restaurant_id', 'should have restaurant_id column');

-- Test 4: cogs_calculation_method column
SELECT has_column('public', 'restaurant_financial_settings', 'cogs_calculation_method', 'should have cogs_calculation_method column');

-- Test 5: created_at column
SELECT has_column('public', 'restaurant_financial_settings', 'created_at', 'should have created_at column');

-- Test 6: updated_at column
SELECT has_column('public', 'restaurant_financial_settings', 'updated_at', 'should have updated_at column');

-- ============================================================================
-- TEST CATEGORY 2: Default Value, CHECK, and UNIQUE Constraints (Tests 7-9)
-- ============================================================================

-- Setup: Disable RLS for direct constraint testing
SET LOCAL role TO postgres;
ALTER TABLE restaurant_financial_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Create test restaurants
INSERT INTO restaurants (id, name) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'Financial Settings Test Restaurant 1'),
  ('f0000000-0000-0000-0000-000000000002', 'Financial Settings Test Restaurant 2'),
  ('f0000000-0000-0000-0000-000000000003', 'Financial Settings Test Restaurant 3')
ON CONFLICT (id) DO NOTHING;

-- Test 7: Default value for cogs_calculation_method is 'inventory'
INSERT INTO restaurant_financial_settings (id, restaurant_id)
VALUES ('f0000000-0000-0000-0000-100000000001', 'f0000000-0000-0000-0000-000000000001');

SELECT is(
  (SELECT cogs_calculation_method FROM restaurant_financial_settings
   WHERE id = 'f0000000-0000-0000-0000-100000000001'),
  'inventory',
  'Default cogs_calculation_method should be inventory'
);

-- Test 8: CHECK constraint rejects invalid values
SELECT throws_ok(
  $$INSERT INTO restaurant_financial_settings (restaurant_id, cogs_calculation_method)
    VALUES ('f0000000-0000-0000-0000-000000000002', 'invalid_method')$$,
  '23514',
  NULL,
  'CHECK constraint should reject invalid cogs_calculation_method values'
);

-- Test 9: UNIQUE constraint on restaurant_id prevents duplicates
SELECT throws_ok(
  $$INSERT INTO restaurant_financial_settings (restaurant_id)
    VALUES ('f0000000-0000-0000-0000-000000000001')$$,
  '23505',
  NULL,
  'UNIQUE constraint should prevent duplicate restaurant_id'
);

-- ============================================================================
-- TEST CATEGORY 3: RLS Policies (Tests 10-15)
-- ============================================================================

-- Create test auth users (as postgres)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('f0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finsettings_owner@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('f0000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finsettings_staff@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('f0000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finsettings_nonmember@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Create user_restaurants memberships:
-- User 10 = owner of restaurants 1 and 2
-- User 20 = staff of restaurant 1
-- User 30 = no memberships (non-member)
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('f0000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000001', 'owner'),
  ('f0000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000002', 'owner'),
  ('f0000000-0000-0000-0000-000000000020', 'f0000000-0000-0000-0000-000000000001', 'staff')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- Insert settings for restaurant 3 (no members among our test users)
INSERT INTO restaurant_financial_settings (id, restaurant_id, cogs_calculation_method)
VALUES ('f0000000-0000-0000-0000-100000000003', 'f0000000-0000-0000-0000-000000000003', 'financials');

-- Re-enable RLS for policy testing
ALTER TABLE restaurant_financial_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Test 10: Restaurant member (owner) CAN SELECT their own settings
-- ============================================================================

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "f0000000-0000-0000-0000-000000000010", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*) FROM restaurant_financial_settings
   WHERE restaurant_id = 'f0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'Owner should be able to SELECT their restaurant financial settings'
);

-- ============================================================================
-- Test 11: Restaurant member (staff) CAN SELECT their restaurant settings
-- ============================================================================

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "f0000000-0000-0000-0000-000000000020", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*) FROM restaurant_financial_settings
   WHERE restaurant_id = 'f0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'Staff member should be able to SELECT their restaurant financial settings'
);

-- ============================================================================
-- Test 12: Non-member CANNOT SELECT any restaurant settings
-- ============================================================================

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "f0000000-0000-0000-0000-000000000030", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*) FROM restaurant_financial_settings),
  0::bigint,
  'Non-member should NOT be able to SELECT any restaurant financial settings'
);

-- ============================================================================
-- Test 13: Owner CAN INSERT settings for their restaurant
-- ============================================================================

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "f0000000-0000-0000-0000-000000000010", "role": "authenticated"}';

SELECT lives_ok(
  $$INSERT INTO restaurant_financial_settings (restaurant_id, cogs_calculation_method)
    VALUES ('f0000000-0000-0000-0000-000000000002', 'combined')$$,
  'Owner should be able to INSERT financial settings for their restaurant'
);

-- ============================================================================
-- Test 14: Owner CAN UPDATE settings for their restaurant
-- ============================================================================

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "f0000000-0000-0000-0000-000000000010", "role": "authenticated"}';

SELECT lives_ok(
  $$UPDATE restaurant_financial_settings SET cogs_calculation_method = 'combined'
    WHERE restaurant_id = 'f0000000-0000-0000-0000-000000000001'$$,
  'Owner should be able to UPDATE financial settings for their restaurant'
);

-- ============================================================================
-- Test 15: Staff CANNOT INSERT settings (RLS blocks non-owner/manager writes)
-- ============================================================================

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "f0000000-0000-0000-0000-000000000020", "role": "authenticated"}';

-- Staff has role 'staff' on restaurant 1, which does not match the owner/manager
-- write policy. The INSERT should raise a new row violates RLS policy error.
SELECT throws_ok(
  $$INSERT INTO restaurant_financial_settings (restaurant_id, cogs_calculation_method)
    VALUES ('f0000000-0000-0000-0000-000000000003', 'financials')$$,
  '42501',
  NULL,
  'Staff should NOT be able to INSERT financial settings'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
SELECT * FROM finish();
ROLLBACK;
