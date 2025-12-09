# Daily Labor Allocations - Cron Job Solution

> December 8, 2024 - Automated daily allocation generation via cron job

## 🎯 The Right Approach: Daily Cron Job

### ❌ What We Initially Considered (Flawed)
1. **Just-in-time**: Only generate when P&L is calculated
   - **Problem**: Salary costs missing for days without sales!
   - **Problem**: Dashboard only shows data for dates with sales events

2. **Front-loaded**: Generate last 90 days + next 30 days
   - **Problem**: Creates future expenses that mess up reports
   - **Problem**: Ignores hire/termination dates
   - **Problem**: After 30 days, data cliff

### ✅ The Solution: Daily Cron Job

**Like a real payroll system:** Generate allocations automatically every day at 2 AM.

```typescript
// Edge Function runs daily via cron: "0 2 * * *"
// For each restaurant:
ensure_labor_allocations_for_date(restaurant_id, TODAY);
```

**How It Works:**
1. Cron job runs every day at 2 AM
2. For each restaurant in the system
3. Call `ensure_labor_allocations_for_date(restaurant_id, current_date)`
4. Function generates allocations for employees active TODAY
5. Payroll data is always current, no manual action needed

**User Experience:**
- Hire salaried employee on Dec 1st → Allocation created Dec 2nd at 2 AM
- Check dashboard anytime → Accurate labor costs, always up-to-date
- No sales on a particular day? → Salary still recorded!
- Employee terminated → Allocations stop automatically

---

## 🔧 Implementation

### 1. Employee Tenure Tracking

```sql
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS termination_date DATE DEFAULT NULL;

-- Allocation logic
WHERE (hire_date IS NULL OR hire_date <= p_date)
  AND (termination_date IS NULL OR termination_date >= p_date)
```

### 2. Core Function: `ensure_labor_allocations_for_date`

```sql
CREATE OR REPLACE FUNCTION ensure_labor_allocations_for_date(
  p_restaurant_id UUID,
  p_date DATE  -- Single date (TODAY from cron)
)
RETURNS INTEGER
```

Generates allocations for ONE specific date:
- Finds all salary/contractor employees active on that date
- Calculates daily pro-rated amount
- Inserts/updates allocation record
- Returns count of allocations created

### 3. Edge Function (Cron Job)

### 3. Edge Function (Cron Job)

**File**: `supabase/functions/generate-daily-allocations/index.ts`

```typescript
// Runs daily at 2 AM via cron: "0 2 * * *"
serve(async (req) => {
  const today = new Date().toISOString().split('T')[0];
  
  // Get all restaurants
  const { data: restaurants } = await supabaseAdmin
    .from('restaurants')
    .select('id, name');
  
  // For each restaurant, generate today's allocations
  for (const restaurant of restaurants) {
    await supabaseAdmin.rpc('ensure_labor_allocations_for_date', {
      p_restaurant_id: restaurant.id,
      p_date: today
    });
  }
});
```

### 4. Cron Schedule Setup

In Supabase Dashboard:
1. Navigate to **Edge Functions** → `generate-daily-allocations`
2. Click **"Add Schedule"**
3. Enter cron expression: `0 2 * * *` (daily at 2 AM)
4. Save

**Why 2 AM?**
- After midnight (new day has started)
- Before most users check their dashboard
- Low system load time
- Gives time for POS systems to sync yesterday's data

---

## 📊 How Data Flows

### Salary/Contractor Employees (Automated via Cron)
```
Day 1 (Dec 1):
  - Employee hired with $3,000/month salary
  - No action needed

Day 2 (Dec 2) at 2 AM:
  - Cron job runs
  - ensure_labor_allocations_for_date('rest-id', '2024-12-01')
  - Creates allocation: Dec 1 = $100 ($3,000/30)
  - User checks dashboard → Shows $100 labor cost for Dec 1 ✅

Day 3 (Dec 3) at 2 AM:
  - Cron job runs
  - Creates allocation: Dec 2 = $100
  - User checks dashboard → Shows $200 total for Dec 1-2 ✅

...and so on, automatically, forever
```

### Hourly Employees (Unchanged)
```
Time Punch → Square Sync → daily_labor_costs.hourly_wages
```

---

## ✅ Benefits of Cron Approach

1. **Always Current** ✅
   - Allocations generated daily, automatically
   - No gaps in data, even on days without sales

2. **No Future Data** ✅
   - Only generates for dates that have passed
   - TODAY is generated at 2 AM

3. **Respects Employee Tenure** ✅
   - Checks hire_date and termination_date
   - No allocations before hire or after termination

