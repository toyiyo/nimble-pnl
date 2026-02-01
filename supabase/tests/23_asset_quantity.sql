-- File: supabase/tests/23_asset_quantity.sql
-- Description: Tests for asset quantity support (quantity, unit_cost, sync trigger, split_asset function)

BEGIN;
SELECT plan(39);

-- Setup: Disable RLS and prepare test data
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

ALTER TABLE assets DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

-- Create test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000009001', 'Asset Quantity Test Restaurant', '123 Test St', '555-0001')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TEST CATEGORY 1: Column Existence and Types
-- ============================================================

-- Test 1: quantity column exists
SELECT has_column(
  'public',
  'assets',
  'quantity',
  'assets should have quantity column'
);

-- Test 2: unit_cost column exists
SELECT has_column(
  'public',
  'assets',
  'unit_cost',
  'assets should have unit_cost column'
);

-- Test 3: quantity is INTEGER type
SELECT col_type_is(
  'public',
  'assets',
  'quantity',
  'integer',
  'quantity should be INTEGER type'
);

-- Test 4: unit_cost is NUMERIC type
SELECT col_type_is(
  'public',
  'assets',
  'unit_cost',
  'numeric(15,2)',
  'unit_cost should be NUMERIC(15,2) type'
);

-- Test 5: quantity has default value of 1
SELECT col_default_is(
  'public',
  'assets',
  'quantity',
  '1',
  'quantity should default to 1'
);

-- ============================================================
-- TEST CATEGORY 2: Constraints
-- ============================================================

-- Test 6: Check quantity positive constraint by verifying check constraint violation
SELECT throws_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      quantity, unit_cost, purchase_cost, salvage_value, useful_life_months, status
    ) VALUES (
      '00000000-0000-0000-0000-000000009800',
      '00000000-0000-0000-0000-000000009001',
      'Negative Quantity Asset',
      'Equipment',
      '2024-01-01',
      -1, -- Invalid: quantity must be >= 1
      1000,
      1000,
      0,
      60,
      'active'
    )
  $$,
  '23514', -- check_violation
  NULL,
  'Should reject negative quantity (constraint check)'
);

-- Test 7: Check unit_cost positive constraint by verifying check constraint violation
SELECT throws_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      quantity, unit_cost, purchase_cost, salvage_value, useful_life_months, status
    ) VALUES (
      '00000000-0000-0000-0000-000000009801',
      '00000000-0000-0000-0000-000000009001',
      'Negative Unit Cost Asset',
      'Equipment',
      '2024-01-01',
      1,
      -100, -- Invalid: unit_cost must be > 0
      -100,
      0,
      60,
      'active'
    )
  $$,
  '23514', -- check_violation
  NULL,
  'Should reject negative unit_cost (constraint check)'
);

-- Test 8: Quantity must be >= 1 (should reject 0)
SELECT throws_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      quantity, unit_cost, purchase_cost, salvage_value, useful_life_months, status
    ) VALUES (
      '00000000-0000-0000-0000-000000009901',
      '00000000-0000-0000-0000-000000009001',
      'Invalid Quantity Asset',
      'Equipment',
      '2024-01-01',
      0, -- Invalid: quantity must be >= 1
      1000,
      0,
      0,
      60,
      'active'
    )
  $$,
  '23514', -- check_violation
  NULL,
  'Should reject quantity of 0'
);

-- Test 9: Unit cost must be > 0 (should reject 0)
SELECT throws_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      quantity, unit_cost, purchase_cost, salvage_value, useful_life_months, status
    ) VALUES (
      '00000000-0000-0000-0000-000000009902',
      '00000000-0000-0000-0000-000000009001',
      'Invalid Unit Cost Asset',
      'Equipment',
      '2024-01-01',
      1,
      0, -- Invalid: unit_cost must be > 0
      0,
      0,
      60,
      'active'
    )
  $$,
  '23514', -- check_violation
  NULL,
  'Should reject unit_cost of 0'
);

