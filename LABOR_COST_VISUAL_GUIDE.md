# Visual Guide: Labor Cost Integration

## Before This Change

### Problem: Labor Costs Were Incomplete

```
┌─────────────────────────────────────────────────┐
│  Performance Reports (OLD)                      │
├─────────────────────────────────────────────────┤
│                                                 │
│  Labor Costs: $1,800                           │
│  (Only from time punches)                       │
│                                                 │
│  Other Expenses: $2,500                         │
│  (Includes payroll taxes & benefits!)          │
│                                                 │
│  Problem: Missing $200 in payroll taxes        │
│  Problem: Double-counting potential            │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Where Labor Expenses Were Hidden

```
Bank Transaction: "ADP Payroll Tax Payment" - $200
         ↓
   Not categorized to labor
         ↓
   Shows in "Other/Uncategorized" expenses
         ↓
   NOT included in labor cost reports ❌
```

---

## After This Change

### Solution: Complete Labor Cost Tracking

```
┌─────────────────────────────────────────────────┐
│  Performance Reports (NEW)                      │
├─────────────────────────────────────────────────┤
│                                                 │
│  Labor Costs: $2,000 (COMPLETE) ✅             │
│    ├─ From Time Tracking: $1,800              │
│    └─ From Transactions: $200                  │
│                                                 │
│  Other Expenses: $2,300                         │
│  (Labor properly excluded)                      │
│                                                 │
│  Benefit: Accurate labor costs                 │
│  Benefit: No double-counting                   │
│                                                 │
└─────────────────────────────────────────────────┘
```

### How Labor Expenses Are Now Tracked

```
Bank Transaction: "ADP Payroll Tax Payment" - $200
         ↓
   Categorized to Labor Account (6010)
         ↓
   account_subtype = 'labor'
         ↓
   Detected by useLaborCostsFromTransactions
         ↓
   Combined in useCostsFromSource
         ↓
   Shows in labor cost reports ✅
   Excluded from "Other Expenses" ✅
```

---

## User Interface Changes

### 1. Chart of Accounts Page - New Info Alert

```
┌────────────────────────────────────────────────────────┐
│ ℹ️  Understanding Labor Costs in Reports               │
├────────────────────────────────────────────────────────┤
│                                                        │
│ Your labor costs come from TWO sources:                │
│                                                        │
│  1. Time Tracking: Employee time punches               │
│  2. Financial Transactions: Bank transactions          │
│     categorized to Labor accounts (6000-6011)          │
│                                                        │
│ To avoid double-counting:                              │
│ Only categorize payroll-related bank transactions      │
│ to Labor accounts if they're NOT already tracked       │
│ in time punches (e.g., payroll taxes, benefits)       │
│                                                        │
│ Note: Labor is automatically excluded from             │
│ "Other Expenses" in reports                            │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 2. P&L Breakdown - Expandable Labor Section

