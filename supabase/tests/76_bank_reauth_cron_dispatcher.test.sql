-- ============================================================================
-- Test: bank-reauth-notices cron dispatcher.
--
-- Design: docs/superpowers/specs/2026-09-26-bank-reauth-cron-dispatcher-design.md
--
-- Checks the bank-reauth-notices cron job calls a dispatcher function
-- (public.dispatch_bank_reauth_notices()), the dispatcher never reads the
-- service role key or the project URL from a plain setting, and the
-- dispatcher's grants match the shift-trade-reminders pattern
-- (supabase/migrations/20260925120000_shift_trade_reminders.sql).
--
-- This test deletes the Vault secret supabase_service_role_key inside the
-- test transaction, so the "no key" call always runs (it does not skip the
-- call the way 73_shift_trade_reminders_schema.test.sql:181-188 does).
-- ROLLBACK at the end restores the secret.
-- ============================================================================

BEGIN;
SELECT plan(13);

SET LOCAL role TO postgres;

-- ---------------------------------------------------------------------------
-- Cron job (1-3)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'bank-reauth-notices'),
  '0 9 * * *',
  'cron job bank-reauth-notices runs daily at 09:00 UTC'
);

SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'bank-reauth-notices')
    LIKE '%public.dispatch_bank_reauth_notices()%',
  'cron job bank-reauth-notices calls dispatch_bank_reauth_notices()'
);

SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'bank-reauth-notices')
    NOT LIKE '%app.settings%',
  'cron command does not read app.settings directly'
);

-- ---------------------------------------------------------------------------
-- Dispatcher body (4-5)
-- ---------------------------------------------------------------------------
SELECT ok(
  pg_get_functiondef('public.dispatch_bank_reauth_notices()'::regprocedure)
    NOT LIKE '%app.settings.supabase_url%',
  'dispatcher does not read the URL from a setting'
);

SELECT ok(
  pg_get_functiondef('public.dispatch_bank_reauth_notices()'::regprocedure)
    NOT LIKE '%current_setting(''app.settings.service_role_key'')%',
  'dispatcher reads the key setting only with missing_ok'
);

-- Delete the Vault secret inside the test transaction. Do not skip the
-- "no key" call below the way 73_shift_trade_reminders_schema.test.sql
-- does; ROLLBACK restores the secret when the test ends.
DELETE FROM vault.secrets WHERE name = 'supabase_service_role_key';

-- ---------------------------------------------------------------------------
-- No key: dispatcher sends nothing (6-7)
-- ---------------------------------------------------------------------------
SELECT set_config('app.settings.service_role_key', '', true);

SELECT is(
  public.dispatch_bank_reauth_notices(),
  NULL::bigint,
  'dispatcher returns NULL when no key setting and no Vault secret exist'
);

SELECT is(
  (SELECT count(*) FROM net.http_request_queue WHERE url LIKE '%bank-reauth-notices%')::int,
  0,
  'the no-key call adds no row to net.http_request_queue'
);

-- ---------------------------------------------------------------------------
-- Test key: dispatcher sends a request (8-10)
-- ---------------------------------------------------------------------------
SELECT set_config('app.settings.service_role_key', 'test-service-role-key-76', true);

SELECT ok(
  public.dispatch_bank_reauth_notices() IS NOT NULL,
  'dispatcher returns a request id when a key setting exists'
);

SELECT ok(
  (SELECT url FROM net.http_request_queue WHERE url LIKE '%bank-reauth-notices%' ORDER BY id DESC LIMIT 1)
    = 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/bank-reauth-notices',
  'the queue row targets the bank-reauth-notices function URL'
);

SELECT ok(
  (SELECT headers->>'Authorization' FROM net.http_request_queue WHERE url LIKE '%bank-reauth-notices%' ORDER BY id DESC LIMIT 1)
    = 'Bearer test-service-role-key-76',
  'the queue row carries the test key as a Bearer header'
);

-- ---------------------------------------------------------------------------
-- Grants (11-13)
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.dispatch_bank_reauth_notices()', 'EXECUTE'),
  'anon cannot execute dispatch_bank_reauth_notices'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.dispatch_bank_reauth_notices()', 'EXECUTE'),
  'authenticated cannot execute dispatch_bank_reauth_notices'
);

SELECT ok(
  has_function_privilege('service_role', 'public.dispatch_bank_reauth_notices()', 'EXECUTE'),
  'service_role can execute dispatch_bank_reauth_notices'
);

SELECT * FROM finish();
ROLLBACK;
