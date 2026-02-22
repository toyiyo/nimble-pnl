# Overtime Management UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add UI for configuring overtime rules, marking employees exempt, and adjusting overtime classifications.

**Architecture:** Three additions to existing pages — Payroll tab in RestaurantSettings, exempt toggle in EmployeeDialog, Adjust OT dialog on Payroll page. Each follows the established pattern in its host file.

**Tech Stack:** React, TypeScript, shadcn/ui, Supabase, React Query

---

### Task 1: Add Exempt Toggle to Employee Dialog

**Files:**
- Modify: `src/components/EmployeeDialog.tsx`

**Context:** The `Employee` type already has `is_exempt?: boolean`. The DB columns `is_exempt`, `exempt_changed_at`, `exempt_changed_by` already exist. We just need the UI toggle.

**Step 1: Add state and initialization**

In `EmployeeDialog.tsx`, add state near the other compensation state vars (around line 54):

```typescript
const [isExempt, setIsExempt] = useState(false);
```

In the `useEffect` that populates form from existing employee (around line 108), add:

```typescript
setIsExempt(employee.is_exempt ?? false);
```

In the `resetForm` function, add:

```typescript
setIsExempt(false);
```

**Step 2: Add the exempt toggle UI**

After the hourly rate input field (around line 582, inside the `compensationType === 'hourly'` block), add:

```tsx
<div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/30 p-3">
  <div className="space-y-0.5">
    <Label htmlFor="isExempt" className="text-[14px] font-medium text-foreground cursor-pointer">
      Exempt from Overtime
    </Label>
    <p className="text-[13px] text-muted-foreground">
      Exempt employees are not eligible for overtime pay
    </p>
  </div>
  <Switch
    id="isExempt"
    checked={isExempt}
    onCheckedChange={setIsExempt}
    className="data-[state=checked]:bg-foreground"
    aria-label="Mark employee as exempt from overtime"
  />
</div>
```

**Step 3: Add FLSA salary warning**

Below the exempt toggle (still inside the hourly block), add the conditional warning:

```tsx
{isExempt && (() => {
  const annualizedPay = (Number.parseFloat(hourlyRate || '0') * 100) * 2080 / 100;
  return annualizedPay < 35568 ? (
    <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
      <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
      <p className="text-[13px] text-amber-700 dark:text-amber-400">
        This employee's annualized pay (${annualizedPay.toLocaleString('en-US', { maximumFractionDigits: 0 })}/year) is below the FLSA exempt threshold ($35,568/year). Consult labor law before classifying as exempt.
      </p>
    </div>
  ) : null;
})()}
```

Import `AlertTriangle` from lucide-react and `Switch` from `@/components/ui/switch` if not already imported.

**Step 4: Wire into form submission**

In `proceedWithSubmit` (around line 400), add `is_exempt` to the `employeeData` object:

```typescript
is_exempt: isExempt,
```

**Step 5: Verify manually**

Run: `npm run dev`
- Open the Employee dialog for an hourly employee
- Toggle "Exempt from Overtime" on
- Set hourly rate to $10 → verify amber warning appears
- Set hourly rate to $25 → verify warning disappears
- Save → verify `is_exempt` is persisted in the database

**Step 6: Commit**

```bash
git add src/components/EmployeeDialog.tsx
git commit -m "feat(payroll): add FLSA exempt toggle to employee dialog"
```

---

### Task 2: Add Payroll Tab to Restaurant Settings

**Files:**
- Modify: `src/pages/RestaurantSettings.tsx`

**Context:** Settings page uses `Tabs` with a dynamic `allowedTabs` array and conditional `TabsTrigger` elements. OT rules are stored in `overtime_rules` table (one row per restaurant, upsert). The Supabase client is already available via `useSupabaseClient()` or similar.

**Step 1: Add "payroll" to allowedTabs**

In the `allowedTabs` useMemo (around line 188), add `'payroll'` for owners/managers:

