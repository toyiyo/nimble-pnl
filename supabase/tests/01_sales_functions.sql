-- Tests for sales-related functions
BEGIN;
SELECT plan(12);

-- Test sync_square_to_unified_sales function exists
SELECT has_function(
    'public',
    'sync_square_to_unified_sales',
    ARRAY['uuid'],
    'sync_square_to_unified_sales function should exist'
);

SELECT function_returns(
    'public',
    'sync_square_to_unified_sales',
    ARRAY['uuid'],
    'integer',
    'sync_square_to_unified_sales should return integer'
);

SELECT function_lang_is(
    'public',
    'sync_square_to_unified_sales',
    ARRAY['uuid'],
    'plpgsql',
    'sync_square_to_unified_sales should be plpgsql'
);

SELECT volatility_is(
    'public',
    'sync_square_to_unified_sales',
    ARRAY['uuid'],
    'volatile',
    'sync_square_to_unified_sales should be volatile'
);

-- Test aggregate_unified_sales_to_daily function exists
SELECT has_function(
    'public',
    'aggregate_unified_sales_to_daily',
    ARRAY['uuid', 'date'],
    'aggregate_unified_sales_to_daily function should exist'
);

SELECT function_returns(
    'public',
    'aggregate_unified_sales_to_daily',
    ARRAY['uuid', 'date'],
    'void',
    'aggregate_unified_sales_to_daily should return void'
);

SELECT function_lang_is(
    'public',
    'aggregate_unified_sales_to_daily',
    ARRAY['uuid', 'date'],
    'plpgsql',
    'aggregate_unified_sales_to_daily should be plpgsql'
);

-- bulk_process_historical_sales is now the 7-arg keyset-batched form (migration
-- 20260720120000): the original 3-arg (uuid, date, date) signature was dropped
-- and replaced with defaulted cursor/batch params. Assert existence + return
-- type via pg_catalog directly rather than pgTAP's has_function/function_returns
-- type-array matching — those canonicalize type aliases inconsistently across
-- pgTAP/Postgres versions (local resolves 'timestamptz', CI's function_returns
-- only resolves 'timestamp with time zone'), which made the arg-array form
-- environment-dependent. pg_get_function_result is version-stable.
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'bulk_process_historical_sales'
          AND p.pronargs = 7
    ),
    'bulk_process_historical_sales (7-arg keyset-batched signature) should exist'
);

SELECT is(
    (SELECT pg_catalog.pg_get_function_result(p.oid)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'bulk_process_historical_sales'
      LIMIT 1),
    'jsonb',
    'bulk_process_historical_sales should return jsonb'
);

-- Test check_sale_already_processed function exists (FIXED: correct parameter signature)
SELECT has_function(
    'public',
    'check_sale_already_processed',
    ARRAY['uuid', 'text', 'integer', 'text', 'text'],
    'check_sale_already_processed function should exist'
);

SELECT function_returns(
    'public',
    'check_sale_already_processed',
    ARRAY['uuid', 'text', 'integer', 'text', 'text'],
    'boolean',
    'check_sale_already_processed should return boolean'
);

SELECT function_lang_is(
    'public',
    'check_sale_already_processed',
    ARRAY['uuid', 'text', 'integer', 'text', 'text'],
    'plpgsql',
    'check_sale_already_processed should be plpgsql'
);

SELECT * FROM finish();
ROLLBACK;
