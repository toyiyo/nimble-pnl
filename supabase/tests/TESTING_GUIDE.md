# SQL Function Testing Guide

## Overview

This guide provides comprehensive information about testing all SQL functions in the Nimble PnL database.

## Test Coverage Summary

### Total Coverage
- **35 SQL functions** are under test
- **107 individual test cases** across 8 test suites
- **100% function coverage** - all database functions have at least basic existence and signature tests

## Test Suites

### 00_setup_check.sql (5 tests)
Validates that the testing environment is properly configured:
- pgTAP extension is installed
- Public schema exists
- Functions are accessible
- Minimum function count is met

### 01_sales_functions.sql (12 tests)
Tests for sales data synchronization and aggregation:
- `sync_square_to_unified_sales(p_restaurant_id uuid)` → integer
- `aggregate_unified_sales_to_daily(p_restaurant_id uuid, p_date date)` → void
- `bulk_process_historical_sales(p_restaurant_id uuid, p_start_date date, p_end_date date)` → integer
- `check_sale_already_processed(p_restaurant_id uuid, p_order_id text, p_item_id text, p_sale_time timestamptz)` → boolean

**What's tested:**
- Function existence and signatures
- Return types
- Language (plpgsql)
- Volatility settings

### 02_pnl_functions.sql (13 tests)
Tests for profit and loss calculations:
- `calculate_daily_pnl(p_restaurant_id uuid, p_date date)` → uuid
- `calculate_square_daily_pnl(p_restaurant_id uuid, p_service_date date)` → uuid
- `calculate_recipe_cost(recipe_id uuid)` → numeric
- `get_product_cost_per_recipe_unit(product_id uuid)` → numeric

**What's tested:**
- Function existence and signatures
- Return types (uuid, numeric)
- Language (plpgsql)
- Volatility settings (volatile, stable)

### 03_inventory_functions.sql (15 tests)
Tests for inventory management:
- `simulate_inventory_deduction(p_restaurant_id uuid, p_pos_item_name text, p_quantity_sold integer)` → jsonb
- `process_inventory_deduction(p_restaurant_id uuid, p_pos_item_name text, p_quantity_sold integer)` → jsonb
- `process_unified_inventory_deduction(p_restaurant_id uuid, p_pos_item_name text, p_quantity_sold integer, p_sale_time timestamptz)` → jsonb
- `aggregate_inventory_usage_to_daily_food_costs(p_restaurant_id uuid, p_date date)` → void
- `upsert_product_supplier(p_product_id uuid, p_supplier_id uuid, p_supplier_sku text, p_cost_per_unit numeric, p_is_preferred boolean)` → uuid
- `set_preferred_product_supplier(p_product_id uuid, p_supplier_id uuid)` → void

**What's tested:**
- Function existence and signatures
- Return types (jsonb, void, uuid)
- Language (plpgsql)
- Parameter handling

### 04_search_functions.sql (18 tests)
Tests for product search and lookup:
- `advanced_product_search(p_restaurant_id uuid, p_search_term text, p_similarity_threshold double precision, p_limit integer)` → TABLE
- `fulltext_product_search(p_restaurant_id uuid, p_search_term text, p_limit integer)` → TABLE
- `search_products_by_name(p_restaurant_id uuid, p_search_term text)` → TABLE
- `find_product_by_gtin(p_restaurant_id uuid, p_gtin text)` → uuid
- `calculate_gs1_check_digit(p_gtin text)` → integer
- `update_product_searchable_text()` → trigger

**What's tested:**
- Function existence and signatures
- Return types including TABLE returns
- Language (plpgsql)
- Volatility settings (stable, immutable)

### 05_trigger_functions.sql (17 tests)
Tests for database trigger functions:
- `trigger_unified_sales_aggregation()` → trigger
- `trigger_calculate_pnl()` → trigger
- `trigger_automatic_inventory_deduction()` → trigger
- `trigger_aggregate_inventory_usage()` → trigger
- `update_updated_at_column()` → trigger
- `update_products_search_vector()` → trigger

**What's tested:**
- Trigger function existence
- Return type (trigger)
- Language (plpgsql)
- Proper trigger configuration

### 06_security_functions.sql (15 tests)
Tests for authentication and authorization:
- `handle_new_user()` → trigger
- `create_restaurant_with_owner(p_user_id uuid, p_restaurant_name text)` → uuid
- `is_restaurant_owner(p_user_id uuid, p_restaurant_id uuid)` → boolean
- `hash_invitation_token(p_token text)` → text
- `log_security_event(p_user_id uuid, p_event_type text, p_event_description text, p_metadata jsonb)` → void

