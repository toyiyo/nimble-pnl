-- ============================================================================
-- Test: shift trade reminders schema (design B4 items 1, 2, 7 and 8).
--
-- Migration: 20260925120000_shift_trade_reminders.sql
--
-- Checks the shift_trade_reminders table, its RLS and grants, the
-- safe_restaurant_tz helper, the notification type CHECK constraint, and
-- the cron job.
--
-- Fixture namespace: UUIDs that start with 73000000-...
-- ============================================================================

BEGIN;
SELECT plan(24);

SET LOCAL role TO postgres;

INSERT INTO restaurants (id, name) VALUES
  ('73000000-0000-0000-0000-000000000001', 'Reminder Schema Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active, status) VALUES
  ('73000000-0000-0000-0000-000000000021', '73000000-0000-0000-0000-000000000001', NULL, 'Poster A', 'rem-a-73@test.com', 'Server', true, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status, is_published) VALUES
  ('73000000-0000-0000-0000-000000000041', '73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000021', now() + interval '2 days', now() + interval '2 days 6 hours', 'Server', 0, 'scheduled', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status) VALUES
  ('73000000-0000-0000-0000-000000000051', '73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000041', '73000000-0000-0000-0000-000000000021', 'open')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Table shape (1-6)
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'shift_trade_reminders', 'shift_trade_reminders table exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.shift_trade_reminders'::regclass),
  'shift_trade_reminders has RLS enabled'
);

SELECT col_is_unique(
  'public', 'shift_trade_reminders', ARRAY['shift_trade_id', 'stage'],
  'shift_trade_reminders is unique on (shift_trade_id, stage)'
);

SELECT has_index(
  'public', 'shift_trade_reminders', 'shift_trade_reminders_restaurant_idx', ARRAY['restaurant_id'],
  'shift_trade_reminders has an index on restaurant_id'
);

SELECT throws_ok(
  $$ INSERT INTO public.shift_trade_reminders (restaurant_id, shift_trade_id, stage)
     VALUES ('73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000051', '48h') $$,
  '23514', NULL,
  'stage CHECK refuses an unknown stage'
);

SELECT lives_ok(
  $$ INSERT INTO public.shift_trade_reminders (restaurant_id, shift_trade_id, stage)
     VALUES ('73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000051', '72h') $$,
  'stage CHECK accepts 72h'
);

SELECT throws_ok(
  $$ INSERT INTO public.shift_trade_reminders (restaurant_id, shift_trade_id, stage)
     VALUES ('73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000051', '72h') $$,
  '23505', NULL,
  'a second row for the same (trade, stage) is refused'
);

-- ---------------------------------------------------------------------------
-- Grants (8-10)
-- ---------------------------------------------------------------------------
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT count(*) FROM public.shift_trade_reminders $$,
  '42501', NULL,
  'authenticated cannot select shift_trade_reminders'
);

RESET ROLE;
SET LOCAL role TO postgres;

SELECT ok(
  NOT has_table_privilege('anon', 'public.shift_trade_reminders', 'SELECT'),
  'anon has no SELECT on shift_trade_reminders'
);

SELECT ok(
  has_table_privilege('service_role', 'public.shift_trade_reminders', 'INSERT'),
  'service_role can insert into shift_trade_reminders'
);

-- ---------------------------------------------------------------------------
-- safe_restaurant_tz (11-16)
-- ---------------------------------------------------------------------------
SELECT is(public.safe_restaurant_tz(NULL), 'America/Chicago', 'safe_restaurant_tz(NULL) returns the fallback');
SELECT is(public.safe_restaurant_tz(''), 'America/Chicago', 'safe_restaurant_tz('''') returns the fallback');
SELECT is(public.safe_restaurant_tz('Not/AZone'), 'America/Chicago', 'safe_restaurant_tz of a garbage zone returns the fallback');
SELECT is(public.safe_restaurant_tz('America/New_York'), 'America/New_York', 'safe_restaurant_tz keeps a valid zone');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.safe_restaurant_tz(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.safe_restaurant_tz(text)', 'EXECUTE'),
  'anon and authenticated cannot execute safe_restaurant_tz'
);

SELECT ok(
  has_function_privilege('service_role', 'public.safe_restaurant_tz(text)', 'EXECUTE'),
  'service_role can execute safe_restaurant_tz'
);

-- ---------------------------------------------------------------------------
-- Notification type CHECK constraint (17-19)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ INSERT INTO public.notification_channel_settings (restaurant_id, notification_type)
     VALUES ('73000000-0000-0000-0000-000000000001', 'shift_trade_reminder') $$,
  'CHECK constraint accepts shift_trade_reminder'
);

SELECT lives_ok(
  $$ INSERT INTO public.notification_channel_settings (restaurant_id, notification_type)
     VALUES ('73000000-0000-0000-0000-000000000001', 'shift_trade_unclaimed') $$,
  'CHECK constraint accepts shift_trade_unclaimed'
);

SELECT throws_ok(
  $$ INSERT INTO public.notification_channel_settings (restaurant_id, notification_type)
     VALUES ('73000000-0000-0000-0000-000000000001', 'shift_trade_bogus') $$,
  '23514', NULL,
  'CHECK constraint still refuses an unknown key'
);

-- ---------------------------------------------------------------------------
-- Cron job and dispatcher (20-24)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'shift-trade-reminders'),
  '*/15 * * * *',
  'cron job shift-trade-reminders runs every 15 minutes'
);

SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'shift-trade-reminders')
    LIKE '%public.dispatch_shift_trade_reminders()%',
  'cron job shift-trade-reminders calls dispatch_shift_trade_reminders()'
);

-- The project does not set app.settings.supabase_url. A read without
-- missing_ok fails on each run (20260702160000_focus_crons_gateless.sql:6-9).
SELECT ok(
  pg_get_functiondef('public.dispatch_shift_trade_reminders()'::regprocedure)
    NOT LIKE '%current_setting(''app.settings.supabase_url'')%'
  AND pg_get_functiondef('public.dispatch_shift_trade_reminders()'::regprocedure)
    NOT LIKE '%current_setting(''app.settings.service_role_key'')%',
  'dispatcher reads the app.settings values only with missing_ok'
);

-- With no key in the settings and no Vault secret, the dispatcher sends
-- nothing. A local database therefore never calls the production function.
SELECT set_config('app.settings.service_role_key', '', true);
SELECT is(
  CASE WHEN EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
       THEN NULL::bigint
       ELSE public.dispatch_shift_trade_reminders()
  END,
  NULL::bigint,
  'dispatcher returns NULL and sends no request when no key exists'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.dispatch_shift_trade_reminders()', 'EXECUTE'),
  'authenticated cannot execute dispatch_shift_trade_reminders'
);

SELECT * FROM finish();
ROLLBACK;
