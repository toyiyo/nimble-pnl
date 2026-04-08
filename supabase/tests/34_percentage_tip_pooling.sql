-- ============================================================================
-- Tests for Percentage-Based Tip Pooling Schema
--
-- Verifies the schema objects created by the migration:
--   20260221000000_percentage_tip_pooling.sql
--
-- Tests:
--   1. pooling_model column exists on tip_pool_settings
--   2. pooling_model rejects invalid values
--   3. tip_contribution_pools table exists
--   4. idx_tip_server_earnings_split_employee unique index exists
--   5. idx_tip_pool_allocations_split_pool unique index exists
--   6. contribution_percentage rejects 0 or negative values
--   7. share_method on tip_contribution_pools rejects invalid values
-- ============================================================================

BEGIN;
SELECT plan(7);

-- Run as postgres to bypass RLS for test setup
SET LOCAL role TO postgres;

-- Setup: create prerequisite data so CHECK constraints fire (not FK violations)
INSERT INTO restaurants (id, name) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Percentage Tips Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tip_pool_settings (id, restaurant_id, pooling_model, active) VALUES
  ('b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000001', 'percentage_contribution', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tip_splits (id, restaurant_id, split_date, total_amount, status) VALUES
  ('b0000000-0000-0000-0000-000000000100', 'b0000000-0000-0000-0000-000000000001', '2026-02-20', 50000, 'draft')
ON CONFLICT (id) DO NOTHING;

-- Create a test auth user and employee for tip_server_earnings FK
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('b0000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pct_tip_test@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000060', 'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000050', 'Pct Tip Test Employee', 'pct_tip_test@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- ============================================================================
-- Test 1: pooling_model column exists on tip_pool_settings
-- ============================================================================

SELECT has_column(
  'public',
  'tip_pool_settings',
  'pooling_model',
  'tip_pool_settings should have a pooling_model column'
);

-- ============================================================================
-- Test 2: pooling_model rejects invalid values (CHECK constraint)
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, pooling_model, active)
    VALUES ('b0000000-0000-0000-0000-000000000001', 'invalid', false)
  $$,
  '23514',
  NULL,
  'pooling_model should reject invalid values (only full_pool and percentage_contribution allowed)'
);

-- ============================================================================
-- Test 3: tip_contribution_pools table exists
-- ============================================================================

SELECT has_table(
  'public',
  'tip_contribution_pools',
  'tip_contribution_pools table should exist'
);

-- ============================================================================
-- Test 4: idx_tip_server_earnings_split_employee unique index exists
-- ============================================================================

SELECT has_index(
  'public',
  'tip_server_earnings',
  'idx_tip_server_earnings_split_employee',
  'tip_server_earnings should have unique index on (tip_split_id, employee_id)'
);

-- ============================================================================
-- Test 5: idx_tip_pool_allocations_split_pool unique index exists
-- ============================================================================

SELECT has_index(
  'public',
  'tip_pool_allocations',
  'idx_tip_pool_allocations_split_pool',
  'tip_pool_allocations should have unique index on (tip_split_id, pool_id)'
);

-- ============================================================================
-- Test 6: contribution_percentage rejects 0 or negative values (CHECK constraint)
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_contribution_pools (restaurant_id, settings_id, name, contribution_percentage, share_method)
    VALUES (
      'b0000000-0000-0000-0000-000000000001',
      'b0000000-0000-0000-0000-000000000010',
      'Invalid Zero Pool',
      0,
      'hours'
    )
  $$,
  '23514',
  NULL,
  'contribution_percentage should reject 0 (must be > 0)'
);

-- ============================================================================
-- Test 7: share_method on tip_contribution_pools rejects invalid values
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_contribution_pools (restaurant_id, settings_id, name, contribution_percentage, share_method)
    VALUES (
      'b0000000-0000-0000-0000-000000000001',
      'b0000000-0000-0000-0000-000000000010',
      'Invalid Method Pool',
      5.00,
      'invalid_method'
    )
  $$,
  '23514',
  NULL,
  'share_method should reject invalid values (only hours, role, even allowed)'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
SELECT * FROM finish();
ROLLBACK;
