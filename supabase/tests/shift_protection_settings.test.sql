-- ============================================================================
-- Test: Shift Protection policy columns on staffing_settings
--
-- Migration under test: 20260903034500_shift_protection_settings.sql
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md
--
-- Fixture namespace: UUIDs starting with 71000000-...
-- ============================================================================

BEGIN;
SELECT plan(15);

-- Columns exist
SELECT has_column('public', 'staffing_settings', 'trade_deadline_mode', 'has trade_deadline_mode');
SELECT has_column('public', 'staffing_settings', 'trade_deadline_hours', 'has trade_deadline_hours');
SELECT has_column('public', 'staffing_settings', 'trade_auto_expire', 'has trade_auto_expire');
SELECT has_column('public', 'staffing_settings', 'timeoff_notice_mode', 'has timeoff_notice_mode');
SELECT has_column('public', 'staffing_settings', 'timeoff_notice_days', 'has timeoff_notice_days');
SELECT has_column('public', 'staffing_settings', 'timeoff_sameday_mode', 'has timeoff_sameday_mode');
SELECT has_column('public', 'staffing_settings', 'timeoff_sameday_limit', 'has timeoff_sameday_limit');
SELECT has_column('public', 'staffing_settings', 'coverage_floor_mode', 'has coverage_floor_mode');

-- Fixture: one restaurant, one default settings row
SET LOCAL role TO postgres;
ALTER TABLE staffing_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name) VALUES
  ('71000000-0000-0000-0000-000000000001', 'Shift Protection Settings Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

DELETE FROM staffing_settings WHERE restaurant_id = '71000000-0000-0000-0000-000000000001';
INSERT INTO staffing_settings (restaurant_id) VALUES ('71000000-0000-0000-0000-000000000001');

-- Defaults land as off / 24 / false / 7 / 2
SELECT is(
  (SELECT trade_deadline_mode || '/' || trade_deadline_hours::text || '/' || trade_auto_expire::text
   FROM staffing_settings WHERE restaurant_id = '71000000-0000-0000-0000-000000000001'),
  'off/24/false',
  'trade defaults are off / 24 hours / no auto-expire'
);

SELECT is(
  (SELECT timeoff_notice_mode || '/' || timeoff_notice_days::text || '/' ||
          timeoff_sameday_mode || '/' || timeoff_sameday_limit::text || '/' || coverage_floor_mode
   FROM staffing_settings WHERE restaurant_id = '71000000-0000-0000-0000-000000000001'),
  'off/7/off/2/off',
  'time-off defaults are off / 7 days / off / 2 / off'
);

-- CHECK constraints reject bad values
SELECT throws_ok(
  $$UPDATE staffing_settings SET trade_deadline_mode = 'maybe'
    WHERE restaurant_id = '71000000-0000-0000-0000-000000000001'$$,
  '23514',
  NULL,
  'trade_deadline_mode rejects a value outside off/warn/block'
);

SELECT throws_ok(
  $$UPDATE staffing_settings SET trade_deadline_hours = 0
    WHERE restaurant_id = '71000000-0000-0000-0000-000000000001'$$,
  '23514',
  NULL,
  'trade_deadline_hours rejects zero'
);

SELECT throws_ok(
  $$UPDATE staffing_settings SET timeoff_notice_days = -1
    WHERE restaurant_id = '71000000-0000-0000-0000-000000000001'$$,
  '23514',
  NULL,
  'timeoff_notice_days rejects a negative value'
);

SELECT throws_ok(
  $$UPDATE staffing_settings SET timeoff_sameday_limit = 0
    WHERE restaurant_id = '71000000-0000-0000-0000-000000000001'$$,
  '23514',
  NULL,
  'timeoff_sameday_limit rejects zero'
);

-- Valid modes are accepted
SELECT lives_ok(
  $$UPDATE staffing_settings
    SET trade_deadline_mode = 'warn', timeoff_notice_mode = 'block',
        timeoff_sameday_mode = 'warn', coverage_floor_mode = 'warn'
    WHERE restaurant_id = '71000000-0000-0000-0000-000000000001'$$,
  'warn and block are accepted mode values'
);

ALTER TABLE staffing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
