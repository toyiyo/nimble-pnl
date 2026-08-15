BEGIN;
SELECT plan(2);

SELECT has_column('schedule_change_logs', 'notified_at',
  'schedule_change_logs should have notified_at column');

SELECT col_is_null('schedule_change_logs', 'notified_at',
  'notified_at should be nullable');

SELECT * FROM finish();
ROLLBACK;
