BEGIN;
SELECT plan(10);

-- Table exists
SELECT has_table('public', 'overtime_rules', 'overtime_rules table exists');
SELECT has_table('public', 'overtime_adjustments', 'overtime_adjustments table exists');

-- overtime_rules columns
SELECT has_column('public', 'overtime_rules', 'restaurant_id', 'overtime_rules has restaurant_id');
SELECT has_column('public', 'overtime_rules', 'weekly_threshold_hours', 'overtime_rules has weekly_threshold_hours');
SELECT has_column('public', 'overtime_rules', 'daily_threshold_hours', 'overtime_rules has daily_threshold_hours');
SELECT has_column('public', 'overtime_rules', 'exclude_tips_from_ot_rate', 'overtime_rules has exclude_tips_from_ot_rate');

-- overtime_adjustments columns
SELECT has_column('public', 'overtime_adjustments', 'employee_id', 'overtime_adjustments has employee_id');
SELECT has_column('public', 'overtime_adjustments', 'adjustment_type', 'overtime_adjustments has adjustment_type');
SELECT has_column('public', 'overtime_adjustments', 'hours', 'overtime_adjustments has hours');

-- employees.is_exempt
SELECT has_column('public', 'employees', 'is_exempt', 'employees has is_exempt');

SELECT * FROM finish();
ROLLBACK;
