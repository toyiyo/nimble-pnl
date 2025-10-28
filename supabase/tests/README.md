# SQL Function Tests

This directory contains comprehensive tests for all PostgreSQL functions in the EasyShiftHQ database using pgTAP.

## Overview

pgTAP is a unit testing framework for PostgreSQL that provides a TAP (Test Anything Protocol) output format. These tests verify that all SQL functions:
- Exist in the database
- Have correct return types
- Use the appropriate language (plpgsql, sql, etc.)
- Have the correct volatility settings (volatile, stable, immutable)
- Are defined with proper security settings

## Test Organization

Tests are organized by functional area:

- **01_sales_functions.sql** - Sales data synchronization and aggregation functions
- **02_pnl_functions.sql** - Profit & Loss calculation functions
- **03_inventory_functions.sql** - Inventory management and deduction functions
- **04_search_functions.sql** - Product search and lookup functions
- **05_trigger_functions.sql** - Database trigger functions
- **06_security_functions.sql** - Authentication and authorization functions
- **07_utility_functions.sql** - Maintenance and utility functions

## Running Tests

### Prerequisites

1. pgTAP extension must be enabled in your database (done via migration `20251010223450_enable_pgtap.sql`)
2. Database must be accessible with appropriate credentials

### Using psql

Run all tests:
```bash
psql -d your_database -f supabase/tests/01_sales_functions.sql
psql -d your_database -f supabase/tests/02_pnl_functions.sql
psql -d your_database -f supabase/tests/03_inventory_functions.sql
psql -d your_database -f supabase/tests/04_search_functions.sql
psql -d your_database -f supabase/tests/05_trigger_functions.sql
psql -d your_database -f supabase/tests/06_security_functions.sql
psql -d your_database -f supabase/tests/07_utility_functions.sql
```

Run all tests at once:
```bash
for test_file in supabase/tests/*.sql; do
    echo "Running $test_file..."
    psql -d your_database -f "$test_file"
done
```

### Using Supabase CLI

If you have Supabase CLI installed:
```bash
supabase db test
```

### Using pg_prove

For TAP-formatted output:
```bash
pg_prove -d your_database supabase/tests/*.sql
```

## Test Coverage

This test suite covers all 35 SQL functions:

### Sales Functions (4)
- sync_square_to_unified_sales
- aggregate_unified_sales_to_daily
- bulk_process_historical_sales
- check_sale_already_processed

### P&L Functions (4)
- calculate_daily_pnl
- calculate_square_daily_pnl
- calculate_recipe_cost
- get_product_cost_per_recipe_unit

### Inventory Functions (6)
- simulate_inventory_deduction
- process_inventory_deduction
- process_unified_inventory_deduction
- aggregate_inventory_usage_to_daily_food_costs
- upsert_product_supplier
- set_preferred_product_supplier

### Search Functions (6)
- advanced_product_search
- fulltext_product_search
- search_products_by_name
- find_product_by_gtin
- calculate_gs1_check_digit
- update_product_searchable_text

### Trigger Functions (6)
- trigger_unified_sales_aggregation
- trigger_calculate_pnl
- trigger_automatic_inventory_deduction
- trigger_aggregate_inventory_usage
- update_updated_at_column
- update_products_search_vector

### Security Functions (5)
- handle_new_user
- create_restaurant_with_owner
- is_restaurant_owner
- hash_invitation_token
- log_security_event

### Utility Functions (4)
- cleanup_expired_invitations
- cleanup_old_audit_logs
- cleanup_rate_limit_logs
- trigger_square_periodic_sync

## Test Types

Each test file validates:

1. **Function Existence**: Ensures functions are defined in the schema
2. **Return Types**: Validates correct return type signatures
3. **Language**: Confirms functions use the correct procedural language
4. **Volatility**: Checks if functions are marked as volatile, stable, or immutable
5. **Security**: Verifies SECURITY DEFINER settings where applicable

## Adding New Tests

When adding new SQL functions:

1. Add the function definition in a migration file
2. Add corresponding tests to the appropriate test file
3. Update the plan count at the top of the test file
4. Document the function in this README

### Test Template

```sql
-- Test function_name function exists
SELECT has_function(
    'public',
    'function_name',
    ARRAY['param_type1', 'param_type2'],
    'function_name function should exist'
);

SELECT function_returns(
    'public',
    'function_name',
    ARRAY['param_type1', 'param_type2'],
    'return_type',
    'function_name should return return_type'
);

SELECT function_lang_is(
    'public',
    'function_name',
    ARRAY['param_type1', 'param_type2'],
    'plpgsql',
    'function_name should be plpgsql'
);
```

## Continuous Integration

These tests should be run:
- Before deploying database migrations
- As part of CI/CD pipeline
- After any schema changes
- Regularly as part of test suite

## Troubleshooting

### Test Failures

If a test fails:
1. Check that all migrations have been applied
2. Verify the function exists in the public schema
3. Check function signature matches test expectations
4. Review recent migration changes

### Missing pgTAP Extension

If you get errors about missing pgTAP functions:
```sql
CREATE EXTENSION IF NOT EXISTS pgtap;
```

Or apply the migration:
```bash
psql -d your_database -f supabase/migrations/20251010223450_enable_pgtap.sql
```

## Resources

- [pgTAP Documentation](https://pgtap.org/)
- [PostgreSQL Testing](https://www.postgresql.org/docs/current/regress.html)
- [TAP Protocol](https://testanything.org/)
