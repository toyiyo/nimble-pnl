# Testing Strategy for Bank Transaction Filtering

This document explains the testing approach for bank transaction filtering, including why E2E tests are critical for catching runtime type errors.

## Problem: Unit Tests vs Runtime Errors

### Why Unit Tests Missed the Issue

The "query.order is not a function" error occurred in production but **wasn't caught by unit tests** because:

1. **Mock Return Values**: Unit tests mock Supabase responses, so the query builder chain never executes
2. **Type Inference**: TypeScript's type checker couldn't catch the async/await issue within the query chain at compile time
3. **No Real Supabase Client**: The actual PostgrestFilterBuilder behavior wasn't exercised

### The Root Cause

```typescript
// ❌ WRONG - This caused runtime error
const applyMetadataFilters = async (query, filters) => {
  if (filters.bankAccountId) {
    // Async operation within query chain
    const { data } = await supabase
      .from('bank_account_balances')
      .select('stripe_financial_account_id')
      .eq('id', filters.bankAccountId)
      .single();
    
    // At this point, TypeScript lost track of the query type
    // query might be Promise<PostgrestFilterBuilder> instead of PostgrestFilterBuilder
    return query.eq('raw_data->account', data?.stripe_financial_account_id);
  }
  return query;
};

// Later in the chain...
query = await applyMetadataFilters(query, filters); // Returns Promise
query = applySorting(query, sortBy, sortOrder);     // query.order is not a function!
```

The issue: When you `await` inside the filter function, TypeScript can't guarantee the query builder methods will exist on the returned value.

## Testing Approach

### 1. Unit Tests (`tests/unit/useBankTransactions.test.ts`)

**Purpose**: Test business logic, filtering logic, and edge cases in isolation.

**What They Catch**:
- ✅ Correct filter query construction (SQL operators, field names)
- ✅ Error handling (missing data, null values, database errors)
- ✅ Edge cases (empty filters, undefined values)
- ✅ Query builder method calls (select, eq, contains, etc.)

**What They Miss**:
- ❌ Runtime type inference issues (async/await in query chains)
- ❌ Actual Supabase client behavior
- ❌ UI interaction bugs (filter dropdown, state management)

**Example**:
```typescript
it('applies bank account filter correctly', async () => {
  const mockBuilder = createQueryBuilder();
  const { result } = renderHook(() => useInfiniteQuery({
    queryKey: ['transactions'],
    queryFn: async ({ pageParam = 0 }) => {
      // Mock returns what we tell it to
      return {
        data: [...],
        count: 2,
        hasMore: false,
      };
    },
  }));
  
  // This passes even if runtime would fail!
  expect(mockBuilder.eq).toHaveBeenCalledWith(
    'raw_data->account',
    'fa_test_123'
  );
});
```

### 2. E2E Tests (`tests/e2e/bank-transaction-filtering.spec.ts`)

**Purpose**: Test the entire feature from UI to database with real interactions.

**What They Catch**:
- ✅ Runtime errors like "query.order is not a function"
- ✅ Type inference issues in query builder chains
- ✅ UI filter interactions (dropdowns, selections)
- ✅ Correct account display after filtering
- ✅ Data loading states and empty states
- ✅ Integration between components and hooks

**What They Provide**:
- Real Supabase client with actual query builder
- Real browser environment with user interactions
- Full application context (routing, auth, state management)

**Example Tests**:
```typescript
test('filters transactions by bank account', async ({ page }) => {
  // Seed real data in Supabase
  await seedBankAccounts(restaurantId);
  await seedTransactions(restaurantId);
  
  // Navigate to page
  await page.goto('/banking/transactions');
  
  // Interact with filter UI
  await page.click('button:has-text("Bank Account")');
  await page.click('text=Checking Account');
  
  // Verify filtered results
  expect(await page.locator('[data-testid="bank-transaction-row"]').count())
    .toBe(2);
});

test('handles query builder chain without errors', async ({ page }) => {
  // Listen for console errors
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  // Trigger filter that uses query builder chain
  await applyFilter();
  
  // Verify no "query.order is not a function" errors
  expect(errors.filter(e => e.includes('.order is not a function')))
    .toHaveLength(0);
});
```

