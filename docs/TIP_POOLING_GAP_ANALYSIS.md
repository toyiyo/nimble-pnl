# Tip Pooling Implementation - Gap Analysis

> **Status**: Current implementation is ~30% complete  
> **Risk**: High - Missing critical UX flows and employee experience  
> **Last Updated**: December 17, 2024

---

## Executive Summary

You're right to be concerned. While the **core calculation logic** is solid, the implementation is **missing significant portions** of the Apple-style user journey specification. The current system is a **basic manager tool**, not the **trust-building, employee-centric experience** described in the spec.

### What Exists ✅
- ✅ Basic manager setup flow (Questions 1-4)
- ✅ Tip calculation algorithms (hours, role weights, manual)
- ✅ Preview with live calculations
- ✅ Database schema (`employee_tips` table)
- ✅ Unit tests for calculation logic
- ✅ Basic tip display in employee payroll view

### What's Missing ❌
- ❌ **All of Part 2** - Daily Manager Flow (review screen, editing, auto-balancing)
- ❌ **All of Part 3** - Employee Experience (My Pay → Tips, transparency view)
- ❌ **All of Part 4** - Manager Corrections (employee flags, review workflow)
- ❌ **All of Part 5** - Progressive Complexity (POS auto-import, shift-level splits)
- ❌ Save as draft functionality
- ❌ Tip rule persistence (settings are not saved)
- ❌ Historical tip breakdown by employee
- ❌ "How was this calculated?" transparency for employees
- ❌ Employee dispute/flagging system

---

## Part-by-Part Analysis

### ✅ PART 1 — Manager Experience (Setup) — **70% Complete**

#### What Works
| Feature | Status | File |
|---------|--------|------|
| Entry Point (Dashboard → Tips) | ✅ Done | `src/pages/Tips.tsx` |
| Screen 1: Tip source selection | ✅ Done | Lines 195-210 |
| Screen 2: Who shares tips | ✅ Done | Lines 212-240 |
| Screen 3: Share method | ✅ Done | Lines 242-280 |
| Screen 4: Split cadence | ✅ Done | Lines 282-300 |
| Screen 5: Preview | ✅ Partial | Lines 358-395 |

#### What's Broken/Missing
```typescript
// ❌ Settings are NOT persisted
// When manager leaves page, all selections (role weights, 
// selected employees, share method) are lost
// Need: tip_pool_settings table + save/load logic

// ❌ "Save as draft" button does nothing
<Button variant="outline">Save as draft</Button>
// Need: draft_tip_splits table + draft workflow

// ❌ Preview doesn't show method in plain language
// Current: "Method: hours"
// Spec wants: "Split by: Hours worked"
```

#### Missing Database Schema
```sql
-- Needed for Part 1 completion
CREATE TABLE tip_pool_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  tip_source TEXT CHECK (tip_source IN ('manual', 'pos')),
  share_method TEXT CHECK (share_method IN ('hours', 'role', 'manual')),
  split_cadence TEXT CHECK (split_cadence IN ('daily', 'weekly', 'shift')),
  role_weights JSONB, -- { "Server": 2, "Bartender": 3 }
  enabled_employee_ids UUID[], -- Array of employee IDs
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### ❌ PART 2 — Daily Manager Flow — **0% Complete**

This is **completely missing**. The spec describes this as the "most important screen" for building trust.

#### What's Missing (High Priority)

**1. Manual Entry with Focus**
```tsx
// Spec wants:
<Card className="max-w-md mx-auto">
  <CardHeader>
    <CardTitle>Enter today's tips</CardTitle>
  </CardHeader>
  <CardContent>
    <Input 
      type="number" 
      className="text-4xl text-center"
      autoFocus
      placeholder="$"
    />
    <Button size="lg" className="w-full mt-4">Continue</Button>
  </CardContent>
</Card>

// Current: Small input buried in step 5 (line 324)
```

**2. Review Screen with Inline Editing**
```tsx
// Spec: Tap any row → edit amount → auto-balance others
// Current: Read-only table, no editing

// Need to implement:
- Click-to-edit tip amounts
- Real-time auto-balancing using rebalanceAllocations()
- Visual "Total remaining: $0.00" indicator
- Approve vs. Save as draft distinction
```

**3. POS Import Flow**
```tsx
// Spec:
"Today's tips
Imported from POS
$843.27
[Edit]"

