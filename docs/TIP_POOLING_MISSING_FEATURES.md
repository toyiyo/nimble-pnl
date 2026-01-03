# Tip Pooling - Missing Features & Implementation Guide

> **Purpose**: Comprehensive to-do list for completing the tip pooling feature
> **Last Updated**: January 3, 2026
> **Current Completion**: ~75% (Core functionality works, missing critical UX flows)

---

## 📊 Overview

The tip pooling feature has solid foundations (calculation logic, database schema, manager setup) but is missing key workflows that will cause pain in production:

- ❌ Employees cannot submit their own tips
- ❌ Cannot fix mistakes after approval
- ❌ No weekly pooling UI (feature exists but not accessible)
- ❌ No visibility into who changed what (audit trail)
- ⚠️ Several built components not integrated into the main flow

---

## 🚨 Critical Priority (Must Fix Before Production)

### 1. Employee Tip Submission

**Problem**: Employees have no way to declare their tips (especially cash tips not captured by POS).

**User Stories**:
- As a server, when I clock out, I want to enter my cash/credit tips for the shift
- As a bartender, I want to submit my tips for today before the manager runs the split
- As an employee, I want to see my pending tip submissions and their status

#### Implementation Plan

##### Option A: Clock-Out Tip Declaration (Recommended)
Add optional tip entry after successful clock-out in KioskMode.

**Files to Modify**:
- `src/pages/KioskMode.tsx`

**Changes Needed**:
```tsx
// Add state after line 75
const [tipEntryOpen, setTipEntryOpen] = useState(false);
const [cashTips, setCashTips] = useState('');
const [creditTips, setCreditTips] = useState('');
const [lastPunchEmployeeId, setLastPunchEmployeeId] = useState<string | null>(null);

// After successful clock-out (around line 300), add:
if (action === 'clock_out') {
  setLastPunchEmployeeId(verifiedEmployee.id);
  setTipEntryOpen(true);
}

// Add dialog component before closing KioskMode div:
<Dialog open={tipEntryOpen} onOpenChange={setTipEntryOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Enter Your Tips</DialogTitle>
      <DialogDescription>
        Optional - How much did you earn in tips today?
      </DialogDescription>
    </DialogHeader>
    <div className="space-y-4">
      <div>
        <Label htmlFor="cash-tips">Cash Tips</Label>
        <Input
          id="cash-tips"
          type="number"
          step="0.01"
          placeholder="$0.00"
          value={cashTips}
          onChange={(e) => setCashTips(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="credit-tips">Credit Card Tips</Label>
        <Input
          id="credit-tips"
          type="number"
          step="0.01"
          placeholder="$0.00"
          value={creditTips}
          onChange={(e) => setCreditTips(e.target.value)}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Your manager will review and include in tip pool
      </p>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={handleSkipTips}>
        Skip
      </Button>
      <Button onClick={handleSubmitTips} disabled={submitting}>
        {submitting ? 'Submitting...' : 'Submit'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Handler Functions**:
```tsx
const handleSkipTips = () => {
  setTipEntryOpen(false);
  setCashTips('');
  setCreditTips('');
  setLastPunchEmployeeId(null);
};

const handleSubmitTips = async () => {
  if (!lastPunchEmployeeId || !restaurantId) return;
  
  const totalTips = (parseFloat(cashTips || '0') + parseFloat(creditTips || '0')) * 100;
  if (totalTips <= 0) {
    handleSkipTips();
    return;
  }

  setSubmitting(true);
  try {
    const { error } = await supabase.from('employee_tips').insert({
      restaurant_id: restaurantId,
      employee_id: lastPunchEmployeeId,
      tip_amount: totalTips,
      tip_source: 'cash', // Will be enhanced with actual breakdown
      recorded_at: new Date().toISOString(),
      notes: `Cash: $${cashTips || '0'}, Credit: $${creditTips || '0'}`,
    });

    if (error) throw error;

    setStatusMessage(`Tips submitted: ${formatCurrencyFromCents(totalTips)}`);
    handleSkipTips();
  } catch (err) {
    console.error('Error submitting tips:', err);
    setErrorMessage('Failed to submit tips. Please tell a manager.');
  } finally {
    setSubmitting(false);
  }
};
```

##### Option B: Employee Self-Service Page
Create `/employee/submit-tips` route for employees to submit tips anytime.

**New Files to Create**:
- `src/pages/EmployeeSubmitTips.tsx`
- `src/hooks/useEmployeeTips.tsx`
- `src/components/tips/EmployeeTipSubmissionForm.tsx`

**Route to Add** (`src/App.tsx`):
```tsx
<Route
  path="/employee/submit-tips"
  element={
    <ProtectedRoute allowStaff={true}>
      <EmployeeSubmitTips />
    </ProtectedRoute>
  }
