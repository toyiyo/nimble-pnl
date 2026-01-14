# Daily Rate Scheduling Labor Cost Implementation

**Date**: 2026-01-14  
**Status**: ✅ **Complete**

---

## Summary

Successfully implemented labor cost calculations for **daily_rate** employees in the scheduling view. Daily rate employees now have their costs calculated correctly based on scheduled shifts.

---

## Changes Made

### 1. Updated `src/services/laborCalculations.ts`

**Added daily_rate support to core calculation service**:

- ✅ Updated `LaborCostBreakdown` interface to include `daily_rate` breakdown
- ✅ Updated `DailyLaborCost` interface to include `daily_rate_cost` field
- ✅ Extended `calculateEmployeeDailyCost()` to handle `daily_rate` compensation type
- ✅ Extended `generateLaborBreakdown()` to include daily_rate in summary
- ✅ Updated `calculateScheduledLaborCost()` for scheduling projections:
  - Daily rate employees earn their daily rate for each day they're scheduled
  - Hours don't affect pay (only scheduled days matter)
- ✅ Updated `calculateActualLaborCost()` for time tracking:
  - Daily rate employees earn their daily rate for each day they have punches
  - Hours don't affect pay (only worked days matter)
- ✅ Updated validation functions to include daily_rate
- ✅ Updated description function to show daily rate clearly

### 2. Updated `src/hooks/useScheduledLaborCosts.tsx`

**Extended hook interfaces**:

- ✅ Added `daily_rate` to `ScheduledLaborCostBreakdown` interface
- ✅ Added `daily_rate_wages` to `ScheduledLaborCostData` interface  
- ✅ Updated hook to map daily_rate data from service
- ✅ Initialized empty state with daily_rate breakdown

### 3. Updated `src/pages/Scheduling.tsx`

**Added UI display for daily_rate costs**:

- ✅ Added daily_rate section in labor cost breakdown card
- ✅ Shows total daily rate cost
- ✅ Shows number of days scheduled
- ✅ Follows same pattern as salary/contractor display

---

## How It Works

### Scheduling View (Forward-Looking)

When a daily_rate employee is added to the schedule:

```typescript
// Example: Employee with $166.67/day rate
Employee: {
  compensation_type: 'daily_rate',
  daily_rate_amount: 16667 // cents
}

// Schedule for Monday, Tuesday, Wednesday
Shifts: [
  { employee_id: 'emp-1', start_time: 'Mon 9am', end_time: 'Mon 5pm' },
  { employee_id: 'emp-1', start_time: 'Tue 9am', end_time: 'Tue 5pm' },
  { employee_id: 'emp-1', start_time: 'Wed 9am', end_time: 'Wed 5pm' },
]

// Calculation
Days Scheduled: 3
Daily Rate: $166.67
Total Cost: $500.01

// Hours don't matter - only days count
```

**Key Point**: If they're scheduled for a day, they earn their daily rate for that day, regardless of shift length.

### Time Tracking View (Historical)

When a daily_rate employee clocks in/out:

```typescript
// Time punches
Punches: [
  { employee_id: 'emp-1', punch_time: 'Mon 9:00am', type: 'clock_in' },
  { employee_id: 'emp-1', punch_time: 'Mon 5:00pm', type: 'clock_out' },
  { employee_id: 'emp-1', punch_time: 'Tue 9:00am', type: 'clock_in' },
  { employee_id: 'emp-1', punch_time: 'Tue 6:30pm', type: 'clock_out' }, // 9.5 hours!
]

// Calculation  
Days Worked: 2 unique dates with punches
Daily Rate: $166.67
Total Cost: $333.34

// Hours don't matter - only unique days count
```

---

## Display in Scheduling Page

The labor cost card now shows:

```
┌─────────────────────────────────┐
│  Total Labor Cost: $1,234.56    │
├─────────────────────────────────┤
│  Hourly: $650.00 (40 hrs)       │
│  Salary: $250.00 (est. 7d)      │
│  Daily Rate: $334.56 (2d)       │ ← NEW!
│  Contractors: $0.00              │
└─────────────────────────────────┘
    Estimated weekly cost
```

