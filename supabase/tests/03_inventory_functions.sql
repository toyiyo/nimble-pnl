-- Tests for inventory-related functions
BEGIN;
SELECT plan(13);

-- Test simulate_inventory_deduction function exists
SELECT has_function(
    'public',
    'simulate_inventory_deduction',
    ARRAY['uuid', 'text', 'integer'],
    'simulate_inventory_deduction function should exist'
);

SELECT function_returns(
    'public',
    'simulate_inventory_deduction',
    ARRAY['uuid', 'text', 'integer'],
    'jsonb',
    'simulate_inventory_deduction should return jsonb'
);

SELECT function_lang_is(
    'public',
    'simulate_inventory_deduction',
    ARRAY['uuid', 'text', 'integer'],
    'plpgsql',
    'simulate_inventory_deduction should be plpgsql'
);

-- Test process_inventory_deduction function exists (FIXED: added p_sale_date text parameter)
SELECT has_function(
    'public',
    'process_inventory_deduction',
    ARRAY['uuid', 'text', 'integer', 'text'],
    'process_inventory_deduction function should exist'
);

SELECT function_returns(
    'public',
    'process_inventory_deduction',
    ARRAY['uuid', 'text', 'integer', 'text'],
    'jsonb',
    'process_inventory_deduction should return jsonb'
);

SELECT function_lang_is(
    'public',
    'process_inventory_deduction',
    ARRAY['uuid', 'text', 'integer', 'text'],
    'plpgsql',
    'process_inventory_deduction should be plpgsql'
);

-- Test process_unified_inventory_deduction function exists (FIXED: changed timestamp to text, added external_order_id)
SELECT has_function(
    'public',
    'process_unified_inventory_deduction',
    ARRAY['uuid', 'text', 'integer', 'text', 'text'],
    'process_unified_inventory_deduction function should exist'
);

SELECT function_returns(
    'public',
    'process_unified_inventory_deduction',
    ARRAY['uuid', 'text', 'integer', 'text', 'text'],
    'jsonb',
    'process_unified_inventory_deduction should return jsonb'
);

-- Test aggregate_inventory_usage_to_daily_food_costs function exists
SELECT has_function(
    'public',
    'aggregate_inventory_usage_to_daily_food_costs',
    ARRAY['uuid', 'date'],
    'aggregate_inventory_usage_to_daily_food_costs function should exist'
);

SELECT function_returns(
    'public',
    'aggregate_inventory_usage_to_daily_food_costs',
    ARRAY['uuid', 'date'],
    'void',
    'aggregate_inventory_usage_to_daily_food_costs should return void'
);

SELECT function_lang_is(
    'public',
    'aggregate_inventory_usage_to_daily_food_costs',
    ARRAY['uuid', 'date'],
    'plpgsql',
    'aggregate_inventory_usage_to_daily_food_costs should be plpgsql'
);


-- Test set_preferred_product_supplier function exists (FIXED: added p_restaurant_id parameter)
SELECT has_function(
    'public',
    'set_preferred_product_supplier',
    ARRAY['uuid', 'uuid', 'uuid'],
    'set_preferred_product_supplier function should exist'
);

SELECT function_returns(
    'public',
    'set_preferred_product_supplier',
    ARRAY['uuid', 'uuid', 'uuid'],
    'void',
    'set_preferred_product_supplier should return void'
);

SELECT * FROM finish();
ROLLBACK;