-- ============================================================
-- TEST CATEGORY 3: Trigger - sync_asset_purchase_cost
-- ============================================================

-- Test 10: sync_asset_purchase_cost function exists
SELECT has_function(
  'public',
  'sync_asset_purchase_cost',
  'sync_asset_purchase_cost function should exist'
);

-- Test 11: sync_asset_purchase_cost returns trigger
SELECT function_returns(
  'public',
  'sync_asset_purchase_cost',
  'trigger',
  'sync_asset_purchase_cost should return trigger'
);

-- Test 12: Trigger exists on assets table (check via information_schema)
SELECT ok(
  (SELECT COUNT(*) > 0 FROM information_schema.triggers
   WHERE trigger_name = 'sync_asset_purchase_cost_trigger'
   AND event_object_table = 'assets'),
  'sync_asset_purchase_cost_trigger should exist on assets table'
);

-- Test 13: Insert with quantity=1 sets purchase_cost correctly
SELECT lives_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      quantity, unit_cost, purchase_cost, salvage_value, useful_life_months, status
    ) VALUES (
      '00000000-0000-0000-0000-000000009010',
      '00000000-0000-0000-0000-000000009001',
      'Single Unit Asset',
      'Equipment',
      '2024-01-01',
      1,
      1000,
      1000, -- Will be synced by trigger
      100,
      60,
      'active'
    )
  $$,
  'Should insert single unit asset'
);

SELECT is(
  (SELECT purchase_cost FROM assets WHERE id = '00000000-0000-0000-0000-000000009010'),
  1000::numeric,
  'purchase_cost should equal unit_cost for quantity=1'
);

-- Test 14: Insert with quantity>1 sets purchase_cost as unit_cost * quantity
SELECT lives_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      quantity, unit_cost, purchase_cost, salvage_value, useful_life_months, status
    ) VALUES (
      '00000000-0000-0000-0000-000000009011',
      '00000000-0000-0000-0000-000000009001',
      'Multi Unit Refrigerators',
      'Kitchen Equipment',
      '2024-01-01',
      2,
      20000,
      0, -- Will be synced to 40000 by trigger
      4000,
      84,
      'active'
    )
  $$,
  'Should insert multi-unit asset'
);

SELECT is(
  (SELECT purchase_cost FROM assets WHERE id = '00000000-0000-0000-0000-000000009011'),
  40000::numeric,
  'purchase_cost should be unit_cost * quantity (2 × 20000 = 40000)'
);

-- Test 15: Update quantity recalculates purchase_cost
UPDATE assets SET quantity = 3 WHERE id = '00000000-0000-0000-0000-000000009011';

SELECT is(
  (SELECT purchase_cost FROM assets WHERE id = '00000000-0000-0000-0000-000000009011'),
  60000::numeric,
  'purchase_cost should update when quantity changes (3 × 20000 = 60000)'
);

-- Test 16: Update unit_cost recalculates purchase_cost
UPDATE assets SET unit_cost = 25000 WHERE id = '00000000-0000-0000-0000-000000009011';

SELECT is(
  (SELECT purchase_cost FROM assets WHERE id = '00000000-0000-0000-0000-000000009011'),
  75000::numeric,
  'purchase_cost should update when unit_cost changes (3 × 25000 = 75000)'
);

-- Reset for further tests
UPDATE assets SET quantity = 2, unit_cost = 20000 WHERE id = '00000000-0000-0000-0000-000000009011';

-- ============================================================
-- TEST CATEGORY 4: Salvage Constraint with Quantity
-- ============================================================

-- Test 17: Salvage value must be less than total cost
SELECT throws_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      quantity, unit_cost, purchase_cost, salvage_value, useful_life_months, status
    ) VALUES (
      '00000000-0000-0000-0000-000000009903',
      '00000000-0000-0000-0000-000000009001',
      'Invalid Salvage Asset',
      'Equipment',
      '2024-01-01',
      2,
      1000, -- total = 2000
      2000,
      2500, -- Invalid: salvage (2500) >= total cost (2000)
      60,
      'active'
    )
  $$,
  '23514', -- check_violation
  NULL,
  'Should reject salvage_value >= total purchase_cost'
);

