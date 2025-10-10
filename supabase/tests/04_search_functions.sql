-- Tests for search and lookup functions
BEGIN;
SELECT plan(18);

-- Test advanced_product_search function exists
SELECT has_function(
    'public',
    'advanced_product_search',
    ARRAY['uuid', 'text', 'double precision', 'integer'],
    'advanced_product_search function should exist'
);

SELECT function_lang_is(
    'public',
    'advanced_product_search',
    ARRAY['uuid', 'text', 'double precision', 'integer'],
    'plpgsql',
    'advanced_product_search should be plpgsql'
);

SELECT volatility_is(
    'public',
    'advanced_product_search',
    ARRAY['uuid', 'text', 'double precision', 'integer'],
    'stable',
    'advanced_product_search should be stable'
);

-- Test fulltext_product_search function exists
SELECT has_function(
    'public',
    'fulltext_product_search',
    ARRAY['uuid', 'text', 'integer'],
    'fulltext_product_search function should exist'
);

SELECT function_lang_is(
    'public',
    'fulltext_product_search',
    ARRAY['uuid', 'text', 'integer'],
    'plpgsql',
    'fulltext_product_search should be plpgsql'
);

SELECT volatility_is(
    'public',
    'fulltext_product_search',
    ARRAY['uuid', 'text', 'integer'],
    'stable',
    'fulltext_product_search should be stable'
);

-- Test search_products_by_name function exists
SELECT has_function(
    'public',
    'search_products_by_name',
    ARRAY['uuid', 'text'],
    'search_products_by_name function should exist'
);

SELECT function_lang_is(
    'public',
    'search_products_by_name',
    ARRAY['uuid', 'text'],
    'plpgsql',
    'search_products_by_name should be plpgsql'
);

SELECT volatility_is(
    'public',
    'search_products_by_name',
    ARRAY['uuid', 'text'],
    'stable',
    'search_products_by_name should be stable'
);

-- Test find_product_by_gtin function exists
SELECT has_function(
    'public',
    'find_product_by_gtin',
    ARRAY['uuid', 'text'],
    'find_product_by_gtin function should exist'
);

SELECT function_returns(
    'public',
    'find_product_by_gtin',
    ARRAY['uuid', 'text'],
    'uuid',
    'find_product_by_gtin should return uuid'
);

SELECT function_lang_is(
    'public',
    'find_product_by_gtin',
    ARRAY['uuid', 'text'],
    'plpgsql',
    'find_product_by_gtin should be plpgsql'
);

SELECT volatility_is(
    'public',
    'find_product_by_gtin',
    ARRAY['uuid', 'text'],
    'stable',
    'find_product_by_gtin should be stable'
);

-- Test calculate_gs1_check_digit function exists
SELECT has_function(
    'public',
    'calculate_gs1_check_digit',
    ARRAY['text'],
    'calculate_gs1_check_digit function should exist'
);

SELECT function_returns(
    'public',
    'calculate_gs1_check_digit',
    ARRAY['text'],
    'integer',
    'calculate_gs1_check_digit should return integer'
);

SELECT function_lang_is(
    'public',
    'calculate_gs1_check_digit',
    ARRAY['text'],
    'plpgsql',
    'calculate_gs1_check_digit should be plpgsql'
);

SELECT volatility_is(
    'public',
    'calculate_gs1_check_digit',
    ARRAY['text'],
    'immutable',
    'calculate_gs1_check_digit should be immutable'
);

-- Test update_product_searchable_text function exists
SELECT has_function(
    'public',
    'update_product_searchable_text',
    'update_product_searchable_text function should exist'
);

SELECT * FROM finish();
ROLLBACK;