4. **No Manual Intervention** ✅
   - Runs automatically
   - Like a real payroll system

5. **Consistent** ✅
   - Same logic as real payroll
   - Generate today's cost today

6. **No Data Cliffs** ✅
   - Runs indefinitely
   - Never stops working

7. **Handles Edge Cases** ✅
   - Weekends: ✅ Still generates allocations
   - Holidays: ✅ Still generates allocations
   - No sales: ✅ Still generates allocations
   - Closed restaurant: ✅ Still generates allocations

---

## 🚀 Setup Instructions

### Step 1: Apply Migration
```bash
# Migration creates the SQL functions
npx supabase db push
```

### Step 2: Deploy Edge Function
```bash
# Deploy the cron job function
npx supabase functions deploy generate-daily-allocations
```

### Step 3: Configure Cron Schedule
1. Open Supabase Dashboard
2. Go to **Edge Functions**
3. Find `generate-daily-allocations`
4. Click **"Add Schedule"**
5. Set schedule: `0 2 * * *`
6. Description: "Generate daily labor allocations at 2 AM"
7. Click **Save**

### Step 4: Backfill Historical Data (One-Time)
```sql
-- For each restaurant, backfill last 90 days
SELECT * FROM backfill_labor_allocations(
  'your-restaurant-id'::uuid,
  CURRENT_DATE - INTERVAL '90 days',
  CURRENT_DATE - INTERVAL '1 day'  -- Stop at yesterday (today handled by cron)
);
```

### Step 5: Verify
```sql
-- Check that allocations are being created
SELECT 
  date,
  COUNT(*) as allocation_count,
  SUM(allocated_cost) / 100.0 as total_cost_dollars
FROM daily_labor_allocations
WHERE restaurant_id = 'your-restaurant-id'
AND date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY date
ORDER BY date DESC;
```

---

## 🧪 Testing

### Test 1: Manual Trigger
```bash
# Manually invoke the function (simulates cron)
curl -X POST 'https://your-project.supabase.co/functions/v1/generate-daily-allocations' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

### Test 2: Check Allocations
```sql
-- Should see allocation for today
SELECT * FROM daily_labor_allocations 
WHERE date = CURRENT_DATE
AND restaurant_id = 'your-restaurant-id';
```

### Test 3: Employee Scenarios
```sql
-- Scenario 1: New hire
INSERT INTO employees (restaurant_id, name, compensation_type, hire_date, salary_amount, pay_period_type)
VALUES ('rest-id', 'New Employee', 'salary', CURRENT_DATE, 300000, 'monthly');

-- Wait for next cron run (or trigger manually)
-- Then check: Should see allocation starting from hire_date

-- Scenario 2: Termination
UPDATE employees 
SET termination_date = CURRENT_DATE - INTERVAL '1 day'
WHERE id = 'emp-id';

-- Next cron run should NOT create allocation for today
```

---

## 📝 Files Modified

1. `supabase/migrations/20251208210000_auto_generate_labor_allocations.sql`
   - Added `termination_date` column
   - Created `ensure_labor_allocations_for_date` function
   - Created backfill helper functions

2. `supabase/functions/generate-daily-allocations/index.ts`
   - Edge Function that runs as cron job
   - Loops through all restaurants
   - Generates allocations for TODAY

3. `supabase/tests/09_daily_labor_allocations.sql`
   - Comprehensive tests for allocation logic
   - Tests hire dates, termination dates, backfills, etc.

4. `src/hooks/usePayroll.tsx` - Removed manual RPC call
5. `src/hooks/useLaborCosts.tsx` - Removed manual RPC call

---

## 🎓 Key Takeaway

**Generate allocations automatically every day via cron job, just like real payroll systems.**

This approach:
- ✅ Matches user expectations (payroll is automatic)
- ✅ Works even without sales data
- ✅ Respects employee lifecycles
- ✅ Never creates future data
- ✅ Requires zero manual intervention

The cron job is the **single source of truth** for when allocations are created.

```sql
-- Generate allocations for last 90 days (one-time)
SELECT * FROM backfill_labor_allocations(
  'restaurant-uuid'::uuid,
  CURRENT_DATE - INTERVAL '90 days',
  CURRENT_DATE
);
```

This is for:
- Initial setup
- Fixing missing historical data
- After changing employee compensation

**NOT for automatic/recurring use!**

---

## 📊 How Data Flows

### Hourly Employees (Unchanged)
```
Time Punch → Square Sync → daily_labor_costs.hourly_wages
                         ↓
                    calculate_daily_pnl → daily_pnl