---

## Tip Eligibility

✅ **Daily rate employees ARE eligible for tips** (by default)

The existing `tip_eligible` field on the Employee model already supports this:

```typescript
Employee: {
  compensation_type: 'daily_rate',
  tip_eligible: true, // Can participate in tip pools
}
```

No additional changes needed - the tip pooling system already treats daily_rate employees like any other tip-eligible employee.

---

## Calculation Logic

### Scheduled Costs (Projections)

```typescript
// For each shift in the schedule:
if (employee.compensation_type === 'daily_rate') {
  // Get the date of the shift
  const shiftDate = formatDateUTC(new Date(shift.start_time));
  
  // Add daily rate to that day's cost (only once per employee per day)
  if (!dayData.daily_rate_employees.has(employee.id)) {
    dayData.daily_rate_cost += employee.daily_rate_amount / 100;
    dayData.daily_rate_employees.add(employee.id);
  }
}
```

### Actual Costs (Time Punches)

```typescript
// For each day with time punches:
if (employee.compensation_type === 'daily_rate') {
  // Count unique days this employee has punches
  const uniqueDays = new Set(
    punches.map(p => formatDateUTC(new Date(p.punch_time)))
  );
  
  // Each unique day = one daily rate payment
  uniqueDays.forEach(date => {
    dayData.daily_rate_cost += employee.daily_rate_amount / 100;
  });
}
```

---

## Edge Cases Handled

✅ **Multiple shifts same day**: Only counts as 1 day  
✅ **Overnight shifts**: Counted on start date  
✅ **No punches**: $0 cost (unlike salary/contractor)  
✅ **Partial weeks**: Accurate per-day counting  
✅ **Mixed compensation types**: Works alongside hourly/salary/contractor  

---

## Integration with Existing Features

✅ **Dashboard Daily P&L**: Uses same `calculateActualLaborCost()` function  
✅ **Payroll**: Will use `calculateDailyRatePay()` from compensationCalculations  
✅ **Reports**: Breakdown includes daily_rate in all labor cost summaries  
✅ **Scheduling**: Shows accurate projected costs  

---

## Testing Checklist

To verify this works:

1. **Create a daily_rate employee**:
   ```
   - Go to Employees
   - Add employee
   - Select "Per Day Worked"
   - Enter $1000 weekly, 6 days
   - Save (daily rate = $166.67)
   ```

2. **Add to schedule**:
   ```
   - Go to Scheduling
   - Add shifts for Monday, Tuesday, Wednesday
   - Check labor cost card shows "Daily Rate: $500.01 (3d)"
   ```

3. **Clock in/out**:
   ```
   - Have employee clock in/out on Monday and Tuesday
   - Check Daily P&L shows $333.34 labor cost
   ```

4. **Verify tip eligibility**:
   ```
   - Go to Tips page
   - Employee should appear in tip pool distribution
   ```

---

## Files Modified

| File | Changes |
|------|---------|
| `src/services/laborCalculations.ts` | Added daily_rate to all calculation functions |
| `src/hooks/useScheduledLaborCosts.tsx` | Extended interfaces to include daily_rate |
| `src/pages/Scheduling.tsx` | Added daily_rate display in labor cost breakdown |

---

## Performance Impact

✅ **Minimal** - Same calculation pattern as hourly employees  
✅ **No additional queries** - Uses existing employee and shift data  
✅ **Memoized** - Results cached in React Query  

---

## Future Enhancements

Potential improvements for later:

1. **Badge on shift cards**: Show "$166.67" on each scheduled shift
2. **Warning indicator**: Highlight when employee scheduled 7+ days
3. **Forecasting**: Project costs for upcoming weeks
4. **Comparison**: Show actual vs. scheduled costs

---

## Documentation Updates Needed

- [ ] Update user guide with daily rate scheduling behavior
- [ ] Add tooltips explaining "days scheduled" in labor breakdown
- [ ] Update API documentation for labor cost endpoints

---

**Bottom Line**: Daily rate employees now calculate correctly in scheduling view. They earn their daily rate for each day scheduled/worked, regardless of hours. Tip eligibility works out of the box. 🎉