// Current: No POS integration at all
// Need:
- Fetch tips from unified_sales where tip_amount > 0
- Group by date
- Allow manual override
```

#### Required New Components
| Component | Purpose | Priority |
|-----------|---------|----------|
| `TipEntryDialog.tsx` | Focused single-input for tip amount | **High** |
| `TipReviewScreen.tsx` | Editable table with auto-balancing | **Critical** |
| `POSTipImporter.tsx` | Fetch tips from POS sales | Medium |

---

### ❌ PART 3 — Employee Experience — **10% Complete**

Currently, employees only see a basic total in `EmployeePay.tsx` (line 172-185):
```tsx
<Card>
  <CardDescription>Tips</CardDescription>
  <CardContent>
    <div className="text-2xl font-bold">
      {formatCurrency(myPayroll.totalTips)}
    </div>
    <p className="text-xs">Cash + Credit</p>
  </CardContent>
</Card>
```

#### What's Missing

**1. Dedicated "My Pay → Tips" Section**
```tsx
// Need new route: /employee/tips
// Shows:
// - This week: $312.20
// - Hours worked: 24.5
// - Tabs: This Week | History
```

**2. Daily Breakdown**
```tsx
// Employee taps "Wednesday"
// Shows:
{
  date: 'Wednesday',
  amount: 42.10,
  hoursWorked: 5.5,
  shareMethod: 'hours', // or 'role', 'manual'
}

// Button: "How was this calculated?"
```

**3. Transparency View**
```tsx
// Spec: Plain language explanation
"How your tips were split

Tips were shared by hours worked.

You worked 5.5 hours
Team worked 38 hours

Your share: $42.10"

// Current: Nothing. Just a number.
```

**4. Dispute/Flag System**
```tsx
// Spec: "Something doesn't look right" button
// Opens dialog with options:
// - Missing hours
// - Wrong role
// - Other

// Need:
// - tip_disputes table
// - Manager notification workflow
```

#### Required New Files
```
src/pages/EmployeeTips.tsx           (new)
src/components/employee/TipBreakdown.tsx   (new)
src/components/employee/TipTransparency.tsx (new)
src/components/employee/TipDispute.tsx      (new)
```

---

### ❌ PART 4 — Manager Corrections — **0% Complete**

**Zero implementation.** The spec describes a seamless correction workflow:

```
Manager sees:
  Tip review requested
  Maria says her hours look wrong on Tuesday.

