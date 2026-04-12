BEGIN;
SELECT plan(4);

SELECT has_column('schedule_publications', 'open_shifts_broadcast_at',
  'schedule_publications should have open_shifts_broadcast_at column');

SELECT has_column('schedule_publications', 'open_shifts_broadcast_by',
  'schedule_publications should have open_shifts_broadcast_by column');

SELECT col_is_null('schedule_publications', 'open_shifts_broadcast_at',
  'open_shifts_broadcast_at should be nullable');

SELECT col_is_null('schedule_publications', 'open_shifts_broadcast_by',
  'open_shifts_broadcast_by should be nullable');

SELECT * FROM finish();
ROLLBACK;
