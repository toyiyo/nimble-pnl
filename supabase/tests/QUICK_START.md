# Quick Start: SQL Function Testing

## TL;DR

```bash
# Run all tests
cd supabase/tests
./run_tests.sh

# Expected output: All tests passed! 🎉
```

## What Gets Tested

✅ All 35 SQL functions in the database  
✅ Function signatures and return types  
✅ Language settings (plpgsql, sql)  
✅ Volatility settings (volatile, stable, immutable)  

## Test Files

| File | Functions Tested | Test Count |
|------|-----------------|------------|
| 00_setup_check.sql | Environment setup | 5 |
| 01_sales_functions.sql | Sales & aggregation | 12 |
| 02_pnl_functions.sql | P&L calculations | 13 |
| 03_inventory_functions.sql | Inventory management | 15 |
| 04_search_functions.sql | Search & lookup | 18 |
| 05_trigger_functions.sql | Database triggers | 17 |
| 06_security_functions.sql | Auth & security | 15 |
| 07_utility_functions.sql | Utilities & cleanup | 12 |
| **TOTAL** | **35 functions** | **107 tests** |

## Prerequisites

- PostgreSQL database (local or remote)
- pgTAP extension installed
- psql command-line tool

## Installation

The pgTAP extension is automatically installed via migration:
```bash
psql -d your_database -f supabase/migrations/20251010223450_enable_pgtap.sql
```

Or manually:
```sql
CREATE EXTENSION IF NOT EXISTS pgtap;
```

## Running Tests

### All tests at once
```bash
./run_tests.sh
```

### Single test file
```bash
psql -d your_database -f 01_sales_functions.sql
```

### With environment variables
```bash
DB_HOST=localhost \
DB_PORT=5432 \
DB_NAME=postgres \
DB_USER=postgres \
DB_PASSWORD=your_password \
./run_tests.sh
```

## Understanding Results

### ✅ Success
```
Running: 01_sales_functions.sql
✓ 12 tests passed

All tests passed! 🎉
```

### ❌ Failure
```
Running: 01_sales_functions.sql
✗ 1 tests failed, 11 passed
not ok 5 - function should return integer

Some tests failed 😞
```

## CI/CD

Tests run automatically on:
- Push to `main` or `develop`
- Pull requests
- Manual workflow trigger

GitHub Actions workflow: `.github/workflows/test-sql-functions.yml`

## Common Issues

### "pgTAP extension not found"
```bash
# Apply the migration
psql -d your_database -f supabase/migrations/20251010223450_enable_pgtap.sql
```

### "Connection refused"
```bash
# Check your database is running and credentials are correct
psql -h localhost -U postgres -d postgres -c "SELECT 1;"
```

### "Function not found"
```bash
# Ensure all migrations are applied
psql -d your_database -f supabase/migrations/*.sql
```

## Adding New Tests

1. Add your function in a migration file
2. Add tests to appropriate test file
3. Update the plan count
4. Run tests to verify

Example:
```sql
-- In 01_sales_functions.sql
SELECT plan(13);  -- Increment this

SELECT has_function(
    'public',
    'your_new_function',
    ARRAY['uuid', 'text'],
    'your_new_function should exist'
);
```

## Need More Help?

- See [README.md](README.md) for detailed documentation
- See [TESTING_GUIDE.md](TESTING_GUIDE.md) for comprehensive guide
- Check [pgTAP documentation](https://pgtap.org/)

## Quick Commands Reference

```bash
# Run all tests
./run_tests.sh

# Run specific test
psql -d db_name -f 01_sales_functions.sql

# Check pgTAP installation
psql -d db_name -c "SELECT extname FROM pg_extension WHERE extname='pgtap';"

# List all functions
psql -d db_name -c "SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace;"

# Apply all migrations
for f in ../migrations/*.sql; do psql -d db_name -f "$f"; done
```
