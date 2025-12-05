# Quick Start: SQL Function Testing

## TL;DR

```bash
# Option 1: If Supabase is already running with migrations applied
npm run test:db

# Option 2: Reset database and run tests (recommended for fresh start)
npm run test:db:reset

# Option 3: Start from scratch
npm run db:start      # Start Supabase (requires Docker)
npm run db:reset      # Apply all migrations
npm run test:db       # Run tests

# Expected output: All tests passed! 🎉
```

## Prerequisites

1. **Docker** - Must be running (`docker ps` to check)
2. **Node.js** - For npm scripts
3. **Supabase CLI** - Installed automatically via npx

## What Gets Tested

✅ All 35 SQL functions in the database  
✅ Function signatures and return types  
✅ Language settings (plpgsql, sql)  
✅ Volatility settings (volatile, stable, immutable)  
✅ Inventory deduction unit conversions (30 tests)

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
| 08_inventory_deduction_conversions.sql | Unit conversions | 30 |
| **TOTAL** | **35+ functions** | **137 tests** |

## Common Issues

### "pgTAP extension not found"
This means migrations haven't been applied. Run:
```bash
npm run db:reset
```

### "Cannot connect to database"
Docker isn't running or Supabase hasn't started:
```bash
# Start Docker first, then:
npm run db:start
```

### "Cannot connect to Docker daemon"
Start Docker Desktop (macOS/Windows) or the Docker service (Linux).

## Running Tests

### All tests at once (recommended)
```bash
npm run test:db
```

### Reset and run (if migrations changed)
```bash
npm run test:db:reset
```

### Single test file (for debugging)
```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -f supabase/tests/08_inventory_deduction_conversions.sql
```

### With custom database
```bash
DB_HOST=localhost \
DB_PORT=5432 \
DB_NAME=mydb \
DB_USER=myuser \
DB_PASSWORD=mypass \
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
