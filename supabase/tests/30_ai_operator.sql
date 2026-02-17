-- Tests for AI Operator tables and SQL functions
BEGIN;
SELECT plan(9);

-- ============================================================================
-- TEST CATEGORY 1: Tables Exist
-- ============================================================================

SELECT has_table('public', 'ops_inbox_item', 'ops_inbox_item table exists');
SELECT has_table('public', 'weekly_brief', 'weekly_brief table exists');
SELECT has_table('public', 'notification_preferences', 'notification_preferences table exists');

-- ============================================================================
-- TEST CATEGORY 2: Unique Constraints
-- ============================================================================

SELECT has_index('public', 'weekly_brief', 'weekly_brief_restaurant_id_brief_week_end_key',
  'weekly_brief has unique index on restaurant_id, brief_week_end');

-- ============================================================================
-- TEST CATEGORY 3: Functions return safe defaults for nonexistent data
-- ============================================================================

SELECT is(
  compute_weekly_variances('00000000-0000-0000-0000-000000000000'::uuid, CURRENT_DATE),
  '[]'::jsonb,
  'compute_weekly_variances returns empty array for nonexistent restaurant'
);

SELECT is(
  compute_daily_variances('00000000-0000-0000-0000-000000000000'::uuid, CURRENT_DATE),
  '[]'::jsonb,
  'compute_daily_variances still works for nonexistent restaurant'
);

SELECT is(
  detect_uncategorized_backlog('00000000-0000-0000-0000-000000000000'::uuid),
  0,
  'detect_uncategorized_backlog returns 0 for empty restaurant'
);

SELECT is(
  detect_metric_anomalies('00000000-0000-0000-0000-000000000000'::uuid, CURRENT_DATE),
  0,
  'detect_metric_anomalies returns 0 for empty restaurant'
);

SELECT is(
  detect_reconciliation_gaps('00000000-0000-0000-0000-000000000000'::uuid, CURRENT_DATE),
  0,
  'detect_reconciliation_gaps returns 0 for empty restaurant'
);

SELECT * FROM finish();
ROLLBACK;
