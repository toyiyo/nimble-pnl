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

-- Test bulk_process_historical_sales function exists (FIXED: returns jsonb not integer)
SELECT has_function(
    'public',
    'bulk_process_historical_sales',
    ARRAY['uuid', 'date', 'date'],
    'bulk_process_historical_sales function should exist'
);

SELECT function_returns(
    'public',
    'bulk_process_historical_sales',
    ARRAY['uuid', 'date', 'date'],
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