```typescript
const allowedTabs = useMemo(() => {
  return [
    'general',
    ...(canEdit ? ['business'] : []),
    ...(canEdit ? ['payroll'] : []),    // ADD THIS LINE
    ...(isOwner ? ['subscription'] : []),
    ...(canEdit ? ['notifications'] : []),
    'security',
  ];
}, [isOwner, canEdit]);
```

Update `gridColsClass` to account for the new tab count.

**Step 2: Add TabsTrigger**

After the Business tab trigger (around line 307), add:

```tsx
{canEdit && (
  <TabsTrigger value="payroll">
    <Clock className="h-4 w-4 mr-2" />
    Payroll
  </TabsTrigger>
)}
```

Import `Clock` from lucide-react.

**Step 3: Add state for OT rules**

Add state variables at the top of the component:

```typescript
const [otWeeklyThreshold, setOtWeeklyThreshold] = useState('40');
const [otWeeklyMultiplier, setOtWeeklyMultiplier] = useState('1.5');
const [otDailyEnabled, setOtDailyEnabled] = useState(false);
const [otDailyThreshold, setOtDailyThreshold] = useState('8');
const [otDailyMultiplier, setOtDailyMultiplier] = useState('1.5');
const [otDoubleEnabled, setOtDoubleEnabled] = useState(false);
const [otDoubleThreshold, setOtDoubleThreshold] = useState('12');
const [otDoubleMultiplier, setOtDoubleMultiplier] = useState('2.0');
const [otExcludeTips, setOtExcludeTips] = useState(true);
const [otRulesLoading, setOtRulesLoading] = useState(false);
const [otSaving, setOtSaving] = useState(false);
```

**Step 4: Fetch existing OT rules on mount**

Add a `useEffect` to load existing rules:

```typescript
useEffect(() => {
  if (!selectedRestaurant) return;
  const fetchOtRules = async () => {
    setOtRulesLoading(true);
    const { data } = await supabase
      .from('overtime_rules')
      .select('*')
      .eq('restaurant_id', selectedRestaurant.restaurant_id)
      .maybeSingle();

    if (data) {
      setOtWeeklyThreshold(String(data.weekly_threshold_hours));
      setOtWeeklyMultiplier(String(data.weekly_ot_multiplier));
      setOtDailyEnabled(data.daily_threshold_hours != null);
      setOtDailyThreshold(String(data.daily_threshold_hours ?? 8));
      setOtDailyMultiplier(String(data.daily_ot_multiplier));
      setOtDoubleEnabled(data.daily_double_threshold_hours != null);
      setOtDoubleThreshold(String(data.daily_double_threshold_hours ?? 12));
      setOtDoubleMultiplier(String(data.daily_double_multiplier));
      setOtExcludeTips(data.exclude_tips_from_ot_rate);
    }
    setOtRulesLoading(false);
  };
  fetchOtRules();
}, [selectedRestaurant?.restaurant_id]);
```

**Step 5: Add save handler for OT rules**

```typescript
const handleSaveOtRules = async () => {
  if (!selectedRestaurant) return;
  setOtSaving(true);
  try {
    const { error } = await supabase
      .from('overtime_rules')
      .upsert({
        restaurant_id: selectedRestaurant.restaurant_id,
        weekly_threshold_hours: Number.parseFloat(otWeeklyThreshold),
        weekly_ot_multiplier: Number.parseFloat(otWeeklyMultiplier),
        daily_threshold_hours: otDailyEnabled ? Number.parseFloat(otDailyThreshold) : null,
        daily_ot_multiplier: Number.parseFloat(otDailyMultiplier),
        daily_double_threshold_hours: otDoubleEnabled ? Number.parseFloat(otDoubleThreshold) : null,
        daily_double_multiplier: Number.parseFloat(otDoubleMultiplier),
        exclude_tips_from_ot_rate: otExcludeTips,
      }, { onConflict: 'restaurant_id' });

    if (error) throw error;
    toast({ title: 'Overtime rules saved', description: 'Payroll overtime settings have been updated.' });
  } catch (err) {
    toast({ title: 'Failed to save overtime rules', description: err instanceof Error ? err.message : 'An error occurred', variant: 'destructive' });
  } finally {
    setOtSaving(false);
  }
};
```

