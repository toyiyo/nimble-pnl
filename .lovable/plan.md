
# Make Labor Costs More Transparent on Scheduling Page

## Problem Identified

Your suspicion was correct! **Server 3** has an hourly rate of **$213/hour** (likely a typo - meant to be $2.13 or $21.30). With 68 hours scheduled, this single employee accounts for **$14,484** of your $18,994 weekly labor cost.

The current Labor Cost card shows total cost and hours, but doesn't make it obvious when something is wrong.

---

## Solution: Add Transparency & Outlier Detection

### 1. Show Average Hourly Rate

Add a calculated "Avg $/hr" to the Labor Cost card so operators immediately see if the blended rate looks wrong:

```
Labor Cost
$18,994.76
────────────────────────
Hourly: $18,994.76 (482.0h)
        → Avg: $39.41/hr  ⚠️
```

An average of $39.41/hr is a red flag for restaurant labor.

### 2. Add "Top Earners" Breakdown

Show the top 3-5 employees by cost with their effective rate, making outliers immediately visible:

```
Top Earners This Week
────────────────────────
🔴 Server 3      68.0h × $213.00 = $14,484  [Edit]
   Dish          68.0h × $13.00  = $884
   Pizza PM      44.0h × $18.00  = $792
```

The red indicator and unusually high rate would immediately catch attention.

### 3. Add Rate Validation Warning in Employee Dialog

When saving an employee with an unusually high rate (e.g., >$50/hr for tipped positions, >$100/hr for any position), show a confirmation:

```
⚠️ Unusually High Rate
$213.00/hr is significantly higher than typical rates.
Did you mean $21.30/hr or $2.13/hr?
[Keep $213.00] [Change to $21.30] [Edit Manually]
```

---

## Technical Implementation

### Phase 1: Enhanced Labor Cost Card

**File: `src/pages/Scheduling.tsx`**

Update the Labor Cost card to show:
- Average hourly rate (total hourly cost ÷ total hours)
- Warning indicator if avg rate exceeds threshold (e.g., $35/hr)
- Expandable section or link to see per-employee breakdown

### Phase 2: Top Earners Component

**New File: `src/components/scheduling/LaborCostBreakdown.tsx`**

Create a component that:
- Takes shifts and employees as props
- Calculates cost per employee: `hours × hourly_rate`
- Sorts by cost descending
- Shows top 5 with visual indicators for outliers
- Links each employee to edit dialog

**Calculation Logic:**
```typescript
// Calculate per-employee cost
const employeeCosts = employees.map(emp => {
  const empShifts = shifts.filter(s => s.employee_id === emp.id);
  const hours = empShifts.reduce((sum, s) => sum + calculateShiftHours(s), 0);
  const effectiveRate = emp.hourly_rate / 100; // Convert cents to dollars
  const cost = hours * effectiveRate;
  
  return {
    id: emp.id,
    name: emp.name,
    hours,
    rate: effectiveRate,
    cost,
    isOutlier: effectiveRate > 50 || (cost > 1000 && effectiveRate > 25),
  };
}).filter(e => e.hours > 0).sort((a, b) => b.cost - a.cost);
```

### Phase 3: Rate Validation in Employee Dialog

**File: `src/components/EmployeeDialog.tsx`**

Add validation before save:
- For hourly employees: warn if rate > $50/hr (or $100/hr for managers)
- Suggest common typo corrections: $213 → $21.30 or $2.13
- Allow override but require confirmation

---

## UI Mockup

### Enhanced Labor Cost Card

```
┌─────────────────────────────────────────────────────┐
│  Labor Cost                                    $    │
├─────────────────────────────────────────────────────┤
│  $18,994.76                                         │
│                                                     │
│  Hourly: $18,994.76 (482.0h)                       │
│  ⚠️ Avg Rate: $39.41/hr — unusually high           │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  Top Earners                                        │
│  ┌─────────────────────────────────────────────┐   │
│  │ 🔴 Server 3   68h × $213.00/hr = $14,484   │←──│ Click to edit
│  │    Dish       68h × $13.00/hr  = $884      │   │
│  │    Pizza PM   44h × $18.00/hr  = $792      │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [View All Employees →]                             │
│                                                     │
│  Estimated weekly cost                              │
└─────────────────────────────────────────────────────┘
```

### Outlier Indicators

| Rate | Indicator | Color |
|------|-----------|-------|
| < $25/hr | None | Normal |
| $25-50/hr | ⚡ | Yellow (attention) |
| > $50/hr | 🔴 | Red (likely error) |

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/scheduling/LaborCostBreakdown.tsx` | Create | Top earners component |
| `src/hooks/useEmployeeLaborCosts.tsx` | Create | Calculate per-employee costs |
| `src/pages/Scheduling.tsx` | Modify | Integrate new components, show avg rate |
| `src/components/EmployeeDialog.tsx` | Modify | Add rate validation warning |

---

## Benefits

1. **Immediate Visibility**: Operators see average rate and top earners at a glance
2. **Outlier Detection**: Red flags on unusually high rates catch data entry errors
3. **Quick Fix**: Click-to-edit links allow immediate correction
4. **Prevention**: Rate validation on save prevents future typos
5. **No Learning Curve**: Uses existing UI patterns, just adds more detail

---

## Immediate Fix for Your Data

After implementing this, you'll want to fix **Server 3**'s rate. Based on the data:
- Other servers have rates of $2.13/hr (tipped minimum wage)
- Server 3 likely should be $2.13/hr or possibly $21.30/hr

This would reduce your weekly labor cost from ~$18,995 to ~$4,655 (if $2.13) or ~$5,933 (if $21.30).
