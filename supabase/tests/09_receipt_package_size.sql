-- File: supabase/tests/09_receipt_package_size.sql
-- Description: Tests for receipt line items package size fields (package_type, size_value, size_unit)

BEGIN;
SELECT plan(25); -- Number of tests in file

-- Setup: Disable RLS and create test data
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

ALTER TABLE receipt_line_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_imports DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

-- Apply the new columns (from migration)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='receipt_line_items' AND column_name='package_type') THEN
    ALTER TABLE receipt_line_items ADD COLUMN package_type TEXT;
    ALTER TABLE receipt_line_items ADD COLUMN size_value NUMERIC;
    ALTER TABLE receipt_line_items ADD COLUMN size_unit TEXT;
    
    COMMENT ON COLUMN receipt_line_items.package_type IS 'Type of package/container (bottle, bag, box, case, can, jar, etc.)';
    COMMENT ON COLUMN receipt_line_items.size_value IS 'Numeric value of the package size (e.g., 750 for 750ml bottle)';
    COMMENT ON COLUMN receipt_line_items.size_unit IS 'Unit of measurement for size_value (ml, L, g, kg, lb, oz, fl oz, etc.)';
  END IF;
END
$$;

-- Create test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000901', 'Test Receipt Restaurant', '123 Test St', '555-0001')
ON CONFLICT (id) DO NOTHING;

-- Create test receipt import
INSERT INTO receipt_imports (id, restaurant_id, file_name, processed_by, status) VALUES
  ('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-000000000901', 'test_receipt.jpg', '00000000-0000-0000-0000-000000000000', 'processed')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TEST CATEGORY 1: Column Existence and Types
-- ============================================================

-- Test 1: package_type column exists
SELECT has_column(
  'public',
  'receipt_line_items',
  'package_type',
  'receipt_line_items should have package_type column'
);

-- Test 2: size_value column exists
SELECT has_column(
  'public',
  'receipt_line_items',
  'size_value',
  'receipt_line_items should have size_value column'
);

-- Test 3: size_unit column exists
SELECT has_column(
  'public',
  'receipt_line_items',
  'size_unit',
  'receipt_line_items should have size_unit column'
);

-- Test 4: package_type is TEXT type
SELECT col_type_is(
  'public',
  'receipt_line_items',
  'package_type',
  'text',
  'package_type should be TEXT type'
);

-- Test 5: size_value is NUMERIC type
SELECT col_type_is(
  'public',
  'receipt_line_items',
  'size_value',
  'numeric',
  'size_value should be NUMERIC type'
);

-- Test 6: size_unit is TEXT type
SELECT col_type_is(
  'public',
  'receipt_line_items',
  'size_unit',
  'text',
  'size_unit should be TEXT type'
);

-- ============================================================
-- TEST CATEGORY 2: Data Insertion and Retrieval
-- ============================================================

-- Test 7: Can insert row with all package fields
SELECT lives_ok(
  $$
    INSERT INTO receipt_line_items (
      id, receipt_id,
      raw_text, parsed_name,
      parsed_quantity, parsed_price,
      package_type, size_value, size_unit
    ) VALUES (
      '00000000-0000-0000-0000-000000000911',
      '00000000-0000-0000-0000-000000000902',
      '2 bottles 750ML VODKA',
      'VODKA',
      2,
      50.00,
      'bottle',
      750,
      'ml'
    )
    ON CONFLICT (id) DO UPDATE SET
      package_type = EXCLUDED.package_type,
      size_value = EXCLUDED.size_value,
      size_unit = EXCLUDED.size_unit
  $$,
  'Should insert receipt line with package_type, size_value, size_unit'
);