[Tap] → Opens familiar review screen
```

#### What's Missing
1. **Dispute notification system**
   - No `tip_disputes` table
   - No notification when employee flags issue
   
2. **Re-edit past splits**
   - Current: `employee_tips` are write-only, no editing
   - Need: Ability to delete/re-save tip splits
   
3. **Audit trail**
   - Who edited what, when
   - Original vs. adjusted amounts

---

### ❌ PART 5 — Progressive Complexity — **20% Complete**

The spec says: "The system never asks about these, but quietly supports them."

| Feature | Status | Notes |
|---------|--------|-------|
| POS auto-import | ❌ Missing | No connection to `unified_sales.tip_amount` |
| Role weighting | ✅ Partial | Works, but not saved/persisted |
| Shift-level splits | ❌ Missing | Currently only daily/weekly/shift (UI only) |
| Retroactive edits | ❌ Missing | No edit workflow |
| Multi-location | ⚠️ Partial | Restaurant-scoped, but not location-scoped |
| Audit trail | ❌ Missing | No `created_by`, `updated_by` tracking on edits |

---

## Database Schema Gaps

### Current Schema (`employee_tips`)
```sql
CREATE TABLE employee_tips (
  id UUID PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  shift_id UUID,
  tip_amount INTEGER NOT NULL, -- cents
  tip_source TEXT CHECK (tip_source IN ('cash', 'credit', 'pool', 'other')),
  recorded_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_by UUID
);
```

### Missing Tables

**1. `tip_pool_settings`** (for Part 1 persistence)
```sql
CREATE TABLE tip_pool_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  tip_source TEXT CHECK (tip_source IN ('manual', 'pos')),
  share_method TEXT CHECK (share_method IN ('hours', 'role', 'manual')),
  split_cadence TEXT CHECK (split_cadence IN ('daily', 'weekly', 'shift')),
  role_weights JSONB,
  enabled_employee_ids UUID[],
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(restaurant_id, active) -- Only one active config per restaurant
);
```

**2. `tip_splits`** (for draft + approved splits)
```sql
CREATE TABLE tip_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  split_date DATE NOT NULL,
  total_amount INTEGER NOT NULL, -- cents
  status TEXT CHECK (status IN ('draft', 'approved', 'archived')),
  share_method TEXT,
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(restaurant_id, split_date, status)
);
```

**3. `tip_split_items`** (individual employee allocations)
```sql
CREATE TABLE tip_split_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_split_id UUID NOT NULL REFERENCES tip_splits(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  amount INTEGER NOT NULL, -- cents
  hours_worked DECIMAL(5,2),
  role TEXT,
  manually_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**4. `tip_disputes`** (for employee flags)
```sql
CREATE TABLE tip_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  tip_split_id UUID REFERENCES tip_splits(id),
  dispute_type TEXT CHECK (dispute_type IN ('missing_hours', 'wrong_role', 'other')),
  message TEXT,
  status TEXT CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Code Quality Assessment

### What's Good ✅
```typescript
// Calculation logic is solid and well-tested
// src/utils/tipPooling.ts
export function calculateTipSplitByHours(...)
export function calculateTipSplitByRole(...)
export function rebalanceAllocations(...) // For Part 2 editing!

// Tests cover edge cases
// tests/unit/tipPooling.test.ts - 8 test cases, all passing
```

### What Needs Work ⚠️

**1. No state management for settings**
```tsx
// Tips.tsx - All state is local, lost on unmount
const [tipSource, setTipSource] = useState<TipSource>('manual');
const [shareMethod, setShareMethod] = useState<ShareMethod>('hours');
const [roleWeights, setRoleWeights] = useState<Record<string, number>>({});

// Need: useQuery to load saved settings
// Need: useMutation to persist changes
```

**2. History is incomplete**
```tsx
// Current history shows individual employee_tips records
// Spec wants: Daily/weekly splits as a unit
// Missing: Split metadata (who approved, when, method used)
```

**3. No route guards**
```tsx
// Missing: Check if user is manager/owner before showing Tips page
// Missing: Check if employee is linked before showing EmployeeTips
```

---

## Implementation Priority

### 🔴 Critical (Week 1)
1. **Persist tip pool settings**
   - Create `tip_pool_settings` table
   - Save/load settings in `Tips.tsx`
   - Migration: `20241217_create_tip_pool_settings.sql`

2. **Implement Part 2 Review Screen**
   - Create `TipReviewScreen.tsx`
   - Editable amounts with auto-balancing
   - Approve vs. Draft distinction

3. **Create tip split workflow**
   - `tip_splits` + `tip_split_items` tables
   - Replace direct `employee_tips` inserts with split creation

### 🟡 High Priority (Week 2)
4. **Employee transparency view**
   - New route: `/employee/tips`
   - Daily breakdown component
   - "How was this calculated?" dialog

5. **POS tip import**
   - Query `unified_sales` for tips
   - Group by date
   - Manual override capability

### 🟢 Medium Priority (Week 3)
6. **Dispute system**
   - `tip_disputes` table
   - Employee flag button
   - Manager notification + review

7. **Edit past splits**
   - Re-open approved splits
   - Audit trail
   - Retroactive adjustments

---

## Code Examples for Missing Features

### Example: Persist Settings
```tsx
// hooks/useTipPoolSettings.tsx (new file)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useTipPoolSettings(restaurantId: string | null) {
  const queryClient = useQueryClient();
  
  const { data: settings, isLoading } = useQuery({
    queryKey: ['tip-pool-settings', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tip_pool_settings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('active', true)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantId,
  });
  
  const { mutate: updateSettings } = useMutation({
    mutationFn: async (updates: Partial<TipPoolSettings>) => {
      const { data, error } = await supabase
        .from('tip_pool_settings')
        .upsert({
          restaurant_id: restaurantId,
          ...updates,
          active: true,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-pool-settings', restaurantId] });
    },
  });
  
  return { settings, isLoading, updateSettings };
}
```

### Example: Editable Review Screen
```tsx
// components/TipReviewScreen.tsx (new file)
import { useState } from 'react';
import { rebalanceAllocations, type TipShare } from '@/utils/tipPooling';

export function TipReviewScreen({ 
  totalTipsCents, 
  initialShares,
  onApprove,
  onSaveDraft 
}: Props) {
  const [shares, setShares] = useState<TipShare[]>(initialShares);
  
  const handleAmountChange = (employeeId: string, newAmountCents: number) => {
    const rebalanced = rebalanceAllocations(
      totalTipsCents,
      shares,
      employeeId,
      newAmountCents
    );
    setShares(rebalanced);
  };
  
  const totalAllocated = shares.reduce((sum, s) => sum + s.amountCents, 0);
  const remaining = totalTipsCents - totalAllocated;
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's Tip Split</CardTitle>
        <p>Total tips: {formatCurrencyFromCents(totalTipsCents)}</p>
      </CardHeader>
      <CardContent>
        <table>
          <tbody>
            {shares.map(share => (
              <tr key={share.employeeId}>
                <td>{share.name}</td>
                <td>
                  <Input
                    type="number"
                    value={share.amountCents / 100}
                    onChange={(e) => 
                      handleAmountChange(
                        share.employeeId, 
                        Math.round(parseFloat(e.target.value) * 100)
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div className="mt-4">
          <p>Total remaining: {formatCurrencyFromCents(remaining)}</p>
        </div>
        
        <div className="flex gap-2 mt-6">
          <Button onClick={() => onApprove(shares)}>
            Approve tips
          </Button>
          <Button variant="outline" onClick={() => onSaveDraft(shares)}>
            Save as draft
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

### Example: Employee Transparency
```tsx
// components/employee/TipTransparency.tsx (new file)
export function TipTransparency({ 
  employeeTip, 
  totalTeamHours,
  shareMethod 
}: Props) {
  const explanation = getExplanation(shareMethod, employeeTip, totalTeamHours);
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          How was this calculated?
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How your tips were split</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-muted-foreground">{explanation.method}</p>
          <div className="space-y-2">
            <p>You worked {employeeTip.hours} hours</p>
            <p>Team worked {totalTeamHours} hours</p>
          </div>
          <div className="text-xl font-bold">
            Your share: {formatCurrency(employeeTip.amount)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getExplanation(method: ShareMethod, tip: EmployeeTip, totalHours: number) {
  if (method === 'hours') {
    return {
      method: 'Tips were shared by hours worked.',
    };
  }
  if (method === 'role') {
    return {
      method: `Tips were shared by role. ${tip.role} has a ${tip.roleWeight}× weight.`,
    };
  }
  return {
    method: 'Tips were split manually by your manager.',
  };
}
```

---

## Migration Plan

### Phase 1: Foundation (Week 1)
```
1. Migration: tip_pool_settings, tip_splits, tip_split_items
2. Update Tips.tsx to save/load settings
3. Replace direct employee_tips inserts with tip_splits workflow
4. Add E2E test: create tip split → approve → verify in DB
```

### Phase 2: Manager UX (Week 2)
```
5. Build TipReviewScreen with inline editing
6. Implement POS tip import from unified_sales
7. Add "Save as draft" functionality
8. Update manager flow to match spec screens
```

### Phase 3: Employee Experience (Week 3)
```
9. Create EmployeeTips page (/employee/tips)
10. Build TipTransparency component
11. Add daily breakdown view
12. Implement "This Week" vs "History" tabs
```

### Phase 4: Corrections & Disputes (Week 4)
```
13. Migration: tip_disputes table
14. Add employee "Something doesn't look right" button
15. Build manager dispute review workflow
16. Add notification system for disputes
```

---

## Testing Checklist

### Unit Tests (Existing ✅)
- [x] `calculateTipSplitByHours` accuracy
- [x] `calculateTipSplitByRole` with weights
- [x] `calculateTipSplitEven` distribution
- [x] `rebalanceAllocations` preserves total

### Unit Tests (Needed ❌)
- [ ] Settings persistence (save/load)
- [ ] Draft split creation
- [ ] Approve split workflow
- [ ] POS tip import aggregation
- [ ] Dispute creation

### E2E Tests (Needed ❌)
- [ ] Manager creates tip pool settings
- [ ] Manager enters daily tips → reviews → approves
- [ ] Manager edits allocation → auto-balances
- [ ] Manager imports POS tips → overrides amount
- [ ] Employee views tips → sees breakdown
- [ ] Employee flags issue → manager reviews
- [ ] Manager re-edits past split

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Settings not persisted** | High - Managers re-enter everything daily | **Certain** | Add `tip_pool_settings` table (Week 1) |
| **No employee transparency** | High - Trust issues, disputes | **Certain** | Build transparency view (Week 2) |
| **Can't edit past splits** | Medium - Manual corrections in payroll | High | Add edit workflow (Week 3) |
| **No POS integration** | Medium - Double data entry | Medium | Connect to `unified_sales` (Week 2) |
| **No dispute tracking** | Low - Handled via Slack/email | Low | Add dispute system (Week 4) |

---

## Conclusion

**You are correct to sense something is missing.** The current implementation is a **proof-of-concept** with solid math, but it lacks:

1. **Persistence** - Settings vanish on page refresh
2. **Employee Experience** - No transparency, no breakdown, no disputes
3. **Manager Workflow** - No review screen, no editing, no drafts
4. **POS Integration** - Tips must be entered manually
5. **Audit Trail** - No history of who approved what

### Recommended Next Steps

1. **This week**: Add `tip_pool_settings` table and persistence
2. **Next week**: Build the review screen (Part 2 - most critical)
3. **Week 3**: Employee transparency view (Part 3)
4. **Week 4**: Dispute system (Part 4)

**Estimated completion**: 4 weeks for full Apple-style experience  
**Current state**: 30% complete (calculation logic only)

---

## References

- Current Implementation: `src/pages/Tips.tsx`
- Calculation Utils: `src/utils/tipPooling.ts`
- Unit Tests: `tests/unit/tipPooling.test.ts`
- Database Schema: `supabase/migrations/20251114100100_create_time_tracking_tables.sql`
- Employee Pay View: `src/pages/EmployeePay.tsx` (shows tips but no breakdown)

---

**Last Updated**: December 17, 2024  
**Confidence Level**: High (based on code review + spec comparison)