-- Test 18: Valid salvage value less than total cost
SELECT lives_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      quantity, unit_cost, purchase_cost, salvage_value, useful_life_months, status
    ) VALUES (
      '00000000-0000-0000-0000-000000009012',
      '00000000-0000-0000-0000-000000009001',
      'Valid Salvage Asset',
      'Equipment',
      '2024-01-01',
      5,
      2000, -- total = 10000
      10000,
      500, -- Valid: salvage (500) < total cost (10000)
      60,
      'active'
    )
  $$,
  'Should accept salvage_value < total purchase_cost'
);

-- ============================================================
-- TEST CATEGORY 5: split_asset Function
-- ============================================================

-- Test 19: split_asset function exists
SELECT has_function(
  'public',
  'split_asset',
  ARRAY['uuid', 'integer'],
  'split_asset function should exist with correct signature'
);

-- Test 20: split_asset returns UUID
SELECT function_returns(
  'public',
  'split_asset',
  ARRAY['uuid', 'integer'],
  'uuid',
  'split_asset should return UUID'
);

-- Insert test asset for split tests
INSERT INTO assets (
  id, restaurant_id, name, category, purchase_date,
  quantity, unit_cost, purchase_cost, salvage_value, useful_life_months,
  accumulated_depreciation, status
) VALUES (
  '00000000-0000-0000-0000-000000009020',
  '00000000-0000-0000-0000-000000009001',
  'Office Chairs',
  'Furniture',
  '2024-01-01',
  5,
  200, -- total = 1000
  1000,
  100, -- total salvage for all 5
  60,
  200, -- accumulated depreciation for all 5
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  quantity = 5,
  unit_cost = 200,
  purchase_cost = 1000,
  salvage_value = 100,
  accumulated_depreciation = 200,
  status = 'active';

-- Test 21: Split asset reduces original quantity
DO $$
DECLARE
  v_new_id UUID;
BEGIN
  SELECT split_asset('00000000-0000-0000-0000-000000009020', 2) INTO v_new_id;
  -- Store the new ID for later tests
  PERFORM set_config('test.split_asset_id', v_new_id::text, true);
END;
$$;

SELECT is(
  (SELECT quantity FROM assets WHERE id = '00000000-0000-0000-0000-000000009020'),
  3,
  'Original asset should have reduced quantity (5 - 2 = 3)'
);

-- Test 22: Split asset creates new record with correct quantity
SELECT is(
  (SELECT quantity FROM assets WHERE id = current_setting('test.split_asset_id')::uuid),
  2,
  'New split asset should have requested quantity (2)'
);

-- Test 23: Split asset has correct unit_cost
SELECT is(
  (SELECT unit_cost FROM assets WHERE id = current_setting('test.split_asset_id')::uuid),
  200::numeric,
  'New split asset should have same unit_cost as original'
);

-- Test 24: Split asset has correct purchase_cost (synced by trigger)
SELECT is(
  (SELECT purchase_cost FROM assets WHERE id = current_setting('test.split_asset_id')::uuid),
  400::numeric,
  'New split asset should have purchase_cost = unit_cost × quantity (200 × 2 = 400)'
);

-- Test 25: Split asset has proportional accumulated depreciation
SELECT ok(
  (SELECT accumulated_depreciation BETWEEN 79 AND 81 FROM assets WHERE id = current_setting('test.split_asset_id')::uuid),
  'New split asset should have proportional depreciation (~80 for 2/5 of 200)'
);

-- Test 26: Original asset has reduced accumulated depreciation
SELECT ok(
  (SELECT accumulated_depreciation BETWEEN 119 AND 121 FROM assets WHERE id = '00000000-0000-0000-0000-000000009020'),
  'Original asset should have reduced depreciation (~120 for 3/5 of 200)'
);

-- Test 27: Split asset has proportional salvage value
SELECT ok(
  (SELECT salvage_value BETWEEN 39 AND 41 FROM assets WHERE id = current_setting('test.split_asset_id')::uuid),
  'New split asset should have proportional salvage (~40 for 2/5 of 100)'
);

-- Test 28: Split asset has name suffix
SELECT ok(
  (SELECT name LIKE '%split%' FROM assets WHERE id = current_setting('test.split_asset_id')::uuid),
  'New split asset name should contain "split"'
);

-- Test 29: Cannot split disposed asset
UPDATE assets SET status = 'disposed', disposal_date = '2024-12-31' WHERE id = '00000000-0000-0000-0000-000000009020';

SELECT throws_ok(
  $$
    SELECT split_asset('00000000-0000-0000-0000-000000009020', 1)
  $$,
  'P0001', -- raise_exception
  'Cannot split a disposed asset',
  'Should reject splitting disposed asset'
);

-- Reset status for further tests
UPDATE assets SET status = 'active', disposal_date = NULL WHERE id = '00000000-0000-0000-0000-000000009020';

-- Test 30: Cannot split more than available quantity
SELECT throws_ok(
  $$
    SELECT split_asset('00000000-0000-0000-0000-000000009020', 3)
  $$,
  'P0001', -- raise_exception
  NULL,
  'Should reject split quantity >= total quantity'
);

-- Test 31: Cannot split with quantity < 1
SELECT throws_ok(
  $$
    SELECT split_asset('00000000-0000-0000-0000-000000009020', 0)
  $$,
  'P0001', -- raise_exception
  'Split quantity must be at least 1',
  'Should reject split quantity of 0'
);

-- Test 32: Cannot split non-existent asset
SELECT throws_ok(
  $$
    SELECT split_asset('00000000-0000-0000-0000-000000000000', 1)
  $$,
  'P0001', -- raise_exception
  'Asset not found',
  'Should reject non-existent asset'
);

-- ============================================================
-- TEST CATEGORY 6: Backward Compatibility
-- ============================================================

-- Test 33: Existing assets without explicit quantity work (defaults to 1)
SELECT lives_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      unit_cost, purchase_cost, salvage_value, useful_life_months, status
      -- Note: quantity not specified, should default to 1
    ) VALUES (
      '00000000-0000-0000-0000-000000009030',
      '00000000-0000-0000-0000-000000009001',
      'Default Quantity Asset',
      'Equipment',
      '2024-01-01',
      500,
      500,
      50,
      60,
      'active'
    )
  $$,
  'Should insert asset without explicit quantity'
);