-- Test 8: Retrieve correct package_type
SELECT is(
  (SELECT package_type FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000911'),
  'bottle',
  'package_type should be "bottle"'
);

-- Test 9: Retrieve correct size_value
SELECT is(
  (SELECT size_value FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000911'),
  750::numeric,
  'size_value should be 750'
);

-- Test 10: Retrieve correct size_unit
SELECT is(
  (SELECT size_unit FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000911'),
  'ml',
  'size_unit should be "ml"'
);

-- ============================================================
-- TEST CATEGORY 3: NULL Value Handling
-- ============================================================

-- Test 11: Can insert row with NULL package fields
SELECT lives_ok(
  $$
    INSERT INTO receipt_line_items (
      id, receipt_id,
      raw_text, parsed_name,
      parsed_quantity, parsed_price,
      package_type, size_value, size_unit
    ) VALUES (
      '00000000-0000-0000-0000-000000000912',
      '00000000-0000-0000-0000-000000000902',
      'BULK ITEM',
      'BULK ITEM',
      1,
      10.00,
      NULL,
      NULL,
      NULL
    )
    ON CONFLICT (id) DO UPDATE SET
      package_type = EXCLUDED.package_type,
      size_value = EXCLUDED.size_value,
      size_unit = EXCLUDED.size_unit
  $$,
  'Should insert receipt line with NULL package fields'
);

-- Test 12: NULL package_type is stored as NULL
SELECT is(
  (SELECT package_type FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000912'),
  NULL,
  'package_type should be NULL when not provided'
);

-- Test 13: NULL size_value is stored as NULL
SELECT is(
  (SELECT size_value FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000912'),
  NULL,
  'size_value should be NULL when not provided'
);

-- Test 14: NULL size_unit is stored as NULL
SELECT is(
  (SELECT size_unit FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000912'),
  NULL,
  'size_unit should be NULL when not provided'
);

-- ============================================================
-- TEST CATEGORY 4: Edge Cases - Various Package Types
-- ============================================================

-- Test 15: Can insert bag with lb
SELECT lives_ok(
  $$
    INSERT INTO receipt_line_items (
      id, receipt_id,
      raw_text, parsed_name,
      package_type, size_value, size_unit
    ) VALUES (
      '00000000-0000-0000-0000-000000000913',
      '00000000-0000-0000-0000-000000000902',
      '5LB BAG RICE',
      'RICE',
      'bag',
      5,
      'lb'
    )
    ON CONFLICT (id) DO UPDATE SET
      package_type = EXCLUDED.package_type,
      size_value = EXCLUDED.size_value,
      size_unit = EXCLUDED.size_unit
  $$,
  'Should insert bag with lb size'
);

-- Test 16: Verify bag/lb data
SELECT ok(
  (SELECT package_type = 'bag' AND size_value = 5 AND size_unit = 'lb'
   FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000913'),
  'Bag with 5 lb should be stored correctly'
);

-- Test 17: Can insert case with ml
SELECT lives_ok(
  $$
    INSERT INTO receipt_line_items (
      id, receipt_id,
      raw_text, parsed_name,
      package_type, size_value, size_unit
    ) VALUES (
      '00000000-0000-0000-0000-000000000914',
      '00000000-0000-0000-0000-000000000902',
      '1 case 12x355ML BEER',
      'BEER',
      'case',
      355,
      'ml'
    )
    ON CONFLICT (id) DO UPDATE SET
      package_type = EXCLUDED.package_type,
      size_value = EXCLUDED.size_value,
      size_unit = EXCLUDED.size_unit
  $$,
  'Should insert case with ml size'
);

-- Test 18: Verify case/ml data
SELECT ok(
  (SELECT package_type = 'case' AND size_value = 355 AND size_unit = 'ml'
   FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000914'),
  'Case with 355 ml should be stored correctly'
);

-- ============================================================
-- TEST CATEGORY 5: Edge Cases - Decimal Values
-- ============================================================

-- Test 19: Can insert decimal size_value
SELECT lives_ok(
  $$
    INSERT INTO receipt_line_items (
      id, receipt_id,
      raw_text, parsed_name,
      package_type, size_value, size_unit
    ) VALUES (
      '00000000-0000-0000-0000-000000000915',
      '00000000-0000-0000-0000-000000000902',
      '6.86 @ 4.64 CHEEK MEAT',
      'CHEEK MEAT',
      NULL,
      6.86,
      'lb'
    )
    ON CONFLICT (id) DO UPDATE SET
      package_type = EXCLUDED.package_type,
      size_value = EXCLUDED.size_value,
      size_unit = EXCLUDED.size_unit
  $$,
  'Should insert decimal size_value'
);

-- Test 20: Verify decimal precision
SELECT ok(
  (SELECT size_value BETWEEN 6.85 AND 6.87
   FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000915'),
  'Decimal size_value should maintain precision: 6.86'
);

-- ============================================================
-- TEST CATEGORY 6: Edge Cases - Zero and Boundary Values
-- ============================================================

-- Test 21: Can insert zero size_value
SELECT lives_ok(
  $$
    INSERT INTO receipt_line_items (
      id, receipt_id,
      raw_text,
      package_type, size_value, size_unit
    ) VALUES (
      '00000000-0000-0000-0000-000000000916',
      '00000000-0000-0000-0000-000000000902',
      'ZERO SIZE TEST',
      'box',
      0,
      'lb'
    )
    ON CONFLICT (id) DO UPDATE SET
      package_type = EXCLUDED.package_type,
      size_value = EXCLUDED.size_value,
      size_unit = EXCLUDED.size_unit
  $$,
  'Should insert zero size_value'
);

-- Test 22: Zero value is stored correctly
SELECT is(
  (SELECT size_value FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000916'),
  0::numeric,
  'Zero size_value should be stored as 0, not NULL'
);

-- Test 23: Can insert very large size_value
SELECT lives_ok(
  $$
    INSERT INTO receipt_line_items (
      id, receipt_id,
      raw_text,
      package_type, size_value, size_unit
    ) VALUES (
      '00000000-0000-0000-0000-000000000917',
      '00000000-0000-0000-0000-000000000902',
      'LARGE SIZE TEST',
      'container',
      1000000,
      'ml'
    )
    ON CONFLICT (id) DO UPDATE SET
      package_type = EXCLUDED.package_type,
      size_value = EXCLUDED.size_value,
      size_unit = EXCLUDED.size_unit
  $$,
  'Should insert very large size_value'
);

-- Test 24: Large value is stored correctly
SELECT is(
  (SELECT size_value FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000917'),
  1000000::numeric,
  'Large size_value (1000000) should be stored correctly'
);

-- ============================================================
-- TEST CATEGORY 7: CRITICAL - Backward Compatibility
-- ============================================================

-- Test 25: Old receipts without package fields should still work  
SELECT is(
  (SELECT COUNT(*)::int FROM receipt_line_items 
   WHERE package_type IS NULL 
   AND size_value IS NULL 
   AND size_unit IS NULL),
  1,
  'Should have exactly 1 receipt line with all NULL package fields (from test 11)'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
