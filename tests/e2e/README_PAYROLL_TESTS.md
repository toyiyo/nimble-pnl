# Payroll E2E Test Suite

## Overview

Comprehensive end-to-end tests for the complete payroll journey, covering employee creation, payment processing, and data visualization across the application.

## Test Files

### `employee-payroll.spec.ts`
Basic employee creation and payroll page tests:
- Hourly employee creation and display
- Salaried employee creation with pay period selection
- Contractor creation with payment intervals
- Mixed workforce scenarios
- Per-job contractor manual payments

### `payroll-complete-journey.spec.ts` (NEW)
**Complete user journey tests** covering the full payroll lifecycle:

#### Test Scenarios

1. **Full Journey Test**
   - Creates employees of all types (hourly, salary, contractor)
   - Adds time punches for hourly employees
   - Triggers daily allocation generation (simulates cron job)
   - Verifies labor costs appear in Dashboard
   - Verifies payroll details in Payroll page
   - Verifies data in Reports

2. **Employee Portal Test**
   - Creates salaried employee with email
   - Tests employee self-service portal access
   - Verifies employee can view their own pay information

3. **Termination Flow Test**
   - Creates salaried employee
   - Sets termination date
   - Verifies allocations stop after termination date
   - Tests that terminated employees show correct status

4. **Dashboard Aggregation Test**
   - Creates multiple employees with known compensation amounts
   - Triggers allocation generation
   - Verifies Dashboard correctly aggregates and displays labor costs
   - Tests all labor cost types (hourly wages, salary allocations, contractor payments)

## Running Tests

### Run All Payroll Tests
```bash
npm run test:e2e -- tests/e2e/employee-payroll.spec.ts tests/e2e/payroll-complete-journey.spec.ts
```

### Run Individual Test Files
```bash
# Original payroll tests
npm run test:e2e -- tests/e2e/employee-payroll.spec.ts

# Complete journey tests
npm run test:e2e -- tests/e2e/payroll-complete-journey.spec.ts
```

### Run Specific Test
```bash
npm run test:e2e -- tests/e2e/payroll-complete-journey.spec.ts -g "Full journey"
```

### Debug Mode
```bash
npm run test:e2e -- tests/e2e/payroll-complete-journey.spec.ts --debug
```

## Test Coverage

### Employee Types
- ✅ Hourly employees with time punches
- ✅ Salaried employees with daily allocations
- ✅ Contractors with monthly/weekly/bi-weekly payments
- ✅ Per-job contractors with manual payments

### Payment Triggers
- ✅ Time punches for hourly employees
- ✅ Automatic daily allocations via cron job simulation
- ✅ Manual payments for per-job contractors

### Data Verification Points
- ✅ Dashboard - Labor cost cards and summaries
- ✅ Payroll Page - Detailed employee breakdown
- ✅ Reports - Labor costs in P&L and other reports
- ✅ Employee Portal - Self-service pay view (manager view)

### Business Logic
- ✅ Salary pro-rating (monthly → daily)
- ✅ Contractor payment allocations
- ✅ Hourly wage calculations
- ✅ Employee termination date handling
- ✅ Multi-employee aggregation

## Test Data

### Generated Employees
Each test creates unique employees with timestamps to avoid conflicts:
- Hourly: $18-20/hour
- Salary: $3,000-6,000/month
- Contractor: $2,000-3,000/month

### Test Calculations
Examples of expected values:
- **Salary**: $4,000/month ÷ 30 days = $133.33/day
- **Contractor**: $3,000/month ÷ 30 days = $100/day
- **Hourly**: 8 hours × $18/hour = $144/day

## Known Limitations

1. **Cron Job Simulation**: Tests call the Edge Function directly instead of waiting for actual cron execution
2. **Time Punches**: Currently simulated via page evaluation; could be enhanced to use EmployeeClock page
3. **Employee Login**: Tests use manager view of employee portal; separate employee authentication not yet implemented
4. **Reports**: Report navigation depends on UI structure; may need updates if report page changes

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:
- Uses local Supabase instance (configurable via env vars)
- Generates unique test data per run
- Cleans up by clearing cookies between tests
- Timeouts configured for async operations

## Debugging Tips

### Test Fails at Employee Creation
- Check EmployeeDialog component labels match test selectors
- Verify compensation type dropdown is functional
- Ensure validation rules allow test data

### Test Fails at Allocation Generation
- Verify Edge Function is deployed: `npx supabase functions deploy generate-daily-allocations`
- Check migration is applied: `npx supabase db push`
- Confirm `daily_labor_allocations` table exists

### Test Fails at Dashboard/Payroll View
- Check React Query cache invalidation
- Verify RLS policies allow data access
- Ensure `staleTime` is short enough (<60s)

### Test Fails at Termination Flow
- Verify `termination_date` column exists on `employees` table
- Check SQL function respects termination date logic
- Confirm UI shows termination date field when status is "terminated"

## Future Enhancements

- [ ] Add tests for bi-weekly and semi-monthly pay periods
- [ ] Test payroll period navigation (previous/next week)
- [ ] Test CSV export functionality
- [ ] Add tests for employee tip distributions
- [ ] Test bulk employee operations
- [ ] Add performance benchmarks
- [ ] Test concurrent allocation generation
- [ ] Add visual regression tests for payroll cards

## Related Documentation

- [JUST_IN_TIME_ALLOCATIONS.md](../../docs/JUST_IN_TIME_ALLOCATIONS.md) - Allocation system architecture
- [PAYROLL_IMPLEMENTATION.md](../../docs/PAYROLL_IMPLEMENTATION.md) - Payroll feature overview
- [UNIT_CONVERSIONS.md](../../docs/UNIT_CONVERSIONS.md) - Unit conversion system (for inventory deductions)
