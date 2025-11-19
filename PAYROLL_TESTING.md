# Payroll System Testing Guide

## Manual Testing Instructions

Since the payroll system is complete and built successfully, here are the manual testing steps to verify functionality:

### Prerequisites
1. Have a restaurant set up in the system
2. Have at least 2-3 employees created with hourly rates
3. Have time punches recorded for these employees
4. (Optional) Have tips recorded for employees

### Test Scenarios

#### Test 1: Basic Payroll Calculation (Regular Hours Only)
**Setup:**
- Employee: John Doe, $15/hour
- Time punches: 
  - Clock in: Monday 9:00 AM
  - Clock out: Monday 5:00 PM
  - Total: 8 hours

**Expected Result:**
- Regular Hours: 8.00
- Overtime Hours: 0.00
- Regular Pay: $120.00
- Overtime Pay: $0.00
- Gross Pay: $120.00

**Steps:**
1. Navigate to `/payroll`
2. Select "Current Week" period
3. Verify employee row shows 8 hours regular, $120 total

#### Test 2: Overtime Calculation
**Setup:**
- Employee: Jane Smith, $20/hour
- Time punches over a week:
  - Monday-Thursday: 10 hours each day (40 hours total)
  - Friday: 8 hours
  - Total: 48 hours

**Expected Result:**
- Regular Hours: 40.00
- Overtime Hours: 8.00
- Regular Pay: $800.00
- Overtime Pay: $240.00 (8 × $20 × 1.5)
- Gross Pay: $1,040.00

**Steps:**
1. Navigate to `/payroll`
2. Select appropriate week
3. Verify Jane Smith shows:
   - 40 regular hours
   - 8 OT hours (in badge)
   - $800 regular pay
   - $240 OT pay
   - $1,040 gross pay

#### Test 3: Tips Integration
**Setup:**
- Employee: Bob Server, $12/hour
- Time punches: 30 hours for the week
- Tips recorded: $150

**Expected Result:**
- Regular Hours: 30.00
- Overtime Hours: 0.00
- Regular Pay: $360.00
- Overtime Pay: $0.00
- Tips: $150.00
- Total Pay: $510.00

**Steps:**
1. Add tips in employee_tips table or through UI
2. Navigate to `/payroll`
3. Verify tips column shows $150
4. Verify total pay is $510

#### Test 4: Break Time Exclusion
**Setup:**
- Employee: Alice Cook, $18/hour
- Time punches for one day:
  - Clock in: 9:00 AM
  - Break start: 12:00 PM
  - Break end: 1:00 PM
  - Clock out: 5:00 PM
  - Work time: 3 hours (9-12) + 4 hours (1-5) = 7 hours

**Expected Result:**
- Regular Hours: 7.00 (not 8.00)
- Regular Pay: $126.00

**Steps:**
1. Record punches with break
2. Navigate to `/payroll`
3. Verify hours calculated correctly exclude break

#### Test 5: CSV Export
**Setup:**
- Multiple employees with varying hours/tips

**Expected Result:**
- CSV file downloads with format:
  ```
  Employee Name,Position,Hourly Rate,Regular Hours,Overtime Hours,Regular Pay,Overtime Pay,Gross Pay,Tips,Total Pay
  "John Doe","Server","$15.00","40.00","5.00","$600.00","$112.50","$712.50","$50.00","$762.50"
  ...
  "TOTAL","","","45.00","5.00","","","$712.50","$50.00","$762.50"
  ```

**Steps:**
1. Navigate to `/payroll`
2. Select a period with data
3. Click "Export CSV" button
4. Open downloaded file
5. Verify formatting and calculations

#### Test 6: Date Range Selection
**Setup:**
- Data spanning multiple weeks

**Expected Result:**
- Different periods show different data
- Custom date range works correctly

**Steps:**
1. Navigate to `/payroll`
2. Try each period type:
   - Current Week
   - Last Week
   - Last 2 Weeks
   - Custom Range
3. Verify data changes appropriately
4. Use Previous/Next buttons to navigate
5. Verify dates update in badge

#### Test 7: Empty State
**Setup:**
- Period with no time punches

**Expected Result:**
- Shows "No Payroll Data" message
- Export button is disabled
- Summary cards show 0 values

**Steps:**
1. Navigate to `/payroll`
2. Select a future date range
3. Verify empty state displays correctly

#### Test 8: Navigation
**Setup:**
- None

**Steps:**
1. Verify sidebar shows "Payroll" under Operations section
2. Click Payroll link
3. Verify route loads at `/payroll`
4. Verify page header and title display correctly

## Unit Tests

Unit tests are provided in `tests/unit/payrollCalculations.spec.ts` but need Playwright configuration updates to run. The tests cover:

1. **parseWorkPeriods**: Converting punch records to work periods
2. **calculateWorkedHours**: Summing work hours (excluding breaks)
3. **calculateRegularAndOvertimeHours**: Splitting hours into regular/OT
4. **calculateEmployeePay**: Complete pay calculation
5. **formatCurrency**: Dollar formatting
6. **formatHours**: Hours formatting

To run unit tests once Playwright is configured:
```bash
npm run test:unit
```

## Performance Testing

Test with realistic data volumes:
- 50+ employees
- 1000+ time punches
- Various date ranges

Verify:
- Page loads in < 2 seconds
- CSV export completes in < 5 seconds
- No memory leaks on repeated queries

## Security Testing

Verify Row Level Security (RLS):
1. User can only see payroll for their restaurants
2. Manager/owner role required to access payroll page
3. Employee data properly filtered by restaurant_id

## Edge Cases to Test

1. **Incomplete punches**: Clock in without clock out
2. **Multiple shifts per day**: Multiple clock in/out cycles
3. **Cross-day shifts**: Clock in before midnight, out after
4. **Zero hours**: Employee with no punches
5. **Negative dates**: Invalid date ranges
6. **Very large numbers**: Employee with 100+ hours (data validation)

## Known Limitations

1. Overtime calculated weekly (40 hours/week) - not daily
2. Does not handle state-specific overtime rules (e.g., CA daily OT)
3. Does not calculate payroll taxes or deductions
4. Tips must be manually entered or imported from POS
5. Break time must be explicitly punched (not auto-deducted)

## Integration Points to Test

1. **Employee Management**: Changes to employee hourly rates reflect in payroll
2. **Time Punches**: Punches from Time Clock page appear in payroll
3. **Tips**: Tips from employee_tips table included
4. **Date Filters**: Respects timezone settings