```

### Salary/Contractor Employees (New)
```
Employee Setup (salary_amount, pay_period_type)
         ↓
   Sale/Cost Event (specific date)
         ↓
   ensure_labor_allocations_for_date (just-in-time!)
         ↓
   daily_labor_allocations.allocated_cost (THIS DATE ONLY)
         ↓
   calculate_daily_pnl → daily_pnl
```

---

## 🔄 Timeline Example

**Scenario:** Salaried employee "JD" hired 2024-12-01, $3,000/month salary

**December 1, 2024:**
- Square syncs sales → calls `calculate_daily_pnl(restaurant_id, '2024-12-01')`
- First ensures allocation exists → creates $100/day record for 2024-12-01
- Then calculates P&L with salary cost included

**December 2, 2024:**
- Square syncs → calls `calculate_daily_pnl(restaurant_id, '2024-12-02')`
- Creates $100/day record for 2024-12-02
- P&L includes salary

**December 15, 2024 (Today):**
- Dashboard loads "Last 30 Days" (Nov 15 - Dec 15)
- For each date with data:
  - If allocation exists: Use it
  - If allocation missing: Create it on-the-fly (backfill)
  - No future dates included!

**January 1, 2025 (Future):**
- No allocation exists yet (correct!)
- When that date arrives and sales are synced, allocation will be created then
- Reports won't show "future" salary costs

---

## ✅ Benefits of This Approach

1. **No Future Data** ✅
   - Allocations only created for dates that have passed or are being processed
   - Reports with no end date show actual data, not projections

2. **Respects Employee Tenure** ✅
   - Allocations start at `hire_date`
   - Allocations stop at `termination_date`
   - No ghost costs for non-existent employees

3. **Automatic & Maintainable** ✅
   - Piggybac on existing `calculate_daily_pnl` calls
   - No cron jobs needed
   - No manual intervention

4. **Consistent with Hourly Wages** ✅
   - Same pattern as Square wage sync
   - Data created when date is processed, not in advance

5. **Backfill Capable** ✅
   - Can fill in historical gaps with `backfill_labor_allocations`
   - One-time operation, not recurring

---

## 🚀 Migration Steps

1. **Add termination_date column** ✅
2. **Create ensure_labor_allocations_for_date function** ✅
3. **Update calculate_daily_pnl callers** (TODO)
   - sync_square_data
   - aggregate_unified_sales_to_daily
   - calculate_square_daily_pnl
   - Any other functions that call calculate_daily_pnl

4. **Backfill historical data** (Manual, after migration)
   ```sql
   -- Run once per restaurant to fill in past 90 days
   SELECT * FROM backfill_labor_allocations(
     'your-restaurant-id',
     '2024-09-01',
     CURRENT_DATE
   );
   ```

---

## 📝 Files Modified

1. `supabase/migrations/20251208210000_auto_generate_labor_allocations.sql`
   - Added `termination_date` column
   - Created `ensure_labor_allocations_for_date` function
   - Created `calculate_daily_pnl_with_allocations` wrapper
   - Created `backfill_labor_allocations` helper

2. `src/hooks/usePayroll.tsx` - Removed manual RPC call (no longer needed)
3. `src/hooks/useLaborCosts.tsx` - Removed manual RPC call (no longer needed)

---

## 🧪 Testing

After applying migration:

1. **Verify termination_date exists:**
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'employees' AND column_name = 'termination_date';
   ```

2. **Test allocation generation:**
   ```sql
   SELECT ensure_labor_allocations_for_date(
     'your-restaurant-id'::uuid,
     CURRENT_DATE
   );
   
   -- Check result
   SELECT * FROM daily_labor_allocations 
   WHERE restaurant_id = 'your-restaurant-id' 
   AND date = CURRENT_DATE;
   ```

3. **Test tenure logic:**
   ```sql
   -- Employee hired in future: Should return 0
   UPDATE employees SET hire_date = CURRENT_DATE + 1 WHERE id = 'emp-id';
   SELECT ensure_labor_allocations_for_date('rest-id', CURRENT_DATE);
   -- Result: 0 (employee not yet hired)
   
   -- Employee terminated in past: Should return 0
   UPDATE employees SET termination_date = CURRENT_DATE - 1 WHERE id = 'emp-id';
   SELECT ensure_labor_allocations_for_date('rest-id', CURRENT_DATE);
   -- Result: 0 (employee already terminated)
   ```

---

## 🎓 Key Takeaway

**Generate allocations just-in-time when dates are processed, not in advance.**

This matches how the system already handles hourly wages and prevents all the issues with future data, employee tenure, and maintainability.