/>
```

**Component Structure** (`EmployeeSubmitTips.tsx`):
```tsx
export const EmployeeSubmitTips = () => {
  // 1. Show shifts worked this week (from time_punches)
  // 2. Allow adding tips per shift
  // 3. Show status: pending, approved, included in pool
  // 4. Display total pending vs approved tips
  
  return (
    <div className="space-y-6">
      <EmployeePageHeader 
        icon={DollarSign}
        title="Submit Tips"
        subtitle="Declare your tips for manager review"
      />
      
      {/* Pending submissions */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          {/* List of pending employee_tips */}
        </CardContent>
      </Card>
      
      {/* Submit new tips */}
      <Card>
        <CardHeader>
          <CardTitle>Submit Tips for Today</CardTitle>
        </CardHeader>
        <CardContent>
          <EmployeeTipSubmissionForm />
        </CardContent>
      </Card>
    </div>
  );
};
```

#### Acceptance Criteria
- [ ] Employee can submit tips after clocking out OR from dedicated page
- [ ] Tips stored in `employee_tips` table with `tip_source` = 'cash'/'credit'
- [ ] Manager sees pending employee submissions in Tips page
- [ ] Manager can accept, adjust, or reject employee tips
- [ ] Employee receives feedback on submission status

**Estimated Effort**: 4-6 hours

---

### 2. Edit/Reopen Approved Splits

**Problem**: Once tips are approved, they're permanent. No way to fix mistakes.

**User Stories**:
- As a manager, when I realize I made a mistake, I want to reopen and fix an approved tip split
- As a manager, I want to see the history of changes to a tip split
- As an employee, I want to know if my tips were adjusted after approval

#### Implementation Plan

**Files to Modify**:
- `src/hooks/useTipSplits.tsx` - Add `reopenSplit` mutation
- `src/pages/Tips.tsx` - Add "Reopen" button flow
- `src/components/tips/RecentTipSplits.tsx` - Add edit action

**Database Changes**:
Create audit log table:
```sql
-- Migration: Add tip split audit trail
CREATE TABLE IF NOT EXISTS tip_split_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_split_id UUID NOT NULL REFERENCES tip_splits(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'approved', 'reopened', 'modified', 'archived')),
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  changes JSONB, -- { "field": "total_amount", "old": 15000, "new": 15500 }
  reason TEXT
);

