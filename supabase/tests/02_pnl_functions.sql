-- Tests for P&L calculation functions
BEGIN;
SELECT plan(13);

-- Test calculate_daily_pnl function exists
SELECT has_function(
    'public',
    'calculate_daily_pnl',
    ARRAY['uuid', 'date'],
    'calculate_daily_pnl function should exist'
);

SELECT function_returns(
    'public',
    'calculate_daily_pnl',
    ARRAY['uuid', 'date'],
    'uuid',
    'calculate_daily_pnl should return uuid'
);

SELECT function_lang_is(
    'public',
    'calculate_daily_pnl',
    ARRAY['uuid', 'date'],
    'plpgsql',
    'calculate_daily_pnl should be plpgsql'
);

SELECT volatility_is(
    'public',
    'calculate_daily_pnl',
    ARRAY['uuid', 'date'],
    'volatile',
    'calculate_daily_pnl should be volatile'
);

-- Test calculate_square_daily_pnl function exists
SELECT has_function(
    'public',
    'calculate_square_daily_pnl',
    ARRAY['uuid', 'date'],
    'calculate_square_daily_pnl function should exist'
);

SELECT function_returns(
    'public',
    'calculate_square_daily_pnl',
    ARRAY['uuid', 'date'],
    'uuid',
    'calculate_square_daily_pnl should return uuid'
);

SELECT function_lang_is(
    'public',
    'calculate_square_daily_pnl',
    ARRAY['uuid', 'date'],
    'plpgsql',
    'calculate_square_daily_pnl should be plpgsql'
);

-- Test calculate_recipe_cost function exists
SELECT has_function(
    'public',
    'calculate_recipe_cost',
    ARRAY['uuid'],
    'calculate_recipe_cost function should exist'
);

SELECT function_returns(
    'public',
    'calculate_recipe_cost',
    ARRAY['uuid'],
    'numeric',
    'calculate_recipe_cost should return numeric'
);

SELECT function_lang_is(
    'public',
    'calculate_recipe_cost',
    ARRAY['uuid'],
    'plpgsql',
    'calculate_recipe_cost should be plpgsql'
);

SELECT volatility_is(
    'public',
    'calculate_recipe_cost',
    ARRAY['uuid'],
    'stable',
    'calculate_recipe_cost should be stable'
);

-- Test get_product_cost_per_recipe_unit function exists
SELECT has_function(
    'public',
    'get_product_cost_per_recipe_unit',
    ARRAY['uuid'],
    'get_product_cost_per_recipe_unit function should exist'
);

SELECT function_returns(
    'public',
    'get_product_cost_per_recipe_unit',
    ARRAY['uuid'],
    'numeric',
    'get_product_cost_per_recipe_unit should return numeric'
);

SELECT * FROM finish();
ROLLBACK;
