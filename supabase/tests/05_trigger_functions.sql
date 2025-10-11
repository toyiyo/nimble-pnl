-- Tests for trigger functions
BEGIN;
SELECT plan(17);

-- Test trigger_unified_sales_aggregation function exists
SELECT has_function(
    'public',
    'trigger_unified_sales_aggregation',
    'trigger_unified_sales_aggregation function should exist'
);

SELECT function_returns(
    'public',
    'trigger_unified_sales_aggregation',
    'trigger',
    'trigger_unified_sales_aggregation should return trigger'
);

SELECT function_lang_is(
    'public',
    'trigger_unified_sales_aggregation',
    'plpgsql',
    'trigger_unified_sales_aggregation should be plpgsql'
);

-- Test trigger_calculate_pnl function exists
SELECT has_function(
    'public',
    'trigger_calculate_pnl',
    'trigger_calculate_pnl function should exist'
);

SELECT function_returns(
    'public',
    'trigger_calculate_pnl',
    'trigger',
    'trigger_calculate_pnl should return trigger'
);

SELECT function_lang_is(
    'public',
    'trigger_calculate_pnl',
    'plpgsql',
    'trigger_calculate_pnl should be plpgsql'
);

-- Test trigger_automatic_inventory_deduction function exists
SELECT has_function(
    'public',
    'trigger_automatic_inventory_deduction',
    'trigger_automatic_inventory_deduction function should exist'
);

SELECT function_returns(
    'public',
    'trigger_automatic_inventory_deduction',
    'trigger',
    'trigger_automatic_inventory_deduction should return trigger'
);

SELECT function_lang_is(
    'public',
    'trigger_automatic_inventory_deduction',
    'plpgsql',
    'trigger_automatic_inventory_deduction should be plpgsql'
);

-- Test trigger_aggregate_inventory_usage function exists
SELECT has_function(
    'public',
    'trigger_aggregate_inventory_usage',
    'trigger_aggregate_inventory_usage function should exist'
);

SELECT function_returns(
    'public',
    'trigger_aggregate_inventory_usage',
    'trigger',
    'trigger_aggregate_inventory_usage should return trigger'
);

SELECT function_lang_is(
    'public',
    'trigger_aggregate_inventory_usage',
    'plpgsql',
    'trigger_aggregate_inventory_usage should be plpgsql'
);

-- Test update_updated_at_column function exists
SELECT has_function(
    'public',
    'update_updated_at_column',
    'update_updated_at_column function should exist'
);

SELECT function_returns(
    'public',
    'update_updated_at_column',
    'trigger',
    'update_updated_at_column should return trigger'
);

SELECT function_lang_is(
    'public',
    'update_updated_at_column',
    'plpgsql',
    'update_updated_at_column should be plpgsql'
);

-- Test update_products_search_vector function exists
SELECT has_function(
    'public',
    'update_products_search_vector',
    'update_products_search_vector function should exist'
);

SELECT function_returns(
    'public',
    'update_products_search_vector',
    'trigger',
    'update_products_search_vector should return trigger'
);

SELECT * FROM finish();
ROLLBACK;