CREATE INDEX idx_tip_split_audit_split ON tip_split_audit(tip_split_id);
```

**Hook Changes** (`useTipSplits.tsx`):
```tsx
// Add mutation for reopening
const { mutate: reopenSplit, isPending: isReopening } = useMutation({
  mutationFn: async (splitId: string) => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error('Not authenticated');

    // 1. Update split status to draft
    const { error: updateError } = await supabase
      .from('tip_splits')
      .update({ 
        status: 'draft',
        approved_by: null,
        approved_at: null 
      })
      .eq('id', splitId);

    if (updateError) throw updateError;

    // 2. Log audit event
    await supabase.from('tip_split_audit').insert({
      tip_split_id: splitId,
      action: 'reopened',
      changed_by: user.user.id,
      reason: 'Manager reopened for editing',
    });

    return splitId;
  },
  onSuccess: () => {
    queryClient.invalidateQueries(['tip-splits']);
    toast({ title: 'Split reopened for editing' });
  },
});
```

**UI Changes** (`RecentTipSplits.tsx`):
```tsx
{isApproved && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => onReopenSplit(split.id)}
  >
    <Edit className="h-3 w-3 mr-1" />
    Reopen & Edit
  </Button>
)}
```

**Audit Trail Display**:
Create new component: `src/components/tips/TipSplitAuditLog.tsx`
```tsx
export const TipSplitAuditLog = ({ splitId }: { splitId: string }) => {
  const { data: auditLog } = useQuery({
    queryKey: ['tip-split-audit', splitId],
    queryFn: async () => {
      const { data } = await supabase
        .from('tip_split_audit')
        .select(`
          *,
          user:auth.users(email)
        `)
        .eq('tip_split_id', splitId)
        .order('changed_at', { ascending: false });
      
      return data;
    },
  });

  return (
    <div className="space-y-2">
      {auditLog?.map(entry => (
        <div key={entry.id} className="flex items-center gap-2 text-sm">
          <Badge variant="outline">{entry.action}</Badge>
          <span>{entry.user?.email}</span>
          <span className="text-muted-foreground">
            {format(new Date(entry.changed_at), 'MMM d, h:mm a')}
          </span>
        </div>
      ))}
    </div>
  );
};
```

#### Acceptance Criteria
- [ ] Manager can click "Reopen" on approved splits
- [ ] Split returns to draft status, editable
- [ ] Changes are logged in `tip_split_audit` table
- [ ] Audit log visible in split detail view
- [ ] Employees notified when their tips are adjusted (future enhancement)

**Estimated Effort**: 3-4 hours

---

### 3. Audit Trail Visibility

**Problem**: Data is tracked (`created_by`, `approved_by`) but never shown to users.

**User Stories**:
- As a manager, I want to see who approved each tip split
- As an owner, I want to review the history of tip changes
- As an employee, I want to know who resolved my dispute

#### Implementation Plan

**Files to Modify**:
- `src/components/tips/RecentTipSplits.tsx` - Show creator/approver
- `src/components/tips/DisputeManager.tsx` - Show resolver
- `src/pages/Tips.tsx` - Show created/approved timestamps

**Changes to RecentTipSplits**:
```tsx
// Fetch user data with splits
const { data, error } = await supabase
  .from('tip_splits')
  .select(`
    *,
    items:tip_split_items(...),
    creator:auth.users!created_by(email),
    approver:auth.users!approved_by(email)
  `)
  ...

// Display in UI
<div className="text-xs text-muted-foreground">
  Created by {split.creator?.email || 'Unknown'}
  {split.approved_by && (
    <> • Approved by {split.approver?.email} on {format(new Date(split.approved_at), 'MMM d')}</>
  )}