```
┌────────────────────────────────────────────────────┐
│  Detailed P&L Breakdown                            │
├────────────────────────────────────────────────────┤
│                                                    │
│  ▼ Labor Costs                    $2,000   30%   │
│    ├─ From Time Tracking           $1,800   27%  │
│    │   (Employee time punches)                    │
│    └─ From Financial Transactions    $200    3%  │
│        (Bank txns to labor accounts)             │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 3. Expense Dashboard - Proper Categorization

```
┌──────────────────────────────────────────┐
│  Where Your Money Went                   │
├──────────────────────────────────────────┤
│                                          │
│  🟦 Labor/Payroll        $2,000   25%   │  ← NEW
│  🟩 Inventory/Food       $3,000   38%   │
│  🟨 Rent & CAM           $1,500   19%   │
│  🟧 Utilities              $800   10%   │
│  🟥 Other/Uncategorized    $700    8%   │  ← Reduced
│                                          │
│  Before: Labor was in "Other"            │
│  After: Labor properly categorized ✅    │
│                                          │
└──────────────────────────────────────────┘
```

---

## Technical Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    DATA SOURCES                         │
└─────────────────────────────────────────────────────────┘
           │                              │
           │                              │
           ▼                              ▼
┌──────────────────────┐     ┌──────────────────────────┐
│  Time Tracking       │     │  Financial System        │
│                      │     │                          │
│  - Time punches      │     │  - Bank transactions     │
│  - Payroll calc      │     │  - Pending outflows      │
│                      │     │  - Chart of accounts     │
└──────────────────────┘     └──────────────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────────┐     ┌──────────────────────────┐
│  daily_labor_costs   │     │  Categorized to Labor    │
│  table               │     │  (account_subtype=labor) │
└──────────────────────┘     └──────────────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────────┐     ┌──────────────────────────┐
│  useLaborCosts()     │     │ useLaborCosts            │
│                      │     │ FromTransactions() (NEW) │
└──────────────────────┘     └──────────────────────────┘
           │                              │
           └──────────────┬───────────────┘
                          ▼
              ┌───────────────────────┐
              │  useCostsFromSource() │
              │  (UPDATED)            │
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Combined Labor Cost  │
              │  $1,800 + $200        │
              │  = $2,000             │
              └───────────────────────┘
                          │
         ┌────────────────┴────────────────┐
         ▼                                  ▼
┌──────────────────┐            ┌──────────────────┐
│ DetailedPnL      │            │ Dashboard        │
│ Breakdown        │            │ Metrics          │
│ (Reports page)   │            │ (Home page)      │
└──────────────────┘            └──────────────────┘
```

---

## Code Changes Summary

### New File: useLaborCostsFromTransactions.tsx

```typescript
// Fetches labor costs from bank transactions & pending outflows
// Filters by account_subtype='labor'
// Returns daily breakdown + total

const { dailyCosts, totalCost } = useLaborCostsFromTransactions(
  restaurantId, 
  dateFrom, 
  dateTo
);
```

### Updated: useCostsFromSource.tsx

```typescript
// Before: Only time punch labor
{
  totalLaborCost: 1800
}

// After: Combined labor from both sources
{
  totalLaborCost: 2000,
  totalLaborCostFromTimePunches: 1800,
  totalLaborCostFromTransactions: 200,
  dailyCosts: [{
    date: '2024-01-15',
    labor_cost: 2000,
    labor_cost_from_timepunches: 1800,
    labor_cost_from_transactions: 200
  }]
}
```

### Updated: useOutflowByCategory.tsx

```typescript
// Before: Labor might show as "Other/Uncategorized"
function mapToStandardCategory(subtype, name) {
  if (subtype === 'payroll' || name.includes('payroll')) {
    return 'Labor/Payroll';
  }
  // ... other categories
}

// After: Enhanced labor detection
function mapToStandardCategory(subtype, name) {
  // Priority 1: Check subtype and keywords
  if (subtype === 'labor' || subtype === 'payroll' ||
      name.includes('payroll') || name.includes('salary') ||
      name.includes('wage') || name.includes('labor')) {
    return 'Labor/Payroll';  // Always categorized correctly
  }
  // ... other categories
}
```

---

## When to Use Each Method

### Use Time Tracking For:
✅ Hourly employee wages  
✅ Regular payroll calculations  
✅ Overtime tracking  
✅ Daily labor cost tracking  

### Use Financial Transaction Categorization For:
✅ Payroll taxes (employer portion)  
✅ Employee benefits (401k, insurance)  
✅ Payroll service fees (ADP, Gusto)  
✅ Worker's compensation insurance  
❌ NOT regular wages (if in time tracking)

---

## Testing Scenarios

### Scenario 1: Time Tracking Only
```
Input:
  - 10 time punches totaling 80 hours
  - Average rate $22.50/hour
  - Total: $1,800

Expected Output:
  ✅ Labor Cost: $1,800
  ✅ From Time Tracking: $1,800
  ✅ From Transactions: $0
```

### Scenario 2: Bank Transactions Only
```
Input:
  - Bank transaction "Payroll Tax Payment" $200
  - Categorized to account 6010 (Payroll Taxes)
  - account_subtype = 'labor'

Expected Output:
  ✅ Labor Cost: $200
  ✅ From Time Tracking: $0
  ✅ From Transactions: $200
  ✅ Shown in "Labor/Payroll" expense category
  ✅ NOT in "Other Expenses"
```

