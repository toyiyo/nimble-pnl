-- ============================================================================
-- Tests for role-percentage tip guarantees schema
--
-- Verifies the schema objects created by the migration:
--   20260731000000_tip_role_percentages.sql
--
-- Tests:
--   1. role_percentages column exists on tip_pool_settings
--   2. role_percentages defaults to an empty object
--   3. applied_rule column exists on tip_split_items
--   4. applied_rule is nullable
--   5. role_percentages rejects a non-object value
--   6. role_percentages rejects an unknown mode
--   7. role_percentages rejects a percentage above 100
--   8. role_percentages rejects a negative percentage
--   9. role_percentages rejects an entry missing a required key
--  10. role_percentages accepts a well-formed rule map
--  11. role_percentages rejects a non-numeric percentage
-- ============================================================================

BEGIN;
SELECT plan(11);

SET LOCAL role TO postgres;

INSERT INTO restaurants (id, name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Role Percentage Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Test 1: role_percentages column exists
-- ============================================================================

SELECT has_column(
  'public',
  'tip_pool_settings',
  'role_percentages',
  'tip_pool_settings should have a role_percentages column'
);

-- ============================================================================
-- Test 2: role_percentages defaults to an empty object
-- ============================================================================

INSERT INTO tip_pool_settings (id, restaurant_id, active) VALUES
  ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001', false);

SELECT is(
  (SELECT role_percentages FROM tip_pool_settings WHERE id = 'c0000000-0000-0000-0000-000000000010'),
  '{}'::jsonb,
  'role_percentages should default to an empty object'
);

-- ============================================================================
-- Test 3: applied_rule column exists on tip_split_items
-- ============================================================================

SELECT has_column(
  'public',
  'tip_split_items',
  'applied_rule',
  'tip_split_items should have an applied_rule column'
);

-- ============================================================================
-- Test 4: applied_rule is nullable
-- ============================================================================

SELECT col_is_null(
  'public',
  'tip_split_items',
  'applied_rule',
  'applied_rule should be nullable so existing rows stay valid'
);

-- ============================================================================
-- Test 5: role_percentages rejects a non-object value
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '[]'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject a JSON array'
);

-- ============================================================================
-- Test 6: role_percentages rejects an unknown mode
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '{"Manager": {"mode": "bogus", "percentage": 10}}'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject a mode outside at_least/exactly'
);

-- ============================================================================
-- Test 7: role_percentages rejects a percentage above 100
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '{"Manager": {"mode": "at_least", "percentage": 101}}'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject a percentage above 100'
);

-- ============================================================================
-- Test 8: role_percentages rejects a negative percentage
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '{"Manager": {"mode": "at_least", "percentage": -5}}'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject a negative percentage'
);

-- ============================================================================
-- Test 9: role_percentages rejects an entry missing a required key
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '{"Manager": {"percentage": 10}}'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject an entry with no mode'
);

-- ============================================================================
-- Test 10: role_percentages accepts a well-formed rule map
-- ============================================================================

-- active: true here (not false) because test 2 already occupies the
-- (restaurant_id, active=false) slot protected by unique_active_settings.
SELECT lives_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES (
      'c0000000-0000-0000-0000-000000000001',
      '{"Manager": {"mode": "at_least", "percentage": 10}, "Chef": {"mode": "exactly", "percentage": 15.5}}'::jsonb,
      true
    )
  $$,
  'role_percentages should accept a well-formed rule map'
);

-- ============================================================================
-- Test 11: role_percentages rejects a non-numeric percentage
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '{"Manager": {"mode": "at_least", "percentage": "abc"}}'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject a non-numeric percentage'
);

SELECT * FROM finish();
ROLLBACK;