**Step 6: Add TabsContent with OT rules form**

Add after the last `TabsContent` block:

```tsx
<TabsContent value="payroll" className="space-y-6">
  <Card>
    <CardHeader>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
          <Clock className="h-5 w-5 text-foreground" />
        </div>
        <div>
          <CardTitle className="text-[17px]">Overtime Rules</CardTitle>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Configure how overtime is calculated for hourly employees
          </p>
        </div>
      </div>
    </CardHeader>
    <CardContent className="space-y-6">
      {/* Weekly Overtime */}
      <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
          <h3 className="text-[13px] font-semibold text-foreground">Weekly Overtime</h3>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Threshold (hours)
              </Label>
              <Input
                type="number"
                step="0.5"
                min="0"
                value={otWeeklyThreshold}
                onChange={(e) => setOtWeeklyThreshold(e.target.value)}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Multiplier
              </Label>
              <Input
                type="number"
                step="0.1"
                min="1"
                value={otWeeklyMultiplier}
                onChange={(e) => setOtWeeklyMultiplier(e.target.value)}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Daily Overtime */}
      <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">Daily Overtime</h3>
          <Switch
            checked={otDailyEnabled}
            onCheckedChange={setOtDailyEnabled}
            className="data-[state=checked]:bg-foreground"
            aria-label="Enable daily overtime"
          />
        </div>
        {otDailyEnabled && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Threshold (hours)
                </Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={otDailyThreshold}
                  onChange={(e) => setOtDailyThreshold(e.target.value)}
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Multiplier
                </Label>
                <Input
                  type="number"
                  step="0.1"
                  min="1"
                  value={otDailyMultiplier}
                  onChange={(e) => setOtDailyMultiplier(e.target.value)}
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                />
              </div>
            </div>

            {/* Double Time (nested inside daily) */}
            <div className="flex items-center justify-between rounded-lg border border-border/40 p-3">
              <div>
                <p className="text-[14px] font-medium text-foreground">Double Time</p>
                <p className="text-[13px] text-muted-foreground">Extra rate after extended daily hours</p>
              </div>
              <Switch
                checked={otDoubleEnabled}
                onCheckedChange={setOtDoubleEnabled}
                className="data-[state=checked]:bg-foreground"
                aria-label="Enable double time"
              />
            </div>
            {otDoubleEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Threshold (hours)
                  </Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    value={otDoubleThreshold}
                    onChange={(e) => setOtDoubleThreshold(e.target.value)}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Multiplier
                  </Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="1"
                    value={otDoubleMultiplier}
                    onChange={(e) => setOtDoubleMultiplier(e.target.value)}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tip Exclusion */}
      <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/30 p-4">
        <div>
          <p className="text-[14px] font-medium text-foreground">Exclude Tips from OT Rate</p>
          <p className="text-[13px] text-muted-foreground">
            When enabled, tips are not included in the overtime rate calculation
          </p>
        </div>
        <Switch
          checked={otExcludeTips}
          onCheckedChange={setOtExcludeTips}
          className="data-[state=checked]:bg-foreground"
          aria-label="Exclude tips from overtime rate"
        />
      </div>
    </CardContent>
    <CardFooter className="flex justify-end border-t pt-4">
      <Button
        onClick={handleSaveOtRules}
        disabled={otSaving || !canEdit}
        className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
      >
        {otSaving ? 'Saving...' : 'Save Overtime Rules'}
      </Button>
    </CardFooter>
  </Card>
</TabsContent>
```

**Step 7: Verify manually**

