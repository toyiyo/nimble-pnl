# Payroll Tip Calculation Bug Fix

## Issue
Payroll was displaying **$35 in tips** instead of the expected **$3,500** for employees with multiple approved tip splits.

## Root Cause
Unit mismatch between `usePayroll.tsx` and `payrollCalculations.ts`:

1. **`computeTipTotals` in `usePayroll.tsx`**: Converted cents to dollars by dividing by 100
2. **`calculateEmployeePay` in `payrollCalculations.ts`**: Expected tips in **cents**, not dollars
3. **Result**: Tips were divided by 100 twice (once in `computeTipTotals`, once when displaying)

### Example of the Bug
```
Database: 7 tip splits × 50,000 cents = 350,000 cents ($3,500)
↓
computeTipTotals: 350,000 / 100 = 3,500 (dollars) ❌
↓
calculateEmployeePay receives: 3,500 (thinks it's cents)
↓
Display: formatCurrency(3500 / 100) = $35 ❌❌
```

## Solution
Modified `aggregateTips` and `computeTipTotals` to **keep values in cents** throughout:

### Before (Incorrect)
```typescript
// aggregateTips - WRONG
tipItems.forEach(({ employee_id, amount }) => {
  const current = tipsPerEmployee.get(employee_id) || 0;
  tipsPerEmployee.set(employee_id, current + amount / 100); // ❌ Converting to dollars
});

// computeTipTotals - WRONG
const current = base.get(emp.id) || 0;
base.set(emp.id, current + cents / 100); // ❌ Converting to dollars
```

### After (Correct)
```typescript
// aggregateTips - CORRECT
tipItems.forEach(({ employee_id, amount }) => {
  const current = tipsPerEmployee.get(employee_id) || 0;
  tipsPerEmployee.set(employee_id, current + amount); // ✅ Keep in cents
});

// computeTipTotals - CORRECT
const current = base.get(emp.id) || 0;
base.set(emp.id, current + cents); // ✅ Keep in cents
```

## Files Modified
1. **`src/hooks/usePayroll.tsx`**:
   - `aggregateTips()`: Now returns cents instead of dollars
   - `computeTipTotals()`: Now returns cents instead of dollars
   - Updated comments to clarify return type is cents

2. **`tests/unit/usePayroll.test.ts`**:
   - Updated all assertions to expect cents
   - Fixed test descriptions

3. **`tests/unit/usePayroll-tip-calculation.test.ts`** (new file):
   - Comprehensive test suite with 14 tests
   - Tests multiple tip splits to single employee (the bug scenario)
   - Tests edge cases: rounding, active vs terminated employees, mixed sources

## Verification
All 14 tests pass:
```bash
✓ tests/unit/usePayroll.test.ts (4 tests)
✓ tests/unit/usePayroll-tip-calculation.test.ts (10 tests)
```

### Test Coverage
- ✅ Single employee with multiple splits (the bug case)
- ✅ Multiple employees splitting tips evenly
- ✅ Mixed tip sources (items + legacy + fallback)
- ✅ Rounding preservation to last employee
- ✅ Active vs terminated employee filtering
- ✅ Zero amounts and empty arrays
- ✅ Date range filtering documentation

## Expected Behavior Now
With 7 approved tip splits of $500 each (50,000 cents):
```
Database: 7 × 50,000 cents = 350,000 cents
↓
computeTipTotals: 350,000 cents (no conversion) ✅
↓
calculateEmployeePay receives: 350,000 cents ✅
↓
Display: formatCurrency(350000 / 100) = $3,500.00 ✅
```

## Related Documentation
- Unit conversion system: `docs/UNIT_CONVERSIONS.md`
- Architecture: `docs/ARCHITECTURE.md`
- Integrations: `docs/INTEGRATIONS.md`