SELECT is(
  (SELECT quantity FROM assets WHERE id = '00000000-0000-0000-0000-000000009030'),
  1,
  'Asset without explicit quantity should have quantity=1'
);

-- Test 34: Index exists for quantity queries (check via information_schema)
SELECT ok(
  (SELECT COUNT(*) > 0 FROM pg_indexes WHERE tablename = 'assets' AND indexname = 'idx_assets_quantity'),
  'Should have index idx_assets_quantity for quantity queries'
);

-- Test 35: Large quantity values work correctly
SELECT lives_ok(
  $$
    INSERT INTO assets (
      id, restaurant_id, name, category, purchase_date,
      quantity, unit_cost, purchase_cost, salvage_value, useful_life_months, status
    ) VALUES (
      '00000000-0000-0000-0000-000000009031',
      '00000000-0000-0000-0000-000000009001',
      'Bulk Plates',
      'Kitchen Equipment',
      '2024-01-01',
      500,
      10,
      5000, -- 500 × 10
      100,
      60,
      'active'
    )
  $$,
  'Should handle large quantity values (500 units)'
);

SELECT is(
  (SELECT purchase_cost FROM assets WHERE id = '00000000-0000-0000-0000-000000009031'),
  5000::numeric,
  'Large quantity should calculate correct purchase_cost (500 × 10 = 5000)'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