Run: `npm run dev`
- Go to Settings → verify "Payroll" tab appears
- Click Payroll tab → verify OT rules form renders with defaults
- Toggle daily overtime on → verify threshold/multiplier fields appear
- Toggle double time on → verify nested fields appear
- Change values and save → verify toast and DB persistence
- Refresh page → verify values are loaded from DB

**Step 8: Commit**

```bash
git add src/pages/RestaurantSettings.tsx
git commit -m "feat(payroll): add Payroll tab with overtime rules configuration"
```

---

### Task 3: Create AdjustOvertimeDialog Component

**Files:**
- Create: `src/components/payroll/AdjustOvertimeDialog.tsx`

**Context:** Follows the same pattern as `AddManualPaymentDialog.tsx`. The `overtime_adjustments` table expects: `restaurant_id`, `employee_id`, `punch_date`, `adjustment_type`, `hours`, `reason`, `adjusted_by`.

**Step 1: Create the dialog component**

```tsx
import { useState } from 'react';
import { format } from 'date-fns';
import { Clock, Calendar, FileText, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AdjustOvertimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  employeeId: string;
  regularHours: number;
  overtimeHours: number;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  onSubmit: (data: {
    employeeId: string;
    punchDate: string;
    adjustmentType: 'regular_to_overtime' | 'overtime_to_regular';
    hours: number;
    reason: string;
  }) => void;
  isSubmitting?: boolean;
}

export function AdjustOvertimeDialog({
  open,
  onOpenChange,
  employeeName,
  employeeId,
  regularHours,
  overtimeHours,
  periodStart,
  periodEnd,
  onSubmit,
  isSubmitting = false,
}: AdjustOvertimeDialogProps) {
  const [adjustmentType, setAdjustmentType] = useState<'regular_to_overtime' | 'overtime_to_regular'>('regular_to_overtime');
  const [hours, setHours] = useState('');
  const [punchDate, setPunchDate] = useState(periodStart);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ hours?: string; punchDate?: string }>({});

  const maxHours = adjustmentType === 'regular_to_overtime' ? regularHours : overtimeHours;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: { hours?: string; punchDate?: string } = {};

    const hoursValue = Number.parseFloat(hours);
    if (!hours || Number.isNaN(hoursValue) || hoursValue <= 0) {
      newErrors.hours = 'Enter a valid number of hours';
    } else if (hoursValue > maxHours) {
      newErrors.hours = `Cannot exceed ${maxHours.toFixed(2)} available hours`;
    }

    if (!punchDate) {
      newErrors.punchDate = 'Select a date';
    } else if (punchDate < periodStart || punchDate > periodEnd) {
      newErrors.punchDate = 'Date must be within the pay period';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit({
      employeeId,
      punchDate,
      adjustmentType,
      hours: hoursValue,
      reason: reason || '',
    });

    resetForm();
  };

  const resetForm = () => {
    setAdjustmentType('regular_to_overtime');
    setHours('');
    setPunchDate(periodStart);
    setReason('');
    setErrors({});
  };

  const handleClose = () => {
    if (!isSubmitting) {
      resetForm();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-[17px]">Adjust Overtime</DialogTitle>
          <DialogDescription className="text-[13px]">
            Reclassify hours for <span className="font-medium">{employeeName}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Direction */}
          <div className="space-y-2">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Adjustment Type
            </Label>
            <Select
              value={adjustmentType}
              onValueChange={(v) => setAdjustmentType(v as 'regular_to_overtime' | 'overtime_to_regular')}
            >
              <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regular_to_overtime">Regular → Overtime</SelectItem>
                <SelectItem value="overtime_to_regular">Overtime → Regular</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Hours */}
          <div className="space-y-2">
            <Label htmlFor="adjust-hours" className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              <Clock className="h-3.5 w-3.5" />
              Hours (max {maxHours.toFixed(2)})
            </Label>
            <Input
              id="adjust-hours"
              type="number"
              step="0.25"
              min="0.25"
              max={maxHours}
              value={hours}
              onChange={(e) => {
                setHours(e.target.value);
                setErrors((prev) => ({ ...prev, hours: undefined }));
              }}
              placeholder="0.00"
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
              aria-invalid={!!errors.hours}
            />
            {errors.hours && (
              <p className="text-[13px] text-destructive">{errors.hours}</p>
            )}
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="adjust-date" className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              <Calendar className="h-3.5 w-3.5" />
              Date
            </Label>
            <Input
              id="adjust-date"
              type="date"
              min={periodStart}
              max={periodEnd}
              value={punchDate}
              onChange={(e) => {
                setPunchDate(e.target.value);
                setErrors((prev) => ({ ...prev, punchDate: undefined }));
              }}
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
              aria-invalid={!!errors.punchDate}
            />
            {errors.punchDate && (
              <p className="text-[13px] text-destructive">{errors.punchDate}</p>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="adjust-reason" className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              <FileText className="h-3.5 w-3.5" />
              Reason (optional)
            </Label>
            <Textarea
              id="adjust-reason"
              placeholder="e.g., Manager-approved schedule change..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="text-[14px] bg-muted/30 border-border/40 rounded-lg"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="h-9 rounded-lg text-[13px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Apply Adjustment'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/payroll/AdjustOvertimeDialog.tsx
git commit -m "feat(payroll): add AdjustOvertimeDialog component"
```

