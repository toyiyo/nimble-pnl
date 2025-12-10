# SonarCloud Coverage Configuration

## Files to Exclude from Coverage Analysis

Add these patterns to your `sonar-project.properties` file:

```properties
# Exclude UI components (React components are better tested with E2E)
sonar.coverage.exclusions=\
  src/components/**/*.tsx,\
  src/pages/**/*.tsx,\
  src/contexts/**/*.tsx

# Exclude hooks that primarily wrap Supabase queries (integration tested)
sonar.coverage.exclusions=\
  src/hooks/usePayroll.tsx,\
  src/hooks/useRevenueBreakdown.tsx

# Keep utils for unit testing
# Do NOT exclude:
# - src/utils/payrollCalculations.ts (business logic - needs unit tests)
# - src/utils/compensationCalculations.ts (business logic - needs unit tests)
# - src/lib/restaurantPermissions.ts (access control logic - needs unit tests)
```

## Rationale

### ✅ Should be Unit Tested (Keep in Coverage)
1. **Business Logic** (`src/utils/*.ts`, `src/lib/*.ts`)
   - Pure functions
   - No UI dependencies
   - Fast to test
   - Critical for correctness
   - **Examples**: `payrollCalculations.ts`, `compensationCalculations.ts`, `restaurantPermissions.ts`

2. **Hooks with Complex Logic** (some exceptions)
   - Custom calculation hooks
   - State management hooks
   - **Keep in coverage if they have testable logic**

### ❌ Should be Excluded from Coverage (Add to SonarCloud exclusions)

1. **React Components** (`src/components/**/*.tsx`, `src/pages/**/*.tsx`)
   - **Why**: Better tested with E2E tests (Playwright)
   - **Reason**: Unit testing React components is fragile and time-consuming
   - **Alternative**: E2E tests verify actual user workflows
   - **Examples**: All your components listed in the coverage report

2. **Contexts** (`src/contexts/**/*.tsx`)
   - **Why**: Require full React context tree to test
   - **Reason**: Integration/E2E tests cover these naturally
   - **Alternative**: E2E tests using the actual context

3. **Data Fetching Hooks** (`src/hooks/use*.tsx`)
   - **Why**: Primarily wrappers around Supabase queries
   - **Reason**: Require mocking database, better tested with integration tests
   - **Alternative**: E2E tests or integration tests with real database
   - **Examples**: `usePayroll.tsx`, `useRevenueBreakdown.tsx`

## What TO Test (Increase Coverage)

Based on your report, focus on:

### 1. `src/utils/payrollCalculations.ts` (40.5% → Target: 90%+)
**Missing Coverage**: 
- Lines related to incomplete shifts
- Edge cases in overtime calculation
- Manual payment aggregation

### 2. `src/utils/compensationCalculations.ts` (85.7% → Target: 95%+)
**Missing Coverage**:
- Edge cases in contractor calculations
- Some validation functions

### 3. `src/lib/restaurantPermissions.ts` (0.0% → Target: 90%+)
**Missing**: Entire file needs tests for access control logic

## Summary

**Exclude from SonarCloud**:
- UI Components (`.tsx` files in `components/` and `pages/`)
- Contexts
- Data-fetching hooks

**Increase Coverage**:
- Business logic utils (payroll, compensation)
- Access control logic (restaurantPermissions)
- Pure functions with no UI dependencies

**Testing Strategy**:
- **Unit Tests**: Business logic, calculations, utilities
- **E2E Tests**: User flows, UI interactions, integration points
- **Integration Tests**: Database operations, API calls
