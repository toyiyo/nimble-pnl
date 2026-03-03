BEGIN;
SELECT plan(6);

-- Test 1: Verify get_monthly_sales_metrics function exists
SELECT has_function(
  'public',
  'get_monthly_sales_metrics',
  ARRAY['uuid', 'date', 'date'],
  'get_monthly_sales_metrics function exists'
);

-- Test 2: Verify get_pos_tips_by_date function exists
SELECT has_function(
  'public',
  'get_pos_tips_by_date',
  ARRAY['uuid', 'date', 'date'],
  'get_pos_tips_by_date function exists'
);

-- Test 3: Verify regex matches "Tips Payable" (word boundary)
SELECT ok(
  'tips payable' ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)',
  'Regex matches "tips payable"'
);

-- Test 4: Verify regex matches "Tip - CREDIT" (word boundary)
SELECT ok(
  'tip - credit' ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)',
  'Regex matches "tip - credit"'
);

-- Test 5: Verify regex does NOT match "Stipend Liability" (false positive)
SELECT ok(
  NOT ('stipend liability' ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)'),
  'Regex does NOT match "stipend liability"'
);

-- Test 6: Verify regex does NOT match "overtipped" (embedded "tip" in larger word)
SELECT ok(
  NOT ('overtipped' ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)'),
  'Regex does NOT match "overtipped"'
);

SELECT * FROM finish();
ROLLBACK;