</div>
```

**Changes to DisputeManager**:
```tsx
// Show who resolved dispute
{dispute.status === 'resolved' && (
  <div className="text-sm text-muted-foreground">
    Resolved by {dispute.resolver?.email} on {format(new Date(dispute.resolved_at), 'MMM d')}
  </div>
)}
```

#### Acceptance Criteria
- [ ] Split details show creator and approver emails
- [ ] Dispute details show resolver email
- [ ] Timestamps displayed in friendly format
- [ ] Audit log accessible from split detail view

**Estimated Effort**: 2 hours

---

## 🟡 High Priority (Next Sprint)

### 4. Weekly Pooling UI

**Problem**: Backend supports weekly splits, but no UI to enter/view weekly tips.

**User Stories**:
- As a manager, I want to enter total tips for the entire week
- As a manager, I want to see which days contributed to the weekly pool
- As an employee, I want to see my weekly tip total broken down by day

#### Implementation Plan

**Files to Modify**:
- `src/pages/Tips.tsx` - Add weekly view mode
- Create new component: `src/components/tips/WeeklyPoolingView.tsx`

**WeeklyPoolingView Component**:
```tsx
export const WeeklyPoolingView = ({ restaurantId }: Props) => {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = endOfWeek(weekStart);
  
  // Fetch all splits for the week
  const { splits } = useTipSplits(
    restaurantId,
    format(weekStart, 'yyyy-MM-dd'),
    format(weekEnd, 'yyyy-MM-dd')
  );
  
  // Calculate weekly totals
  const weeklyTotal = splits?.reduce((sum, s) => sum + s.total_amount, 0) || 0;
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Weekly Tips</CardTitle>
            <CardDescription>
              {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handlePrevWeek}>
              ← Previous
            </Button>
            <Button variant="outline" size="sm" onClick={handleNextWeek}>
              Next →
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Weekly total */}
        <div className="text-center p-6 bg-gradient-to-br from-primary/10 to-accent/10 rounded-lg mb-6">
          <p className="text-sm text-muted-foreground mb-1">Total Weekly Tips</p>
          <p className="text-4xl font-bold">{formatCurrencyFromCents(weeklyTotal)}</p>
        </div>
        
        {/* Per-day breakdown */}
        <div className="space-y-2">
          {eachDayOfInterval({ start: weekStart, end: weekEnd }).map(day => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const daySplit = splits?.find(s => s.split_date === dayKey);
            
            return (
              <div key={dayKey} className="flex items-center justify-between p-3 border rounded">
                <span>{format(day, 'EEEE, MMM d')}</span>
                <span className="font-semibold">
                  {daySplit ? formatCurrencyFromCents(daySplit.total_amount) : '$0.00'}
                </span>
              </div>
            );
          })}
        </div>
        
        {/* Approve entire week */}
        <Button className="w-full mt-6" onClick={handleApproveWeek}>
          Approve Weekly Tips
        </Button>
      </CardContent>
    </Card>
  );
};
```

**Integration in Tips.tsx**:
```tsx
{splitCadence === 'weekly' && viewMode === 'daily' && (
  <WeeklyPoolingView restaurantId={restaurantId} />
)}
```

#### Acceptance Criteria
- [ ] Week selector (previous/next buttons)
- [ ] Display weekly total with per-day breakdown
- [ ] Can approve entire week at once
- [ ] Employee view shows weekly tips aggregated

**Estimated Effort**: 4-5 hours

---

### 5. Draft List Integration

**Problem**: `TipDraftsList` component exists but is not used in Tips.tsx.

**User Stories**:
- As a manager, I want to see all my saved drafts in one place
- As a manager, I want to resume editing any draft
- As a manager, I want to delete old drafts I no longer need

#### Implementation Plan

**Files to Modify**:
- `src/pages/Tips.tsx` - Import and render TipDraftsList

**Changes Needed**:
```tsx
// Add import
import { TipDraftsList } from '@/components/tips/TipDraftsList';

// In daily view, add before TipHistoricalEntry:
{viewMode === 'daily' && (
  <>
    {restaurantId && (
      <TipDraftsList 
        restaurantId={restaurantId} 
        onResumeDraft={handleResumeDraft} 
      />
    )}
    
    <TipHistoricalEntry
      currentDate={selectedDate}
      onDateSelected={setSelectedDate}
    />
    
    {/* Existing daily entry UI... */}
  </>
)}
```

**Enhance TipDraftsList**:
Add delete functionality:
```tsx
const { mutate: deleteDraft } = useMutation({
  mutationFn: async (draftId: string) => {
    const { error } = await supabase
      .from('tip_splits')
      .delete()
      .eq('id', draftId)
      .eq('status', 'draft'); // Safety: only delete drafts
    
    if (error) throw error;
  },
  onSuccess: () => {
    queryClient.invalidateQueries(['tip-splits']);
    toast({ title: 'Draft deleted' });
  },
});
```

#### Acceptance Criteria
- [ ] Draft list visible in daily view
- [ ] Can resume any draft
- [ ] Can delete drafts with confirmation
- [ ] Empty state when no drafts

**Estimated Effort**: 1 hour

---

### 6. Retroactive Adjustments

**Problem**: No workflow for correcting past splits without deleting.

**User Stories**:
- As a manager, I want to adjust Maria's tips from last Tuesday
- As a manager, I want to add a note explaining why tips were adjusted
- As an employee, I want to be notified when my tips are adjusted

#### Implementation Plan

This is essentially an extension of "Edit/Reopen Approved Splits" (#2), but with additional features:

**Additional Changes**:

1. **Adjustment Notes**:
```tsx
// Add to tip_splits table
ALTER TABLE tip_splits ADD COLUMN adjustment_reason TEXT;
ALTER TABLE tip_splits ADD COLUMN adjusted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE tip_splits ADD COLUMN adjusted_by UUID REFERENCES auth.users(id);

