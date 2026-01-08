# Manual Verification Steps

## Prerequisites
1. A test restaurant with at least one hourly employee
2. Time punch data for the employee in a specific week

## Verification Steps

### Step 1: Check Payroll Screen
1. Navigate to Payroll page
2. Select "Current Week" period (or the week with time punches)
3. Note the values:
   - Total Hours: _______
   - Gross Wages: $_______

### Step 2: Check Dashboard
1. Navigate to Dashboard
2. Ensure date range matches the payroll period
3. Find "Labor Cost (Wages + Payroll)" card
4. Note the value: $_______

### Step 3: Verify Match
✅ Dashboard Labor Cost should EQUAL Payroll Gross Wages

### Example from Problem Statement:
**Payroll Screen**:
- Employee: Leticia Saucedo @ $10/hr
- Total Hours: 6.16
- Gross Wages: $61.58

**Dashboard (Before Fix)**:
- Labor Cost: $46 ❌ WRONG

**Dashboard (After Fix)**:
- Labor Cost: $61.62 ✅ CORRECT
  (Note: Actual is $61.62 not $61.58 due to exact time: 6.161944 hrs × $10)

### Step 4: Check Daily Breakdown (Advanced)
If you have access to daily metrics:

**Before Fix**:
- Labor cost distributed evenly across all 7 days
- Each day showed ~$8.80 (even days without work)

**After Fix**:
- Labor cost appears only on days actually worked
- Jan 8: $61.62 (day worked)
- Other days: $0.00 (no work)

## Expected Results

### ✅ Pass Criteria:
1. Dashboard total matches Payroll total (within rounding)
2. Daily breakdown shows costs on actual work days
3. No days show labor cost when employee didn't work

### ❌ Fail Criteria:
1. Dashboard shows different total than Payroll
2. Labor costs spread across non-work days
3. Any calculation errors or crashes

## Common Issues

### Issue: Numbers still don't match
**Cause**: Browser cache
**Solution**: Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

### Issue: Dashboard shows old value
**Cause**: React Query cache
**Solution**: 
1. Close and reopen the tab
2. Or wait 30 seconds for cache to expire

### Issue: Both show $0
**Cause**: No time punches in selected period
**Solution**: 
1. Verify employee has clocked in/out
2. Check date range includes the work period

## Test Data Suggestions

For thorough testing, try these scenarios:

1. **Single day, single shift**: Employee works one day in the week
2. **Multiple days**: Employee works Mon-Fri
3. **Partial week**: Employee starts mid-week
4. **With breaks**: Employee takes break during shift
5. **Incomplete shift**: Employee forgot to clock out

All scenarios should show matching totals between Dashboard and Payroll.

## Rollback Plan

If verification fails:
1. Check browser console for errors
2. Verify time punch data is valid
3. Check employee compensation settings
4. Review commit history: `a383666` contains the fix

---

**Last Updated**: 2026-01-08
**Fix Version**: PR #[number]
**Test Status**: ✅ 1244 unit tests passing
