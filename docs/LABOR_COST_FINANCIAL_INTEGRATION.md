# Labor Cost Financial Integration

## Overview
This feature integrates labor costs from financial transactions (bank transactions and pending outflows) with the existing time-tracking-based labor costs using a **pending vs actual pattern** that mirrors how expenses are tracked.

## Problem Solved
Previously, when users categorized bank transactions or pending outflows to labor-related chart of accounts (payroll, salaries, wages, benefits), these expenses were:
1. NOT included in labor cost calculations for performance reports
2. Shown as "Other/Uncategorized" expenses
3. Could lead to confusion about what labor costs were being tracked

## Solution
The system now:
1. **Tracks labor using pending vs actual pattern**:
   - **Pending Payroll**: Employee time punches showing scheduled/accrued labor (money you owe)
   - **Actual Payroll**: Bank transactions showing money actually paid out
   
2. **Follows existing expense pattern**:
   - Mirrors pending outflows vs posted transactions
   - Both sources shown separately until matched
   - Provides complete cash flow visibility

3. **Shows transparent breakdown**:
   - P&L reports show labor cost split by pending and actual
   - Users can see exactly where labor costs come from
   - No restrictions on categorization

## Technical Implementation

### New Hook: `useLaborCostsFromTransactions`
**Location**: `src/hooks/useLaborCostsFromTransactions.tsx`

Fetches actual labor costs (paid) from bank transactions and pending outflows:
```typescript
// Queries bank_transactions and pending_outflows tables
// Filters for transactions categorized to labor accounts (account_subtype='labor')
// Returns daily breakdown and totals
```

**Key Features**:
- Fetches both posted and pending bank transactions
- Fetches pending outflows (checks)
- Groups by date for daily tracking
- Uses React Query with 30s stale time

### Updated Hook: `useCostsFromSource`
**Location**: `src/hooks/useCostsFromSource.tsx`

Now combines three data sources with pending vs actual pattern:
```typescript
{
  dailyCosts: [
    {
      date: '2024-01-15',
      food_cost: 1500.00,
      labor_cost: 2000.00,           // Total labor
      pending_labor_cost: 1800.00,   // From time punches (scheduled)
      actual_labor_cost: 200.00,     // From bank transactions (paid)
      total_cost: 3500.00
    }
  ],
  totalLaborCost: 2000.00,           // Combined total
  pendingLaborCost: 1800.00,         // Scheduled/accrued
  actualLaborCost: 200.00            // Paid
}
```

### Updated Hook: `useOutflowByCategory`
**Location**: `src/hooks/useOutflowByCategory.tsx`

Enhanced labor detection:
```typescript
// Now detects labor accounts by:
// 1. account_subtype === 'labor' (primary)
// 2. account_subtype === 'payroll'
// 3. Keywords: 'payroll', 'salary', 'wage', 'labor'

// Maps to category: "Labor/Payroll"
// Previously these would show as "Other/Uncategorized"
```

### Updated Component: `DetailedPnLBreakdown`
**Location**: `src/components/DetailedPnLBreakdown.tsx`

Shows labor cost breakdown with pending vs actual pattern:
```typescript
Labor Costs
├─ Pending Payroll (Scheduled)  $1,800.00
└─ Actual Payroll (Paid)          $200.00
```

When expanded, users see:
- Clear breakdown showing pending and actual
- Insight text explaining each category
- Total labor cost calculation

### Updated Page: `ChartOfAccounts`
**Location**: `src/pages/ChartOfAccounts.tsx`

Added user guidance alert:
- Explains pending vs actual pattern
- Shows how it mirrors expense tracking
- Encourages free categorization without restrictions
- No double-counting warnings needed

## Chart of Accounts Labor Accounts

The following accounts are tracked as labor costs:

| Code | Account Name | Use Case |
|------|-------------|----------|
| 6000 | Salaries & Wages – Management | Manager salaries |
| 6001 | Salaries & Wages – Front of House | Servers, cashiers |
| 6002 | Salaries & Wages – Back of House | Kitchen staff |
| 6010 | Payroll Taxes | Employer-paid payroll taxes |
| 6011 | Employee Benefits | 401(k), bonuses, etc. |

**Detection Logic**:
- Primary: `account_subtype = 'labor'`
- Secondary: Account name contains payroll, salary, wage, or labor keywords

## User Guidance

### Understanding Pending vs Actual Labor

The system tracks labor costs using the same pattern as expenses:

**Pending Payroll (Scheduled)**:
- Shows labor costs you owe based on time punches
- Calculated from employee hours worked
- Represents money you need to pay out
- Like pending outflows for other expenses

**Actual Payroll (Paid)**:
- Shows money that has actually left your bank account
- From bank transactions categorized to labor accounts
- Represents money you've already paid
- Like posted transactions for other expenses

### When to Categorize Bank Transactions

You can freely categorize any payroll-related bank transaction to labor accounts:
- ✅ Regular payroll payments
- ✅ Payroll taxes (employer portion)
- ✅ Employee benefits (401k contributions, insurance)
- ✅ Payroll service fees (ADP, Gusto, etc.)
- ✅ Worker's compensation insurance
- ✅ Contractor payments
- ✅ Bonuses and commissions

Both pending and actual will show separately in reports until matched.

### Benefits of This Approach

1. **Complete Cash Flow Picture**: See both scheduled and paid labor
2. **No Restrictions**: Categorize freely without worrying about duplication
3. **Reconciliation Ready**: Can match time punches to actual payments
4. **Consistent Pattern**: Works like pending outflows vs posted transactions

