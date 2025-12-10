# Labor Cost Calculation Refactor

> **Date**: December 8, 2024  
> **Change Type**: Architectural Refactor (Critical)  
> **Status**: ✅ Complete

---

## 🎯 Problem

The system was trying to maintain a **synchronized aggregation table** (`daily_labor_allocations`) to store pre-calculated salary and contractor costs. This pattern has proven problematic:

1. **Data Consistency Issues**: Cron jobs can fail, leaving stale data
2. **Sync Complexity**: Multiple Edge Functions trying to maintain the same table
3. **Historical Problem**: Same issue that led to abandoning `daily_pnl` table

The Dashboard was showing **$0 for labor costs** because the aggregation table wasn't being populated, while the Payroll view showed **correct costs** because it calculates directly from source tables.

---

## ✅ Solution

**Follow the Payroll pattern**: Calculate labor costs **on-demand from source tables**.

### New Architecture

```
Dashboard Labor Costs
  ↓
usePeriodMetrics
  ↓
useCostsFromSource
  ↓
useLaborCostsFromTimeTracking (NEW!)
  ↓
  ├─ time_punches (hourly wages)
  ├─ employees (salary configs)
  └─ daily_labor_allocations (per-job only - source records, not aggregated)
```

### Key Changes

1. **Created `useLaborCostsFromTimeTracking`** (new hook)
   - Queries `time_punches`, `employees`, `daily_labor_allocations` (per-job only)
   - Calculates costs using same logic as `usePayroll`
   - Returns daily costs grouped by date

2. **Updated `useCostsFromSource`**
   - Replaced `useLaborCosts` with `useLaborCostsFromTimeTracking`
   - Now queries source tables directly, not aggregation tables

3. **Deprecated Old Pattern**
   - `useLaborCosts` (queries aggregation table) → deprecated
   - Migration `20251208210000_auto_generate_labor_allocations.sql` → cron job disabled
   - Edge Function `generate-daily-allocations` → deprecated

---

## 📊 Data Flow

### Before (Broken)
```
Cron Job (generate-daily-allocations)
  ↓ (tries to populate)
daily_labor_allocations (aggregation table)
  ↓ (query fails - empty table)
useLaborCosts
  ↓
Dashboard shows $0 ❌
```

### After (Working)
```
useLaborCostsFromTimeTracking
  ↓ (queries directly)
  ├─ time_punches → hourly wages
  ├─ employees → salary calculations  
  └─ daily_labor_allocations (per-job only)
  ↓ (calculates on-demand)
Dashboard shows $919.87 ✅
```

---

## 🔍 Technical Details

### Labor Cost Calculation by Type

| Compensation Type | Source Data | Calculation |
|-------------------|-------------|-------------|
| **Hourly** | `time_punches` | Parse shifts, calculate hours × rate (using `calculateEmployeePay`) |
| **Salary** | `employees.salary_amount`, `employees.pay_period_type` | Prorate salary over period (using `calculateSalaryForPeriod`) |
| **Contractor (per-job)** | `daily_labor_allocations` where `source='per-job'` | Direct query (user-created records only) |

### Important: `daily_labor_allocations` Table Usage

| `source` Column | Purpose | Created By | Used By |
|-----------------|---------|------------|---------|
| `'per-job'` | **Source records** for contractor payments | User via Payroll UI | Dashboard ✅ |
| `'auto'` | ⚠️ **Deprecated** aggregation records | Cron job (disabled) | Nothing ❌ |

**Key Rule**: Only query `daily_labor_allocations` where `source='per-job'`. Ignore `source='auto'` records.

---

## 📝 Migration Impact

### Files Changed

- ✅ **Created**: `src/hooks/useLaborCostsFromTimeTracking.tsx`
- ✅ **Updated**: `src/hooks/useCostsFromSource.tsx`
- ✅ **Deprecated**: `src/hooks/useLaborCosts.tsx`
- ✅ **Deprecated**: `supabase/migrations/20251208210000_auto_generate_labor_allocations.sql` (cron disabled)
- ✅ **Deprecated**: `supabase/functions/generate-daily-allocations/index.ts`

### Database Impact

- ❌ **No schema changes** (migration still applies for `termination_date` column)
- ❌ **No data migration needed**
- ✅ Cron job unscheduled automatically (migration cleanup runs on reset)
- ✅ `daily_labor_allocations` table kept for `source='per-job'` records

### Backwards Compatibility

- ✅ Old hooks remain but are marked `@deprecated`
- ✅ SQL functions remain for backwards compatibility
- ✅ Edge Function remains but won't be called
- ✅ Existing per-job records preserved

---

## 🧪 Testing

### Verification Steps

1. **Dashboard shows labor costs** (not $0)
2. **Costs match Payroll view** (same calculation logic)
3. **Hourly employees** show time punch-based costs
4. **Salary employees** show prorated salary costs
5. **Contractors** show per-job payment records

### Test Scenarios

```typescript
// Hourly Employee
time_punches: [clock_in, clock_out] → 8 hours × $15/hr = $120

// Salary Employee
salary_amount: $3600/month (30 days) → $120/day × 7 days = $840

// Contractor (per-job)
daily_labor_allocations: [{ date: '2024-12-08', allocated_cost: 5000, source: 'per-job' }]
→ $50.00 (already in database)
```

---

## 🚀 Future Improvements

1. **Per-day hourly calculation**: Currently distributes evenly; could parse punches per day
2. **Caching optimization**: React Query already caches for 30s; monitor performance
3. **Real-time updates**: Could add real-time subscriptions to `time_punches` table
4. **Cleanup old aggregations**: Consider migration to remove `source='auto'` records

---

## 📚 Related Documentation

- [INTEGRATIONS.md](./INTEGRATIONS.md) - Data flow architecture patterns
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system design
- [GitHub Copilot Instructions](../.github/copilot-instructions.md) - DRY principle, on-demand calculations

---

## 🎓 Lessons Learned

1. **Aggregation tables are problematic** - They require constant synchronization
2. **Calculate on-demand when possible** - Simpler, more reliable, easier to debug
3. **Follow existing patterns** - Payroll view already solved this problem
4. **Query source tables directly** - Single source of truth, no sync issues

---

## ⚠️ Migration Notes for Team

If you see references to `daily_labor_allocations` in code:

- ✅ **OK to query** if filtering by `source='per-job'` (user-created records)
- ❌ **Do NOT query** `source='auto'` records (deprecated aggregations)
- ✅ **Use `useLaborCostsFromTimeTracking`** for Dashboard calculations
- ✅ **Use `usePayroll`** for Payroll view (already correct)

The cron job is disabled - do not re-enable without team discussion.
