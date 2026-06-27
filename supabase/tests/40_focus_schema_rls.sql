-- Tests for Focus POS integration schema: focus_connections + focus_daily_reports
-- Migration: <ts>_focus_integration.sql
-- Covers: table existence, key columns, CHECK constraints, named unique indexes, RLS enabled

BEGIN;
SELECT plan(12);

-- Setup: create a test restaurant for FK-valid INSERT tests
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
INSERT INTO public.restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-f0c0550000a1', 'Focus Test Restaurant', '1 Test St', '555-0000')
ON CONFLICT (id) DO NOTHING;

-- Test 1: focus_connections table exists
SELECT has_table('public', 'focus_connections', 'focus_connections table exists');

-- Test 2: focus_daily_reports table exists
SELECT has_table('public', 'focus_daily_reports', 'focus_daily_reports table exists');

-- Test 3: focus_connections has store_id column
SELECT has_column('public', 'focus_connections', 'store_id', 'focus_connections has store_id');

-- Test 4: focus_connections has timezone column (S4 — tz-correct backfill)
SELECT has_column('public', 'focus_connections', 'timezone', 'focus_connections has timezone');

-- Test 5: report_base_url has a CHECK constraint (SSRF guard at DB level — S1)
SELECT col_has_check('public', 'focus_connections', 'report_base_url', 'report_base_url has CHECK constraint');

-- Test 6: named unique constraint on restaurant_id (for ON CONFLICT upsert — S7)
SELECT has_index('public', 'focus_connections', 'focus_connections_restaurant_key', 'focus_connections has focus_connections_restaurant_key unique index');

-- Test 7: unique constraint on focus_daily_reports(restaurant_id, business_date, revenue_center)
SELECT has_index('public', 'focus_daily_reports', 'focus_daily_reports_unique', 'focus_daily_reports has focus_daily_reports_unique index');

-- Test 8: RLS enabled on focus_connections
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'focus_connections' AND relnamespace = 'public'::regnamespace),
  true,
  'RLS is enabled on focus_connections'
);

-- Test 9: RLS enabled on focus_daily_reports
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'focus_daily_reports' AND relnamespace = 'public'::regnamespace),
  true,
  'RLS is enabled on focus_daily_reports'
);

-- Test 10: CHECK rejects non-https / non-myfocuspos host (valid FK, bad URL → CHECK fires)
SELECT throws_ok(
  $$INSERT INTO focus_connections(restaurant_id, report_base_url, report_path, store_id)
    VALUES ('00000000-0000-0000-0000-f0c0550000a1'::uuid, 'http://evil.com', '/x', '1')$$,
  NULL,
  NULL,
  'report_base_url CHECK rejects non-https / non-myfocuspos URL'
);

-- Test 11: CHECK accepts a valid myfocuspos.com host (uses the seeded test restaurant)
SELECT lives_ok(
  $$INSERT INTO focus_connections(restaurant_id, report_base_url, report_path, store_id)
    VALUES ('00000000-0000-0000-0000-f0c0550000a1'::uuid, 'https://mfprod-1.myfocuspos.com', '/ReportServer?/generalstorereports/revenuecenter', '15312')$$,
  'report_base_url CHECK accepts a valid myfocuspos.com host'
);

-- Test 12: focus_connections.id is the primary key
SELECT col_is_pk('public', 'focus_connections', 'id', 'focus_connections.id is the primary key');

SELECT * FROM finish();
ROLLBACK;