## Data Flow

```
Time Tracking System                Financial System
        ↓                                   ↓
   Time Punches                     Bank Transactions
        ↓                                   ↓
daily_labor_costs table          Categorized to Labor Accounts
        ↓                                   ↓
        └─────────→ useCostsFromSource ←────┘
                           ↓
                   Combined Labor Cost
                           ↓
              ┌────────────┴────────────┐
              ↓                         ↓
    DetailedPnLBreakdown     useMonthlyMetrics
         (Reports)              (Dashboard)
```

## API Endpoints Used

### Supabase Tables
1. **bank_transactions**: Posted and pending bank transactions
   - Columns used: `transaction_date`, `amount`, `status`, `category_id`
   - Joined with: `chart_of_accounts` (via `category_id`)
   
2. **pending_outflows**: Checks and pending payments
   - Columns used: `issue_date`, `amount`, `status`, `category_id`
   - Joined with: `chart_of_accounts` (via `category_id`)
   
3. **daily_labor_costs**: Time punch calculated labor
   - Columns used: `date`, `total_labor_cost`, `hourly_wages`, `salary_wages`
   
4. **chart_of_accounts**: Account categorization
   - Column used: `account_subtype`
   - Filter: `account_subtype = 'labor'`

## Performance Considerations

- **React Query Caching**: 30-second stale time prevents excessive queries
- **Parallel Fetching**: Three data sources fetched in parallel
- **Date Filtering**: All queries filtered by date range at database level
- **Minimal Data Transfer**: Only necessary columns selected

## Testing

### Manual Test Scenarios

1. **Scenario 1: Time Tracking Only**
   - Add time punches for employees
   - Verify labor costs show in reports
   - Check "From Time Tracking" breakdown

2. **Scenario 2: Bank Transaction Only**
   - Add bank transaction, categorize to labor account
   - Verify it appears in "Labor/Payroll" in expense breakdown
   - Check "From Financial Transactions" breakdown in P&L

3. **Scenario 3: Both Sources**
   - Have both time punches AND labor bank transactions
   - Verify total labor cost = sum of both
   - Check breakdown shows both sources correctly

4. **Scenario 4: Avoid Double-Count**
   - Verify regular payroll transactions NOT categorized to labor
   - Verify labor NOT in "Other Expenses"
   - Verify totals are correct

### Unit Test Coverage Needed

```typescript
describe('useLaborCostsFromTransactions', () => {
  it('fetches labor costs from bank transactions');
  it('fetches labor costs from pending outflows');
  it('filters by date range');
  it('groups by date correctly');
  it('handles empty results');
});

describe('useCostsFromSource', () => {
  it('combines labor from time punches and transactions');
  it('calculates breakdown correctly');
  it('handles missing transaction labor data');
  it('handles missing time punch data');
});
```

## Migration Notes

### For Existing Data
- No database migration required
- Works immediately with existing chart of accounts
- Users can retroactively categorize old transactions

### For Existing Users
1. Users will see a new info alert on Chart of Accounts page
2. P&L reports will show labor breakdown (if any financial labor exists)
3. Expense charts will now properly show "Labor/Payroll" category
4. No action required unless users want to categorize past transactions

## Future Enhancements

1. **Labor Cost Reconciliation Report**
   - Compare payroll run totals vs. bank transactions
   - Flag potential discrepancies
   - Help identify missing categorizations

2. **Automated Suggestions**
   - AI categorization for common payroll vendor names
   - Suggest labor category for recurring payments
   - Pattern detection for payroll schedules

3. **Labor Budget Tracking**
   - Set labor budget by period
   - Alert when approaching budget limits
   - Compare actual vs. planned labor costs

4. **Multi-Source Labor Analytics**
   - Show trends by source over time
   - Identify changes in labor cost composition
   - Forecast based on historical patterns

## Security Considerations

### Data Access
- All queries filtered by `restaurant_id`
- Row Level Security (RLS) enforced at database level
- No direct user access to sensitive labor data

### Financial Data
- Labor costs are financial data - same security as other financial metrics
- Bank transaction categorization requires manager/owner role
- Time punch data requires appropriate role

### Privacy
- No PII (names, SSN) included in aggregated labor costs
- Daily totals only, not individual employee breakdown in financial tracking
- Complies with existing data privacy policies

## Troubleshooting

### Labor costs not showing from bank transactions
1. Check if transactions are categorized to labor accounts (6000-6011)
2. Verify account has `account_subtype = 'labor'`
3. Check date range includes the transaction dates
4. Verify transaction status is 'posted' or 'pending'

### Double-counting labor costs
1. Review which expenses are in time tracking
2. Only categorize non-time-tracked labor to labor accounts
3. Check P&L breakdown to see sources
4. Uncategorize duplicate bank transactions

### Labor not showing in expense breakdown
1. Verify `useOutflowByCategory` is being used
2. Check if labor keyword detection is working
3. Verify transactions have negative amounts (outflows)
4. Check restaurant filter is correct

## Documentation Links

- [Payroll Implementation](PAYROLL_IMPLEMENTATION.md)
- [Chart of Accounts](src/pages/ChartOfAccounts.tsx)
- [Architecture](ARCHITECTURE.md)
- [Integration Patterns](INTEGRATIONS.md)

## Contributors

- Implementation follows repository guidelines from `.github/copilot-instructions.md`
- Maintains consistency with existing hooks and components
- Uses semantic design tokens and accessibility standards