---

### Task 4: Add Overtime Adjustment Mutation to usePayroll

**Files:**
- Modify: `src/hooks/usePayroll.tsx`

**Context:** Follow the same pattern as `addManualPaymentMutation`. Insert into `overtime_adjustments` table. Invalidate `['payroll', restaurantId]` on success.

**Step 1: Add the mutation**

After the `deleteManualPaymentMutation` (around line 403), add:

```typescript
const adjustOvertimeMutation = useMutation({
  mutationFn: async ({
    employeeId,
    punchDate,
    adjustmentType,
    hours,
    reason,
  }: {
    employeeId: string;
    punchDate: string;
    adjustmentType: 'regular_to_overtime' | 'overtime_to_regular';
    hours: number;
    reason: string;
  }) => {
    if (!restaurantId) throw new Error('Restaurant ID required');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('overtime_adjustments')
      .upsert({
        restaurant_id: restaurantId,
        employee_id: employeeId,
        punch_date: punchDate,
        adjustment_type: adjustmentType,
        hours,
        reason,
        adjusted_by: user.id,
      }, { onConflict: 'restaurant_id,employee_id,punch_date,adjustment_type' })
      .select()
      .single();

    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    toast({
      title: 'Overtime adjusted',
      description: 'The overtime classification has been updated.',
    });
    queryClient.invalidateQueries({ queryKey: ['payroll', restaurantId] });
  },
  onError: (error) => {
    toast({
      title: 'Error adjusting overtime',
      description: error.message,
      variant: 'destructive',
    });
  },
});
```

**Step 2: Expose in the return object**

Add to the return object:

```typescript
adjustOvertime: adjustOvertimeMutation.mutate,
isAdjustingOvertime: adjustOvertimeMutation.isPending,
```

**Step 3: Commit**

```bash
git add src/hooks/usePayroll.tsx
git commit -m "feat(payroll): add adjustOvertime mutation to usePayroll hook"
```

---

### Task 5: Wire Adjust OT Button and Dialog into Payroll Page

**Files:**
- Modify: `src/pages/Payroll.tsx`

**Context:** Add an "Adjust OT" button in the Actions column for hourly employees. Opens the `AdjustOvertimeDialog`. Follows the same state pattern as `AddManualPaymentDialog`.

**Step 1: Add imports**

```typescript
import { AdjustOvertimeDialog } from '@/components/payroll/AdjustOvertimeDialog';
import { Clock } from 'lucide-react';
```

