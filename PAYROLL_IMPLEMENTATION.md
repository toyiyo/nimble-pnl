# Payroll System Implementation Summary

## Overview
This implementation provides a complete payroll calculation system for restaurant employees, based on the 7shifts model described in `Scheduling_plan.md`. The system calculates wages, overtime, and tips from time punch data.

## Architecture

### 1. Calculation Layer (`src/utils/payrollCalculations.ts`)
**Responsibilities:**
- Parse time punches into work periods
- Calculate worked hours (excluding breaks)
- Apply overtime rules (>40 hours/week = 1.5x rate)
- Format currency and hours for display
- Generate CSV exports

**Key Functions:**
- `parseWorkPeriods()`: Converts raw time punches into work periods
- `calculateWorkedHours()`: Sums worked hours excluding breaks
- `calculateRegularAndOvertimeHours()`: Splits hours into regular/OT
- `calculateEmployeePay()`: Calculates complete payroll for one employee
- `calculatePayrollPeriod()`: Aggregates payroll for all employees
- `exportPayrollToCSV()`: Generates CSV for payroll systems

**Design Decisions:**
- All monetary values stored in cents (integer math to avoid floating point errors)
- Break time explicitly excluded from worked hours
- Overtime calculated at employee level (not aggregated first)
- Handles out-of-order punches by sorting by timestamp

### 2. Data Layer (`src/hooks/usePayroll.tsx`)
**Responsibilities:**
- Fetch time punches for date range
- Fetch employee tips for date range
- Group data by employee
- Calculate payroll using utility functions
- React Query caching and invalidation

**Key Features:**
- Uses React Query for efficient caching (30s stale time)
- Parallel data fetching (punches + tips)
- Automatic refetch on window focus
- Only fetches for active employees
- Returns null when restaurant not selected

### 3. UI Layer (`src/pages/Payroll.tsx`)
**Responsibilities:**
- Date range selection
- Display payroll table
- Summary cards with metrics
- CSV export
- Empty states and loading states

**Key Features:**
- Pre-defined periods: Current Week, Last Week, Last 2 Weeks
- Custom date range with datepicker
- Navigation (Previous/Next period)
- Responsive table with all payroll details
- Totals row at bottom
- Badge for overtime hours
- Download CSV button
- Info card explaining calculations

## Data Flow

```
1. User selects pay period
   ↓
2. usePayroll hook fetches:
   - time_punches (filtered by date range)
   - employee_tips (filtered by date range)
   - employees (from useEmployees hook)
   ↓
3. Data grouped by employee_id
   ↓
4. calculatePayrollPeriod() called with:
   - employees
   - punches per employee
   - tips per employee
   ↓
5. For each employee, calculateEmployeePay():
   - Parse work periods from punches
   - Sum worked hours (exclude breaks)
   - Split into regular/OT hours
   - Calculate pay (OT = 1.5x rate)
   - Add tips
   ↓
6. Return PayrollPeriod with:
   - Array of EmployeePayroll objects
   - Aggregated totals
   ↓
7. UI renders table and summary cards
```

## Database Schema (Existing)

### employees
- `id` (UUID) - Primary key
- `restaurant_id` (UUID) - Foreign key
- `name` (TEXT) - Employee name
- `position` (TEXT) - Job title
- `hourly_rate` (INTEGER) - Wage in cents
- `status` ('active'|'inactive'|'terminated')

### time_punches
- `id` (UUID) - Primary key
- `restaurant_id` (UUID) - Foreign key
- `employee_id` (UUID) - Foreign key
- `punch_type` ('clock_in'|'clock_out'|'break_start'|'break_end')
- `punch_time` (TIMESTAMPTZ) - When punch occurred

### employee_tips
- `id` (UUID) - Primary key
- `restaurant_id` (UUID) - Foreign key
- `employee_id` (UUID) - Foreign key
- `tip_amount` (INTEGER) - Tips in cents
- `recorded_at` (TIMESTAMPTZ) - When tips earned

## Overtime Calculation Rules

Current implementation uses **federal FLSA standard**:
- Regular time: First 40 hours/week at regular rate
- Overtime: Hours beyond 40/week at 1.5x regular rate

**Example:**
- Employee works 48 hours in a week at $20/hour
- Regular pay: 40 hours × $20 = $800
- Overtime pay: 8 hours × $20 × 1.5 = $240
- Total: $1,040

**Not implemented (future enhancements):**
- Daily overtime (e.g., California: >8 hours/day)
- Double-time (e.g., >12 hours/day)
- State-specific rules
- Overtime exemptions (salaried employees)

## Break Time Handling

Breaks are excluded from worked hours:
1. System looks for `break_start` and `break_end` punch pairs
2. Calculates break duration
3. Marks these periods as `isBreak: true`
4. `calculateWorkedHours()` filters out break periods
5. Only work periods contribute to pay

**Example:**
```
Clock in:    9:00 AM
Break start: 12:00 PM  (worked 3 hours)
Break end:   12:30 PM  (break 0.5 hours)
Clock out:   5:00 PM   (worked 4.5 hours)
Total: 7.5 hours worked (not 8 hours)
```

## Tip Handling

Tips are:
1. Stored separately in `employee_tips` table
2. Aggregated by employee_id for the pay period
3. Added to gross wages to calculate total pay
4. Included in CSV export
5. Displayed in separate column on report

Tips do NOT affect:
- Hourly rate calculations
- Overtime calculations
- Regular vs OT hour split

## CSV Export Format

Compatible with common payroll systems:

```csv
Employee Name,Position,Hourly Rate,Regular Hours,Overtime Hours,Regular Pay,Overtime Pay,Gross Pay,Tips,Total Pay
"John Doe","Server","$15.00","40.00","5.00","$600.00","$112.50","$712.50","$50.00","$762.50"
"Jane Smith","Cook","$18.00","35.00","0.00","$630.00","$0.00","$630.00","$0.00","$630.00"
"TOTAL","","","75.00","5.00","","","$1,342.50","$50.00","$1,392.50"
```

Fields:
- Employee Name (quoted)
- Position (quoted)
- Hourly Rate (formatted as currency)
- Regular Hours (2 decimal places)
- Overtime Hours (2 decimal places)
- Regular Pay (formatted as currency)
- Overtime Pay (formatted as currency)
- Gross Pay (wages only, formatted as currency)
- Tips (formatted as currency)
- Total Pay (wages + tips, formatted as currency)

## Performance Considerations

### Query Optimization
- Single query for all time punches (filtered by date range)
- Single query for all tips (filtered by date range)
- Employees loaded once via useEmployees hook
- React Query caching prevents redundant fetches
- Database indexes on punch_time and recorded_at

### Calculation Complexity
- Time: O(n) where n = number of punches
- Space: O(e) where e = number of employees
- Each employee calculated independently (parallelizable)

### UI Performance
- Skeleton loading states prevent layout shift
- Table virtualization not needed (<100 employees typical)
- CSV generation happens in-memory (fast for <1000 employees)

## Security

### Access Control
- Payroll page protected by `<ProtectedRoute>` (managers/owners only)
- Uses existing RLS policies on database tables
- Data automatically filtered by restaurant_id

### Data Privacy
- No sensitive data exposed in URLs
- CSV contains only pay period data (not historical)
- No personal info beyond name/position in export

## Testing

### Unit Tests (`tests/unit/payrollCalculations.spec.ts`)
- 15+ test cases covering:
  - Work period parsing
  - Hour calculations
  - Overtime logic
  - Pay calculations
  - Formatting functions
  - Edge cases (empty data, out-of-order punches, breaks)

### Manual Testing (`PAYROLL_TESTING.md`)
- 8 comprehensive test scenarios
- Expected results for each scenario
- Edge cases to verify
- Integration points

## Known Limitations

1. **Overtime**: Only weekly (40hrs/week), not daily or state-specific
2. **Pay Rates**: Single hourly rate per employee (no role-based rates)
3. **Deductions**: No tax calculations or benefit deductions
4. **Pay Schedules**: Manual period selection (no automated payroll runs)
5. **Approval Workflow**: No punch approval process before payroll
6. **Timezone**: Uses browser timezone (not restaurant timezone)
7. **Historical Rates**: Uses current hourly rate (no rate history)
8. **Split Shifts**: Multiple shifts per day supported but not distinguished

## Future Enhancements

### High Priority
1. State-specific overtime rules (CA, NY, etc.)
2. Pay rate history (track when rates change)
3. Punch approval workflow
4. Automated payroll period generation
5. Restaurant timezone handling

### Medium Priority
1. Multiple pay rates per employee (role-based)
2. Salary calculation (non-hourly employees)
3. Tax withholding estimates
4. Direct payroll system API integration
5. Email payroll reports

### Low Priority
1. Tip pooling calculations
2. Commission tracking
3. Bonus/incentive pay
4. Paid time off accrual
5. Benefits deductions
6. Multi-state tax calculations

## Maintenance

### When to Update
- **Employee hourly rate changes**: Payroll uses current rate
- **Time punches corrected**: Refresh payroll page
- **Tips added/modified**: Refresh payroll page
- **Overtime rules change**: Update `calculateRegularAndOvertimeHours()`

### Monitoring
- Check React Query cache invalidation
- Monitor CSV download success rate
- Verify calculation accuracy with sample audits
- Track page load performance

## Integration Points

### Existing Systems
- **Employee Management**: Uses employees table and useEmployees hook
- **Time Clock**: Uses time_punches from Time Clock page
- **Tips**: Uses employee_tips table (manual or POS-integrated)

### Future Integrations
- **ADP/Gusto API**: Push payroll data via API instead of CSV
- **POS Systems**: Auto-import tips from Square/Clover/Toast
- **Accounting**: Sync labor costs to Chart of Accounts
- **Bank Transfers**: Direct deposit initiation

## Code Style

Follows repository conventions:
- TypeScript with full type safety
- React functional components with hooks
- React Query for data fetching (30s stale time)
- Shadcn/ui components
- Semantic color tokens (not direct colors)
- Accessibility (ARIA labels, keyboard navigation)
- Currency in cents (integer math)
- Dates in ISO format with date-fns utilities

## Files Structure

```
src/
├── utils/
│   └── payrollCalculations.ts    (280 lines - core logic)
├── hooks/
│   └── usePayroll.tsx             (83 lines - data fetching)
├── pages/
│   └── Payroll.tsx                (565 lines - UI)
└── types/
    ├── scheduling.ts              (Employee type)
    └── timeTracking.ts            (TimePunch type)

tests/
└── unit/
    └── payrollCalculations.spec.ts (330 lines - unit tests)

docs/
└── PAYROLL_TESTING.md             (testing guide)
```

## Success Metrics

The implementation is successful if:
- ✅ Build completes without errors
- ✅ Lint passes with no new issues
- ✅ Unit tests pass (when Playwright configured)
- ✅ Manual tests pass per PAYROLL_TESTING.md
- ✅ CSV export opens in Excel/Google Sheets
- ✅ Page loads in <2 seconds with 50 employees
- ✅ Calculations match manual spreadsheet calculations
- ✅ Managers can export and upload to payroll system

## Conclusion

This payroll system provides a production-ready foundation for restaurant employee payroll calculation. It follows industry best practices (7shifts model), handles common edge cases, and is extensible for future enhancements. The modular design separates concerns (calculation, data, UI) for maintainability.
