# Missing Salary Allocations Fix

> December 8, 2024 - Fixed issue where salaried employee pay was not showing in dashboard

## 🐛 Problem

Salaried employee pay ($850.01) was showing correctly in the Payroll screen but **not appearing** in:
- Dashboard Labor Cost widget
- P&L reports
- Performance metrics

**Observed Behavior**:
```
Payroll Screen:
- JD (Salary) Server: $850.01/period ✅
- contractor (Per-Job) Server: $300.00 ✅
- Total: $1,150.01 ✅

Dashboard Labor Cost:
- Pending Payroll: $300 (only showing contractor) ❌
- Missing: $850.01 salary allocation
```

---

## 🔍 Root Cause

The SQL function `generate_daily_labor_allocations` exists but was **never being called**.

### What Exists
1. ✅ `daily_labor_allocations` table (migration `20251205164747_add_compensation_types.sql`)
2. ✅ SQL function `generate_daily_labor_allocations(restaurant_id, start_date, end_date)`
3. ✅ `useLaborCosts` hook queries both `daily_labor_costs` AND `daily_labor_allocations`
4. ✅ Employee has `allocate_daily = TRUE` by default

### What Was Missing
❌ **Nothing was calling the `generate_daily_labor_allocations` function!**

The function needs to be invoked to:
- Calculate daily pro-rated amounts for salaried employees
- Calculate daily pro-rated amounts for periodic contractors
- Insert records into `daily_labor_allocations` table

Without these records, the dashboard had no salary data to display.

---

## ✅ Solution

Added automatic generation of daily labor allocations in **two hooks**:

### 1. `src/hooks/usePayroll.tsx`
Called when viewing the Payroll page:

```typescript
const { data: payrollPeriod, isLoading, error, refetch } = useQuery({
  queryKey: ['payroll', restaurantId, startDate.toISOString(), endDate.toISOString()],
  queryFn: async (): Promise<PayrollPeriod | null> => {
    if (!restaurantId) return null;

    // 🆕 Generate daily labor allocations BEFORE fetching payroll data
    try {
      const { error: allocError } = await supabase.rpc('generate_daily_labor_allocations', {
        p_restaurant_id: restaurantId,
        p_start_date: format(startDate, 'yyyy-MM-dd'),
        p_end_date: format(endDate, 'yyyy-MM-dd'),
      });
      
      if (allocError) {
        console.error('Error generating daily labor allocations:', allocError);
        // Continue anyway - we still want to show hourly payroll
      }
    } catch (err) {
      console.error('Failed to generate allocations:', err);
    }

    // Fetch time punches, tips, manual payments...
    // ...
  },
  // ...
});
```

### 2. `src/hooks/useLaborCosts.tsx`
Called when viewing Dashboard or P&L:

```typescript
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['labor-costs', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd')],
  queryFn: async () => {
    if (!restaurantId) return null;

    // 🆕 Generate daily labor allocations BEFORE fetching labor costs
    try {
      const { error: allocError } = await supabase.rpc('generate_daily_labor_allocations', {
        p_restaurant_id: restaurantId,
        p_start_date: format(dateFrom, 'yyyy-MM-dd'),
        p_end_date: format(dateTo, 'yyyy-MM-dd'),
      });
      
      if (allocError) {
        console.error('Error generating daily labor allocations:', allocError);
      }
    } catch (err) {
      console.error('Failed to generate allocations:', err);
    }

    // Query daily_labor_costs for hourly wages
    // Query daily_labor_allocations for salary/contractor
    // ...
  },
  // ...
});
```

---

## 🎯 What the SQL Function Does

From `supabase/migrations/20251205164747_add_compensation_types.sql`:

```sql
CREATE OR REPLACE FUNCTION generate_daily_labor_allocations(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
) RETURNS INTEGER
```

**For each active salary/contractor employee** where `allocate_daily = true`:

1. **Calculate daily amount**:
   - Salary: `salary_amount / days_in_pay_period`
   - Contractor (periodic): `contractor_payment_amount / days_in_interval`
   - Contractor (per-job): Skip (needs manual allocation)

