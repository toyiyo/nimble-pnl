BEGIN;
SELECT plan(12);

-- 1. Table exists
SELECT has_table('public', 'open_shift_claims', 'open_shift_claims table should exist');

-- 2-7. Required columns exist
SELECT has_column('public', 'open_shift_claims', 'id', 'should have id column');
SELECT has_column('public', 'open_shift_claims', 'restaurant_id', 'should have restaurant_id column');
SELECT has_column('public', 'open_shift_claims', 'shift_template_id', 'should have shift_template_id column');
SELECT has_column('public', 'open_shift_claims', 'shift_date', 'should have shift_date column');
SELECT has_column('public', 'open_shift_claims', 'claimed_by_employee_id', 'should have claimed_by_employee_id column');
SELECT col_default_is('public', 'open_shift_claims', 'status', 'approved', 'status should default to approved');

-- 8-9. Settings columns on staffing_settings
SELECT has_column('public', 'staffing_settings', 'open_shifts_enabled', 'staffing_settings should have open_shifts_enabled');
SELECT has_column('public', 'staffing_settings', 'require_shift_claim_approval', 'staffing_settings should have require_shift_claim_approval');

-- 10-12. RPC functions exist
SELECT has_function('public', 'get_open_shifts', ARRAY['uuid', 'date', 'date'], 'get_open_shifts function should exist');
SELECT has_function('public', 'claim_open_shift', ARRAY['uuid', 'uuid', 'date', 'uuid'], 'claim_open_shift function should exist');
SELECT has_function('public', 'approve_open_shift_claim', ARRAY['uuid', 'text'], 'approve_open_shift_claim function should exist');

SELECT * FROM finish();
ROLLBACK;