## Recommended Testing Workflow

### For New Features

1. **Start with E2E test** (describes full user flow)
2. **Add unit tests** (cover edge cases and error handling)
3. **Run both** before merging

### For Bug Fixes

1. **Write E2E test** that reproduces the bug
2. **Verify test fails** with current code
3. **Fix the bug**
4. **Verify E2E test passes**
5. **Add unit tests** for specific edge cases revealed by the bug

## Running Tests

### Unit Tests
```bash
# Run all unit tests
npm run test

# Run specific file
npm run test -- tests/unit/useBankTransactions.test.ts

# Watch mode
npm run test -- --watch

# Coverage
npm run test:coverage
```

### E2E Tests
```bash
# Run all E2E tests
npm run test:e2e

# Run specific file
npx playwright test tests/e2e/bank-transaction-filtering.spec.ts

# Debug mode
npx playwright test --debug

# UI mode
npx playwright test --ui
```

### Full Test Suite
```bash
# Run everything
npm run test -- --run && npm run test:e2e
```

## Test Coverage Goals

### Unit Tests
- ✅ All query building functions (`applyMetadataFilters`, `applySorting`, etc.)
- ✅ Error scenarios (missing data, null values, network errors)
- ✅ Edge cases (empty strings, undefined, special characters)
- ✅ Filter combinations (multiple filters at once)

### E2E Tests
- ✅ Happy path: Filter by account, see correct results
- ✅ Account display: Show correct account info in rows
- ✅ Empty state: Filter that returns no results
- ✅ Error handling: Runtime errors are caught and logged
- ✅ Filter clearing: Return to unfiltered state
- ✅ Multiple accounts: Switch between different account filters

## Type Safety Best Practices

### DO ✅

```typescript
// Keep query building synchronous
const applyFilters = (query, stripeAccountId) => {
  if (stripeAccountId) {
    return query.eq('raw_data->account', stripeAccountId);
  }
  return query;
};

// Pre-fetch async data before query chain
const stripeAccountId = await fetchStripeAccountId(bankAccountId);
let query = buildBaseQuery();
query = applyFilters(query, stripeAccountId);
query = applySorting(query);
```

### DON'T ❌

```typescript
// Don't mix async/await with query builder chain
const applyFilters = async (query, bankAccountId) => {
  if (bankAccountId) {
    const { data } = await supabase.from('accounts').select('*');
    return query.eq('field', data.value); // Type lost!
  }
  return query;
};

// Don't await in the middle of query chain
query = await applyFilters(query, id); // Breaks chain!
query = applySorting(query);           // Error!
```

## Debugging Failed Tests

### Unit Test Failures

1. Check mock setup (correct return values?)
2. Verify query builder method calls
3. Check test data matches expected format

### E2E Test Failures

1. **View HTML report**: `npx playwright show-report`
2. **Check screenshots**: `test-results/*/test-failed-*.png`
3. **Watch video**: `test-results/*/video.webm`
4. **Debug interactively**: `npx playwright test --debug`

### Common E2E Issues

| Issue | Solution |
|-------|----------|
| "Element not found" | Add `{ timeout: 10000 }` or wait for selector |
| "Test data missing" | Check seed function completed successfully |
| "Filter not working" | Verify UI elements have correct test IDs |
| "Flaky test" | Add explicit waits, check for race conditions |

## Integration with CI/CD

### GitHub Actions Workflow

```yaml
- name: Run unit tests
  run: npm run test -- --run

- name: Run E2E tests
  run: npx playwright test
  
- name: Upload test results
  if: failure()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

### Pre-commit Hook

```bash
# .husky/pre-commit
npm run test -- --run
```

## Summary

**Unit tests** are fast and great for logic, but they **can't catch runtime type errors** caused by async/await in query builder chains.

**E2E tests** are slower but essential for catching:
- Runtime type inference issues
- UI interaction bugs  
- Integration problems
- Production-like error scenarios

**Always use both** for comprehensive coverage of critical features like transaction filtering.