**What's tested:**
- Function existence and signatures
- Return types (trigger, uuid, boolean, text, void)
- Language (plpgsql)
- Security-related functionality

### 07_utility_functions.sql (12 tests)
Tests for maintenance and utility functions:
- `cleanup_expired_invitations()` → integer
- `cleanup_old_audit_logs(p_retention_period interval)` → integer
- `cleanup_rate_limit_logs(p_retention_period interval)` → integer
- `trigger_square_periodic_sync()` → void

**What's tested:**
- Function existence and signatures
- Return types (integer, void)
- Language (plpgsql)
- Volatility settings

## Testing Methodology

### What We Test

1. **Function Existence**: Verify all functions are defined in the public schema
2. **Function Signatures**: Validate parameter types and counts
3. **Return Types**: Confirm correct return type declarations
4. **Language**: Ensure functions use appropriate procedural language
5. **Volatility**: Check if functions are correctly marked as:
   - VOLATILE: Can modify database (default)
   - STABLE: Won't modify database within a transaction
   - IMMUTABLE: Always returns same result for same input

### What We Don't Test (Yet)

Current test suite focuses on function metadata and signatures. Future enhancements could include:
- Unit tests with sample data
- Integration tests with real scenarios
- Performance benchmarking
- Edge case testing
- Error handling validation

## Running Tests

### Quick Start
```bash
cd supabase/tests
./run_tests.sh
```

### Individual Test Suite
```bash
psql -d your_database -f supabase/tests/01_sales_functions.sql
```

### CI/CD Integration
Tests run automatically on:
- Push to main or develop branches
- Pull requests affecting SQL files
- Manual workflow dispatch

See `.github/workflows/test-sql-functions.yml` for CI configuration.

## Interpreting Results

### Success Output
```
ok 1 - sync_square_to_unified_sales function should exist
ok 2 - sync_square_to_unified_sales should return integer
...
1..12
All 12 tests passed
```

### Failure Output
```
ok 1 - function exists
not ok 2 - function should return integer
#   Failed test 'function should return integer'
#   Expected: integer
#   Got: void
```

## Troubleshooting

### Common Issues

**pgTAP not installed:**
```sql
CREATE EXTENSION IF NOT EXISTS pgtap;
```
Or run migration: `20251010223450_enable_pgtap.sql`

**Test fails after migration:**
- Check if function signature changed
- Update test to match new signature
- Verify function is in public schema

**Connection issues:**
- Check database credentials
- Verify database is running
- Confirm network access

## Maintenance

### Adding Tests for New Functions

1. Identify the functional category
2. Add tests to appropriate file (or create new file)
3. Update plan count
4. Run tests to verify
5. Update this documentation

### Test Template
```sql
-- Test new_function_name function exists
SELECT has_function(
    'public',
    'new_function_name',
    ARRAY['param_type1', 'param_type2'],
    'new_function_name function should exist'
);

SELECT function_returns(
    'public',
    'new_function_name',
    ARRAY['param_type1', 'param_type2'],
    'return_type',
    'new_function_name should return return_type'
);

SELECT function_lang_is(
    'public',
    'new_function_name',
    ARRAY['param_type1', 'param_type2'],
    'plpgsql',
    'new_function_name should be plpgsql'
);
```

## Best Practices

1. **Keep tests focused**: One test file per functional area
2. **Use descriptive names**: Test descriptions should clearly state what's being tested
3. **Update plan count**: Always match the number of SELECT tests
4. **Test in transactions**: Use BEGIN/ROLLBACK to keep database clean
5. **Document changes**: Update this guide when adding new tests

## Resources

- [pgTAP Documentation](https://pgtap.org/)
- [PostgreSQL Function Documentation](https://www.postgresql.org/docs/current/sql-createfunction.html)
- [TAP Protocol](https://testanything.org/)
- [Supabase Testing](https://supabase.com/docs/guides/database/testing)

## Future Enhancements

Planned improvements to the test suite:
- [ ] Add functional tests with sample data
- [ ] Test error conditions and edge cases
- [ ] Add performance benchmarks
- [ ] Test transaction behavior
- [ ] Validate RLS policies
- [ ] Test trigger execution
- [ ] Add data integrity tests
