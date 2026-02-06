-- Tests for Shift4/Lighthouse sync functions
BEGIN;
SELECT plan(7);

-- Test sync_all_shift4_to_unified_sales function exists
SELECT has_function(
    'public',
    'sync_all_shift4_to_unified_sales',
    ARRAY[]::text[],
    'sync_all_shift4_to_unified_sales function should exist'
);

SELECT function_returns(
    'public',
    'sync_all_shift4_to_unified_sales',
    ARRAY[]::text[],
    'setof record',
    'sync_all_shift4_to_unified_sales should return records'
);

SELECT function_lang_is(
    'public',
    'sync_all_shift4_to_unified_sales',
    ARRAY[]::text[],
    'plpgsql',
    'sync_all_shift4_to_unified_sales should be plpgsql'
);

-- Test that the function is SECURITY DEFINER (required for cron job execution)
SELECT is(
    (SELECT prosecdef FROM pg_proc WHERE proname = 'sync_all_shift4_to_unified_sales'),
    true,
    'sync_all_shift4_to_unified_sales should be SECURITY DEFINER'
);

-- Test that the function has explicit search_path set (security requirement)
SELECT ok(
    (SELECT proconfig @> ARRAY['search_path=pg_catalog, public'] FROM pg_proc WHERE proname = 'sync_all_shift4_to_unified_sales'),
    'sync_all_shift4_to_unified_sales should have explicit search_path'
);

-- Test sync_shift4_to_unified_sales function exists (called by sync_all)
SELECT has_function(
    'public',
    'sync_shift4_to_unified_sales',
    ARRAY['uuid'],
    'sync_shift4_to_unified_sales function should exist'
);

-- Test the function returns integer (row count)
SELECT function_returns(
    'public',
    'sync_shift4_to_unified_sales',
    ARRAY['uuid'],
    'integer',
    'sync_shift4_to_unified_sales should return integer'
);

SELECT * FROM finish();
ROLLBACK;