### Scenario 3: Both Sources Combined
```
Input:
  - Time punches: $1,800
  - Bank transaction payroll tax: $200

Expected Output:
  ✅ Labor Cost: $2,000
  ✅ From Time Tracking: $1,800 (90%)
  ✅ From Transactions: $200 (10%)
  ✅ Breakdown visible in P&L report
```

### Scenario 4: Avoid Double-Count
```
Input:
  - Time punches: $1,800
  - Bank transaction "Payroll Check" $1,800
    (This is the SAME payroll, not additional)

User Action:
  ❌ Do NOT categorize the bank transaction to labor
  ✅ Leave it uncategorized or mark as transfer

Expected Output:
  ✅ Labor Cost: $1,800 (correct, not $3,600)
  ✅ No double-counting
```

---

## Security Considerations

### Access Control
```
✅ All queries filtered by restaurant_id
✅ Row Level Security (RLS) enforced
✅ Bank transaction categorization requires manager/owner role
✅ Time punch data requires appropriate role
```

### Data Privacy
```
✅ No PII in aggregated labor costs
✅ Daily totals only, not individual employee data
✅ Complies with existing data privacy policies
✅ Same security level as other financial metrics
```

---

## Performance Impact

### React Query Caching
```
Stale Time: 30 seconds
- Prevents excessive database queries
- Balances freshness with performance
- Consistent with other financial hooks
```

### Parallel Data Fetching
```
Three hooks fetch in parallel:
  - useFoodCosts
  - useLaborCosts
  - useLaborCostsFromTransactions (NEW)

Total time: Max(hook1, hook2, hook3)
Not: Sum of all hooks
```

### Database Query Optimization
```
✅ Date range filtering at database level
✅ Only necessary columns selected
✅ Proper indexes on date columns
✅ Minimal data transfer
```

---

## Migration & Rollout

### For Existing Data
```
✅ No database migration required
✅ Works immediately with existing chart of accounts
✅ Users can retroactively categorize old transactions
```

### For Existing Users
```
Day 1:
  - Users see new info alert on Chart of Accounts page
  - No disruption to existing workflows

Week 1:
  - Users can start categorizing new transactions
  - P&L reports show breakdown (if any labor txns exist)
  
Month 1:
  - Users can review past transactions
  - Categorize historical labor expenses if desired
  - Full labor cost picture emerges
```

### Backwards Compatibility
```
✅ Existing reports still work
✅ Time tracking unchanged
✅ No breaking changes
✅ Graceful handling of missing data
```

---

## Success Metrics

### Completion Criteria ✅
- [x] Labor costs from transactions properly fetched
- [x] Combined with time punch labor costs
- [x] Labor excluded from "Other Expenses"
- [x] Breakdown visible in P&L reports
- [x] User documentation added
- [x] Build successful
- [x] Lint checks passed
- [x] TypeScript types correct

### Expected Outcomes
- ✅ More accurate labor cost tracking
- ✅ Better expense categorization
- ✅ Reduced user confusion about labor costs
- ✅ No double-counting issues
- ✅ Clear audit trail of labor expenses

---

## Support & Troubleshooting

### Common Questions

**Q: Why is my labor cost lower than expected?**
A: Check if you have bank transactions that should be categorized to labor accounts (payroll taxes, benefits, etc.)

**Q: I see labor showing up twice!**
A: You might be categorizing regular payroll bank transactions to labor accounts when they're already tracked in time punches. Only categorize additional labor expenses.

**Q: Where do I find labor accounts?**
A: Chart of Accounts page → Expense section → Accounts 6000-6011

**Q: Can I import past labor transactions?**
A: Yes, use the banking import and categorize them to labor accounts.

### Support Resources
- Full documentation: `LABOR_COST_FINANCIAL_INTEGRATION.md`
- Chart of Accounts guide: See info alert on page
- Payroll guide: `PAYROLL_IMPLEMENTATION.md`