**Step 2: Destructure new hook values**

Update the `usePayroll` destructuring to include:

```typescript
const {
  payrollPeriod,
  loading,
  error,
  refetch,
  addManualPayment,
  isAddingPayment,
  adjustOvertime,        // ADD
  isAdjustingOvertime,   // ADD
} = usePayroll(restaurantId, start, end);
```

**Step 3: Add dialog state**

Near the existing `paymentDialogOpen` state (around line 118):

```typescript
const [otDialogOpen, setOtDialogOpen] = useState(false);
const [otSelectedEmployee, setOtSelectedEmployee] = useState<{
  id: string;
  name: string;
  regularHours: number;
  overtimeHours: number;
} | null>(null);
```

**Step 4: Add click handler**

Near the existing `handleAddPayment` (around line 180):

```typescript
const handleAdjustOT = (employeeId: string, employeeName: string, regularHours: number, overtimeHours: number) => {
  setOtSelectedEmployee({ id: employeeId, name: employeeName, regularHours, overtimeHours });
  setOtDialogOpen(true);
};

const handleOtSubmit = (data: {
  employeeId: string;
  punchDate: string;
  adjustmentType: 'regular_to_overtime' | 'overtime_to_regular';
  hours: number;
  reason: string;
}) => {
  adjustOvertime(data);
  setOtDialogOpen(false);
  setOtSelectedEmployee(null);
};
```

**Step 5: Add Adjust OT button to table Actions column**

In the Actions column `<TableCell>` (around line 585), add the button for hourly employees who have hours:

```tsx
{employee.compensationType === 'hourly' && (employee.regularHours > 0 || employee.overtimeHours > 0) && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => handleAdjustOT(
      employee.employeeId,
      employee.employeeName,
      employee.regularHours,
      employee.overtimeHours
    )}
    aria-label={`Adjust overtime for ${employee.employeeName}`}
  >
    <Clock className="h-4 w-4 mr-1" />
    Adjust OT
  </Button>
)}
```

**Step 6: Render the dialog**

Near the existing `AddManualPaymentDialog` render (around line 684):

```tsx
{otSelectedEmployee && (
  <AdjustOvertimeDialog
    open={otDialogOpen}
    onOpenChange={setOtDialogOpen}
    employeeName={otSelectedEmployee.name}
    employeeId={otSelectedEmployee.id}
    regularHours={otSelectedEmployee.regularHours}
    overtimeHours={otSelectedEmployee.overtimeHours}
    periodStart={format(start, 'yyyy-MM-dd')}
    periodEnd={format(end, 'yyyy-MM-dd')}
    onSubmit={handleOtSubmit}
    isSubmitting={isAdjustingOvertime}
  />
)}
```

**Step 7: Verify manually**

Run: `npm run dev`
- Go to Payroll page
- Find an hourly employee with hours → verify "Adjust OT" button appears
- Click it → verify dialog opens with correct employee name
- Select "Regular → Overtime", enter hours, pick date, submit
- Verify toast appears and payroll recalculates
- Verify contractor/salary employees do NOT have the button

**Step 8: Commit**

```bash
git add src/pages/Payroll.tsx
git commit -m "feat(payroll): add Adjust OT button and dialog to payroll table"
```

---

### Task 6: Full Regression Test

**Step 1: Run all unit tests**

```bash
npm run test
```

Expected: All existing tests pass. No regressions.

**Step 2: Run lint**

```bash
npm run lint 2>&1 | head -50
```

Fix any new lint errors in modified files only.

**Step 3: Manual smoke test**

1. Settings → Payroll tab → configure OT rules → save → refresh → verify persistence
2. Employee dialog → toggle exempt → verify warning → save → verify persistence
3. Payroll → Adjust OT → submit → verify recalculation
4. Export CSV → verify all new columns present

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address lint errors and test regressions"
```