// When reopening, prompt for reason:
<Dialog>
  <DialogHeader>
    <DialogTitle>Reopen Tip Split</DialogTitle>
  </DialogHeader>
  <DialogContent>
    <Label>Reason for adjustment</Label>
    <Textarea
      placeholder="Explain why you're changing this split..."
      value={adjustmentReason}
      onChange={(e) => setAdjustmentReason(e.target.value)}
    />
  </DialogContent>
  <DialogFooter>
    <Button onClick={handleReopen}>Reopen & Edit</Button>
  </DialogFooter>
</Dialog>
```

2. **Employee Notification** (Future Enhancement):
```tsx
// After adjustment approved, create notification
await supabase.from('notifications').insert({
  user_id: employee.user_id,
  type: 'tip_adjusted',
  title: 'Your tips were adjusted',
  message: `Tips for ${date} updated. ${adjustmentReason}`,
});
```

#### Acceptance Criteria
- [ ] Can reopen and adjust any approved split
- [ ] Must provide reason for adjustment
- [ ] Adjustment reason visible to employees
- [ ] Audit trail shows old vs new values
- [ ] (Future) Employees notified of changes

**Estimated Effort**: 3 hours

---

## 🟢 Medium Priority (Soon)

### 7. Notification System

**Problem**: No alerts when tips are approved or disputes are filed.

**Implementation Notes**:
- Create `notifications` table (generic system-wide)
- Badge count on bell icon in header
- In-app notification center
- Email notifications (optional)

**Estimated Effort**: 6-8 hours

---

### 8. POS Auto-Sync

**Problem**: Tips must be manually imported each day.

**Implementation Notes**:
- Edge Function triggered by cron (nightly at 1 AM)
- Fetch tips from unified_sales
- Auto-create draft splits
- Manager just reviews and approves

**Estimated Effort**: 4 hours

---

### 9. Dispute Bulk Actions

**Problem**: Must resolve disputes one at a time.

**Implementation Notes**:
- Add checkboxes to DisputeManager
- "Mark all as reviewed" button
- Bulk resolve with single note

**Estimated Effort**: 2 hours

---

## ⚪ Low Priority (Nice to Have)

### 10. Shift-Level Splits

**Problem**: No UI for separate lunch/dinner pools.

**Implementation Notes**:
- Add shift selector in setup
- Tag time punches with shift
- Separate pools per shift

**Estimated Effort**: 5-6 hours

---

### 11. Multi-Location Support

**Problem**: Cannot split tips separately per location.

**Implementation Notes**:
- Add location filter to Tips page
- Scope settings by location
- Separate pools per location

**Estimated Effort**: 4 hours

---

## 📚 Related Files & Components

### Existing Components (Already Built)
- ✅ `src/hooks/useTipPoolSettings.tsx` - Settings CRUD
- ✅ `src/hooks/useTipSplits.tsx` - Split management
- ✅ `src/hooks/useTipDisputes.tsx` - Dispute CRUD
- ✅ `src/components/tips/TipReviewScreen.tsx` - Review & approve
- ✅ `src/components/tips/TipDraftsList.tsx` - Draft list (NOT integrated)
- ✅ `src/components/tips/TipHistoricalEntry.tsx` - Date picker
- ✅ `src/components/tips/DisputeManager.tsx` - Manager dispute view
- ✅ `src/components/tips/TipDispute.tsx` - Employee dispute button
- ✅ `src/pages/EmployeeTips.tsx` - Employee view

### Database Tables (Already Exist)
- ✅ `tip_pool_settings` - Configuration
- ✅ `tip_splits` - Daily/weekly splits
- ✅ `tip_split_items` - Individual allocations
- ✅ `tip_disputes` - Employee disputes
- ✅ `employee_tips` - Legacy/individual tip records

### Missing Components (Need to Create)
- ❌ `src/components/tips/TipSubmissionForm.tsx` - Employee submission
- ❌ `src/components/tips/WeeklyPoolingView.tsx` - Weekly view
- ❌ `src/components/tips/TipSplitAuditLog.tsx` - Change history
- ❌ `src/pages/EmployeeSubmitTips.tsx` - Employee submission page
- ❌ `src/hooks/useEmployeeTips.tsx` - Employee tips CRUD

### Missing Database Tables (Need to Create)
- ❌ `tip_split_audit` - Change tracking

---

## 🧪 Testing Requirements

For each feature implemented, ensure:
- [ ] Unit tests for calculation logic
- [ ] Integration tests for API calls
- [ ] E2E tests for user workflows
- [ ] Accessibility testing (keyboard navigation, screen readers)
- [ ] Mobile responsiveness

---

## 📝 Implementation Notes

### General Guidelines
- Follow existing patterns in `Tips.tsx` and `EmployeeTips.tsx`
- Use semantic color tokens (no hardcoded colors)
- All currency in cents (convert only for display)
- Handle loading/error states
- Add proper ARIA labels
- Memoize expensive calculations
- Use React Query for data fetching (30s staleTime)

### Security Considerations
- RLS policies must prevent unauthorized access
- Employees can only submit their own tips
- Managers can only edit their restaurant's splits
- Validate all inputs server-side
- Log all changes for audit trail

### Performance Considerations
- Paginate large split lists
- Optimize queries with proper indexes
- Use React Query caching effectively
- Lazy load audit logs (fetch on demand)

---

## 📊 Progress Tracking

| Feature | Priority | Status | Estimated Hours | Assignee | Completion Date |
|---------|----------|--------|-----------------|----------|-----------------|
| Employee Tip Submission | 🔴 Critical | Not Started | 4-6 | - | - |
| Edit Approved Splits | 🔴 Critical | Not Started | 3-4 | - | - |
| Audit Trail Display | 🔴 Critical | Not Started | 2 | - | - |
| Weekly Pooling UI | 🟡 High | Not Started | 4-5 | - | - |
| Draft List Integration | 🟡 High | Not Started | 1 | - | - |
| Retroactive Adjustments | 🟡 High | Not Started | 3 | - | - |
| Notification System | 🟢 Medium | Not Started | 6-8 | - | - |
| POS Auto-Sync | 🟢 Medium | Not Started | 4 | - | - |
| Dispute Bulk Actions | 🟢 Medium | Not Started | 2 | - | - |
| Shift-Level Splits | ⚪ Low | Not Started | 5-6 | - | - |
| Multi-Location Support | ⚪ Low | Not Started | 4 | - | - |

**Total Estimated Effort**: 38-49 hours

---

## 🎯 Recommended Implementation Order

### Week 1 (Critical)
1. Employee Tip Submission (clock-out flow)
2. Edit Approved Splits
3. Audit Trail Display
4. Draft List Integration

**Total**: ~10-12 hours

### Week 2 (High Priority)
5. Weekly Pooling UI
6. Retroactive Adjustments

**Total**: ~7-8 hours

### Week 3 (Medium Priority)
7. Notification System
8. POS Auto-Sync
9. Dispute Bulk Actions

**Total**: ~12-14 hours

### Future (Low Priority)
10. Shift-Level Splits
11. Multi-Location Support

**Total**: ~9-10 hours

---

## 📞 Questions & Clarifications

If implementing any of these features, consider:

1. **Employee Tip Submission**:
   - Should employees be able to edit submitted tips before manager review?
   - Should there be a deadline (e.g., must submit by end of shift)?
   - What happens if employee forgets to submit tips?

2. **Edit Approved Splits**:
   - Should there be a time limit for editing (e.g., only within 7 days)?
   - Should employees be automatically notified of adjustments?
   - What happens to payroll if tips already processed?

3. **Weekly Pooling**:
   - Should manager enter one total for week, or per-day amounts?
   - How to handle incomplete weeks (holidays, closures)?
   - Should it show comparison to previous weeks?

4. **Notifications**:
   - In-app only, or also email/SMS?
   - Real-time (websockets) or poll-based?
   - Allow users to configure notification preferences?

---

**End of Document** - Ready for implementation!