2. **Generate allocations** for each day in the date range:
   ```sql
   INSERT INTO daily_labor_allocations (
     restaurant_id, 
     employee_id, 
     date, 
     allocated_cost,  -- In cents
     compensation_type, 
     source  -- 'auto' for generated allocations
   ) VALUES (...)
   ON CONFLICT (employee_id, date) DO UPDATE SET
     allocated_cost = EXCLUDED.allocated_cost,
     updated_at = NOW();
   ```

3. **Return** count of records created/updated

---

## 📊 Expected Behavior After Fix

### Dashboard Labor Cost Widget
```
Labor Cost (Wages + Payroll)
$1,150
0.0% of revenue | Pending $1,150 • Actual $0

Breakdown:
- Hourly: $0 (no time punches)
- Salary: $850.01 (JD - auto-allocated)
- Contractor: $300.00 (manual payment)
```

### Payroll Screen (Unchanged)
```
Employee           Rate              Total Pay
JD (Salary)        $850.01/period    $850.01 ✅
contractor         Per-Job           $300.00 ✅
TOTAL                                $1,150.01 ✅
```

---

## 🧪 Testing

All tests passing:
```bash
npm run test -- --run
# Test Files  18 passed (18)
# Tests       597 passed
```

**To verify manually**:
1. Open Dashboard → Labor Cost should show $1,150 (salary + contractor)
2. Open Payroll → Should show $1,150 total
3. Check database:
   ```sql
   SELECT * FROM daily_labor_allocations 
   WHERE restaurant_id = '<your-restaurant-id>'
   ORDER BY date DESC;
   ```
   Should see daily records for the salaried employee.

---

## 🔄 How Allocations Work

### Hourly Employees
- Time punches → `daily_labor_costs.hourly_wages` (in dollars)
- Calculated on-the-fly from punch data
- No allocations table needed

### Salaried Employees
- `employees.salary_amount` (e.g., $3,400/month = 340,000 cents)
- **Pro-rated daily**: 340,000 / 30 days = 11,333 cents/day (~$113.33)
- Stored in `daily_labor_allocations.allocated_cost` (cents)
- `compensation_type = 'salary'`, `source = 'auto'`

### Periodic Contractors
- `employees.contractor_payment_amount` (e.g., $1,000/week = 100,000 cents)
- **Pro-rated daily**: 100,000 / 7 days = 14,286 cents/day (~$142.86)
- Stored in `daily_labor_allocations.allocated_cost` (cents)
- `compensation_type = 'contractor'`, `source = 'auto'`

### Per-Job Contractors
- No automatic allocation (`allocate_daily` logic skips them)
- Manual payments via "Add Payment" button
- Stored in `daily_labor_allocations` with `source = 'per-job'`

---

## 📝 Files Modified

1. `src/hooks/usePayroll.tsx`
   - Added RPC call to `generate_daily_labor_allocations` before fetching data
   - Ensures allocations exist when viewing payroll

2. `src/hooks/useLaborCosts.tsx`
   - Added RPC call to `generate_daily_labor_allocations` before fetching data
   - Ensures allocations exist when viewing dashboard/P&L

---

## 🚀 Future Improvements

### Option 1: Cron Job (Recommended)
Create a scheduled Edge Function to run daily:
```typescript
// supabase/functions/generate-labor-allocations/index.ts
Deno.cron("Generate labor allocations", "0 2 * * *", async () => {
  // For each restaurant
  // Call generate_daily_labor_allocations for yesterday
});
```

### Option 2: Database Trigger
Trigger on employee changes:
```sql
CREATE TRIGGER update_allocations_on_employee_change
AFTER INSERT OR UPDATE ON employees
FOR EACH ROW
WHEN (NEW.compensation_type IN ('salary', 'contractor') AND NEW.allocate_daily)
EXECUTE FUNCTION regenerate_employee_allocations();
```

### Option 3: Keep Current Approach
- ✅ Simple - no background jobs
- ✅ Always up-to-date when viewed
- ❌ Small delay on first load
- ❌ Redundant calls if multiple users view same data

---

## ✅ Resolution Summary

**Root Cause**: SQL function existed but was never invoked  
**Solution**: Added automatic invocation in `usePayroll` and `useLaborCosts` hooks  
**Impact**: Salary and contractor allocations now appear in dashboard and reports  
**Tests**: All 597 tests passing ✅

The fix ensures that whenever labor cost data is requested (dashboard, P&L, payroll), the system first generates any missing allocations for the date range.
