BEGIN;
SELECT plan(8);

SET LOCAL role TO postgres;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-0000000008a1', 'Sync Visibility Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO toast_connections (
  restaurant_id, client_id, client_secret_encrypted, toast_restaurant_guid,
  is_active, connection_status
)
VALUES (
  '00000000-0000-0000-0000-0000000008a1', 'test', 'test', 'test',
  true, 'connected'
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- TEST 1-2
-- record_pos_sync_error writes the error fields on the right connection table.
SELECT lives_ok(
  $$SELECT public.record_pos_sync_error(
      'toast', '00000000-0000-0000-0000-0000000008a1', 'boom')$$,
  'record_pos_sync_error runs'
);

SELECT is(
  (SELECT connection_status || '|' || left(last_error, 4)
     FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-0000000008a1'),
  'error|boom',
  'record_pos_sync_error sets connection_status and last_error'
);

-- ---------------------------------------------------------------- TEST 3
-- It survives being called from inside a query_canceled handler -- the exact
-- situation the Feb 2026 outage hid. statement_timeout is armed once per
-- client statement, so setting it here arms it for the DO block below.
UPDATE toast_connections
   SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
 WHERE restaurant_id = '00000000-0000-0000-0000-0000000008a1';

SET LOCAL statement_timeout = '100ms';

DO $$
BEGIN
  BEGIN
    PERFORM pg_sleep(2);
  EXCEPTION WHEN query_canceled THEN
    PERFORM public.record_pos_sync_error(
      'toast', '00000000-0000-0000-0000-0000000008a1', 'forced timeout');
  END;
END $$;

SET LOCAL statement_timeout = 0;

SELECT is(
  (SELECT connection_status || '|' || last_error
     FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-0000000008a1'),
  'error|forced timeout',
  'record_pos_sync_error works from inside a query_canceled handler'
);

-- ---------------------------------------------------------------- TEST 4-5
-- It is NOT reachable from the PostgREST roles. Without the REVOKE, Supabase's
-- default ACL on schema public would make this SECURITY DEFINER function a
-- cross-tenant write available with the anon key.
SELECT ok(
  NOT has_function_privilege('anon',
    'public.record_pos_sync_error(text, uuid, text)', 'EXECUTE'),
  'anon cannot execute record_pos_sync_error'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.record_pos_sync_error(text, uuid, text)', 'EXECUTE'),
  'authenticated cannot execute record_pos_sync_error'
);

-- ---------------------------------------------------------------- TEST 6
SELECT ok(
  has_function_privilege('service_role',
    'public.record_pos_sync_error(text, uuid, text)', 'EXECUTE'),
  'service_role can execute record_pos_sync_error'
);

-- ---------------------------------------------------------------- TEST 7
-- Regression guard: a future CREATE OR REPLACE sourced from an older migration
-- would silently drop the query_canceled arm and restore the Feb 2026 failure
-- mode. WHEN OTHERS does not cover it, so its absence is invisible until an
-- outage.
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sync_all_toast_to_unified_sales',
                        'sync_all_shift4_to_unified_sales',
                        'sync_all_focus_to_unified_sales',
                        'sync_all_focus_transactions_to_unified_sales')
      AND p.prosrc LIKE '%WHEN query_canceled THEN%'),
  4,
  'all four sync_all_* wrappers handle query_canceled explicitly'
);

-- ---------------------------------------------------------------- TEST 8
-- Revel must run the sweep. Without this call Revel rows are inserted with the
-- categorization trigger suppressed and never categorized by anything.
SELECT ok(
  (SELECT p.prosrc LIKE '%apply_rules_to_pos_sales_internal%'
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sync_revel_to_unified_sales'),
  'sync_revel_to_unified_sales calls the categorization sweep'
);

SELECT * FROM finish();
ROLLBACK;
