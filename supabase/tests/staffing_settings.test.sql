BEGIN;
SELECT plan(6);

SELECT has_table('public', 'staffing_settings', 'staffing_settings table exists');
SELECT has_column('public', 'staffing_settings', 'restaurant_id', 'has restaurant_id');
SELECT has_column('public', 'staffing_settings', 'target_splh', 'has target_splh');
SELECT has_column('public', 'staffing_settings', 'avg_ticket_size', 'has avg_ticket_size');
SELECT has_column('public', 'staffing_settings', 'target_labor_pct', 'has target_labor_pct');
SELECT has_column('public', 'staffing_settings', 'min_staff', 'has min_staff');

SELECT * FROM finish();
ROLLBACK;
