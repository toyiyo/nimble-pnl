# Daily Tip Payouts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track daily cash tip payouts so payroll only includes unpaid tip balances, preventing double-payment.

**Architecture:** New `tip_payouts` table records per-employee cash disbursements. Tips page gets a "Record Payout" flow on approved splits. Payroll deducts already-paid amounts, showing Tips Earned / Tips Paid / Tips Owed columns.

**Tech Stack:** Supabase (PostgreSQL migration + RLS), React Query hook, shadcn Sheet component, Recharts-free pure calculation utils.

---

### Task 1: Create `tip_payouts` database migration

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_create_tip_payouts_table.sql`

**Step 1: Write the migration SQL**

Use the same patterns as `supabase/migrations/20251217000001_create_tip_pooling_tables.sql` for RLS policies.

```sql
-- Migration: Create tip_payouts table for tracking daily cash tip disbursements
-- See: docs/plans/2026-02-18-daily-tip-payouts-design.md

CREATE TABLE IF NOT EXISTS tip_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  payout_date DATE NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0), -- cents
  tip_split_id UUID REFERENCES tip_splits(id) ON DELETE SET NULL,
  notes TEXT,
  paid_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Prevent duplicate payouts for same employee/date/split
-- Use COALESCE to handle NULL tip_split_id in unique constraint
CREATE UNIQUE INDEX idx_tip_payouts_unique
  ON tip_payouts (restaurant_id, employee_id, payout_date, COALESCE(tip_split_id, '00000000-0000-0000-0000-000000000000'));

-- Query indexes
CREATE INDEX idx_tip_payouts_restaurant_date ON tip_payouts(restaurant_id, payout_date);
CREATE INDEX idx_tip_payouts_employee_date ON tip_payouts(restaurant_id, employee_id, payout_date);
CREATE INDEX idx_tip_payouts_split ON tip_payouts(tip_split_id);

-- Enable RLS
ALTER TABLE tip_payouts ENABLE ROW LEVEL SECURITY;

-- RLS: Managers can CRUD
CREATE POLICY "Managers can view tip payouts"
  ON tip_payouts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can insert tip payouts"
  ON tip_payouts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can update tip payouts"
  ON tip_payouts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can delete tip payouts"
  ON tip_payouts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Employees can view their own payouts
CREATE POLICY "Employees can view their own tip payouts"
  ON tip_payouts FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- updated_at trigger (reuse existing function from tip pooling tables)
CREATE TRIGGER update_tip_payouts_updated_at
  BEFORE UPDATE ON tip_payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_tip_pooling_updated_at();

COMMENT ON TABLE tip_payouts IS 'Tracks daily cash tip disbursements to employees. Used by payroll to deduct already-paid tips.';
COMMENT ON COLUMN tip_payouts.amount IS 'Payout amount in cents';
COMMENT ON COLUMN tip_payouts.tip_split_id IS 'Optional link to the tip split this payout covers';
```

**Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `create_tip_payouts_table`.

**Step 3: Verify the table exists**

Run SQL: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tip_payouts' ORDER BY ordinal_position;`

**Step 4: Commit**

```bash
git add supabase/migrations/*_create_tip_payouts_table.sql
git commit -m "feat: add tip_payouts table for daily cash tip tracking"
```

---

### Task 2: Add `useTipPayouts` hook

**Files:**
- Create: `src/hooks/useTipPayouts.tsx`

**Step 1: Write the hook**

Pattern follows `src/hooks/useTipSplits.tsx` (React Query + Supabase CRUD mutations).

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface TipPayout {
  id: string;
  restaurant_id: string;
  employee_id: string;
  payout_date: string;
  amount: number; // cents
  tip_split_id: string | null;
  notes: string | null;
  paid_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TipPayoutWithEmployee extends TipPayout {
  employee?: {
    name: string;
    position: string;
  };
}

/**
 * Hook to manage tip payouts (daily cash tip disbursements).
 *
 * @param restaurantId - Current restaurant
 * @param startDate - Period start (YYYY-MM-DD)
 * @param endDate - Period end (YYYY-MM-DD)
 */
export function useTipPayouts(
  restaurantId: string | null,
  startDate: string,
  endDate: string
) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch payouts for the date range
  const { data: payouts, isLoading, error } = useQuery({
    queryKey: ['tip-payouts', restaurantId, startDate, endDate],
    queryFn: async (): Promise<TipPayoutWithEmployee[]> => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('tip_payouts')
        .select('*, employee:employees(name, position)')
        .eq('restaurant_id', restaurantId)
        .gte('payout_date', startDate)
        .lte('payout_date', endDate)
        .order('payout_date', { ascending: true });

      if (error) throw error;
      return (data || []) as TipPayoutWithEmployee[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  // Batch create payouts for a split
  const createPayoutsMutation = useMutation({
    mutationFn: async (params: {
      payouts: Array<{
        employee_id: string;
        amount: number; // cents
        payout_date: string;
        tip_split_id?: string;
        notes?: string;
      }>;
    }) => {
      if (!restaurantId) throw new Error('Restaurant ID required');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const rows = params.payouts
        .filter(p => p.amount > 0) // skip zero-amount entries
        .map(p => ({
          restaurant_id: restaurantId,
          employee_id: p.employee_id,
          payout_date: p.payout_date,
          amount: p.amount,
          tip_split_id: p.tip_split_id || null,
          notes: p.notes || null,
          paid_by: user.id,
        }));

      if (rows.length === 0) throw new Error('No payouts to record');

      const { data, error } = await supabase
        .from('tip_payouts')
        .upsert(rows, {
          onConflict: 'restaurant_id,employee_id,payout_date,tip_split_id',
          ignoreDuplicates: false,
        })
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Tips paid out', description: 'Cash tip payouts have been recorded.' });
      queryClient.invalidateQueries({ queryKey: ['tip-payouts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['payroll', restaurantId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error recording payouts', description: error.message, variant: 'destructive' });
    },
  });

  // Delete a single payout
  const deletePayoutMutation = useMutation({
    mutationFn: async (payoutId: string) => {
      if (!restaurantId) throw new Error('Restaurant ID required');

      const { error } = await supabase
        .from('tip_payouts')
        .delete()
        .eq('id', payoutId)
        .eq('restaurant_id', restaurantId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Payout removed', description: 'Tip payout record has been deleted.' });
      queryClient.invalidateQueries({ queryKey: ['tip-payouts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['payroll', restaurantId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error deleting payout', description: error.message, variant: 'destructive' });
    },
  });

  // Helper: get payouts for a specific split
  const getPayoutsForSplit = (tipSplitId: string): TipPayoutWithEmployee[] => {
    return (payouts || []).filter(p => p.tip_split_id === tipSplitId);
  };

  // Helper: get total paid out for a specific split
  const getTotalPaidForSplit = (tipSplitId: string): number => {
    return getPayoutsForSplit(tipSplitId).reduce((sum, p) => sum + p.amount, 0);
  };

  return {
    payouts: payouts || [],
    isLoading,
    error,
    createPayouts: createPayoutsMutation.mutateAsync,
    isCreating: createPayoutsMutation.isPending,
    deletePayout: deletePayoutMutation.mutate,
    isDeleting: deletePayoutMutation.isPending,
    getPayoutsForSplit,
    getTotalPaidForSplit,
  };
}
```

**Note on upsert:** The `onConflict` with the unique index handles re-recording payouts for the same employee/date/split. However, the unique index uses `COALESCE` which upsert may not match directly. If upsert fails, fall back to delete-then-insert pattern (delete existing payouts for that split_id first, then insert new ones). Test this during implementation and adjust.

**Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit src/hooks/useTipPayouts.tsx` or check IDE diagnostics.

**Step 3: Commit**

```bash
git add src/hooks/useTipPayouts.tsx
git commit -m "feat: add useTipPayouts hook for daily cash tip tracking"
```

---

### Task 3: Create `TipPayoutSheet` component

**Files:**
- Create: `src/components/tips/TipPayoutSheet.tsx`

**Step 1: Write the component**

Pattern follows `src/components/tips/TipDayEntrySheet.tsx` (shadcn Sheet, right side). Uses Apple/Notion design system from CLAUDE.md.

```typescript
import { useState, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Banknote, AlertTriangle, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import type { TipSplitWithItems } from '@/hooks/useTipSplits';
import type { TipPayoutWithEmployee } from '@/hooks/useTipPayouts';

interface PayoutEntry {
  employeeId: string;
  employeeName: string;
  allocatedCents: number;
  payoutCents: number;
  enabled: boolean;
}

interface TipPayoutSheetProps {
  open: boolean;
  onClose: () => void;
  split: TipSplitWithItems;
  existingPayouts: TipPayoutWithEmployee[];
  onConfirm: (payouts: Array<{
    employee_id: string;
    amount: number;
    payout_date: string;
    tip_split_id: string;
  }>) => Promise<void>;
  onDeletePayout: (payoutId: string) => void;
  isSubmitting: boolean;
}

export function TipPayoutSheet({
  open,
  onClose,
  split,
  existingPayouts,
  onConfirm,
  onDeletePayout,
  isSubmitting,
}: TipPayoutSheetProps) {
  const hasExistingPayouts = existingPayouts.length > 0;

  // Build initial entries from split items
  const initialEntries = useMemo((): PayoutEntry[] => {
    return split.items
      .filter(item => item.amount > 0)
      .map(item => {
        const existing = existingPayouts.find(p => p.employee_id === item.employee_id);
        return {
          employeeId: item.employee_id,
          employeeName: item.employee?.name || 'Unknown',
          allocatedCents: item.amount,
          payoutCents: existing ? existing.amount : item.amount,
          enabled: existing ? true : !hasExistingPayouts, // default all enabled for new, only existing for edits
        };
      });
  }, [split.items, existingPayouts, hasExistingPayouts]);

  const [entries, setEntries] = useState<PayoutEntry[]>(initialEntries);

  // Reset entries when split changes
  // (handled by key prop on parent, or useEffect if needed)

  const allEnabled = entries.every(e => e.enabled);
  const totalPayoutCents = entries
    .filter(e => e.enabled)
    .reduce((sum, e) => sum + e.payoutCents, 0);

  const toggleAll = () => {
    const newEnabled = !allEnabled;
    setEntries(prev => prev.map(e => ({ ...e, enabled: newEnabled })));
  };

  const updateEntry = (employeeId: string, field: 'payoutCents' | 'enabled', value: number | boolean) => {
    setEntries(prev => prev.map(e =>
      e.employeeId === employeeId ? { ...e, [field]: value } : e
    ));
  };

  const handleConfirm = async () => {
    const payouts = entries
      .filter(e => e.enabled && e.payoutCents > 0)
      .map(e => ({
        employee_id: e.employeeId,
        amount: e.payoutCents,
        payout_date: split.split_date,
        tip_split_id: split.id,
      }));

    await onConfirm(payouts);
    onClose();
  };

  const hasOverpayment = entries.some(e => e.enabled && e.payoutCents > e.allocatedCents);

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="right" className="max-w-md p-0 gap-0">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Banknote className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <SheetTitle className="text-[17px] font-semibold text-foreground">
                {hasExistingPayouts ? 'Edit Tip Payouts' : 'Record Tip Payouts'}
              </SheetTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {format(new Date(split.split_date + 'T12:00:00'), 'EEEE, MMMM d')} &middot; {formatCurrencyFromCents(split.total_amount)} total
              </p>
            </div>
          </div>
        </SheetHeader>

        <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[calc(100vh-220px)]">
          {/* Select all toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Employees
            </Label>
            <button
              onClick={toggleAll}
              className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              aria-label={allEnabled ? 'Deselect all employees' : 'Select all employees'}
            >
              {allEnabled ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {/* Employee rows */}
          <div className="space-y-3">
            {entries.map((entry) => {
              const existingPayout = existingPayouts.find(p => p.employee_id === entry.employeeId);
              const isOverpaid = entry.enabled && entry.payoutCents > entry.allocatedCents;

              return (
                <div
                  key={entry.employeeId}
                  className={`rounded-xl border p-4 transition-colors ${
                    entry.enabled
                      ? 'border-border/40 bg-background'
                      : 'border-border/20 bg-muted/20 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={entry.enabled}
                        onCheckedChange={(checked) => updateEntry(entry.employeeId, 'enabled', checked)}
                        className="data-[state=checked]:bg-foreground"
                        aria-label={`Include ${entry.employeeName} in payout`}
                      />
                      <div>
                        <p className="text-[14px] font-medium text-foreground">{entry.employeeName}</p>
                        <p className="text-[13px] text-muted-foreground">
                          Allocated: {formatCurrencyFromCents(entry.allocatedCents)}
                        </p>
                      </div>
                    </div>
                    {existingPayout && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeletePayout(existingPayout.id)}
                        className="text-destructive hover:text-destructive/80"
                        aria-label={`Remove payout for ${entry.employeeName}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {entry.enabled && (
                    <div>
                      <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Cash Paid
                      </Label>
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-muted-foreground">$</span>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={(entry.payoutCents / 100).toFixed(2)}
                          onChange={(e) => {
                            const dollars = parseFloat(e.target.value) || 0;
                            updateEntry(entry.employeeId, 'payoutCents', Math.round(dollars * 100));
                          }}
                          className="h-10 pl-7 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                          aria-label={`Cash paid to ${entry.employeeName}`}
                        />
                      </div>
                      {isOverpaid && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          <span className="text-[11px] text-amber-600">
                            Exceeds allocation by {formatCurrencyFromCents(entry.payoutCents - entry.allocatedCents)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/40 bg-muted/30">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] text-muted-foreground">Total Payout</span>
            <span className="text-[17px] font-semibold text-foreground">
              {formatCurrencyFromCents(totalPayoutCents)}
            </span>
          </div>

          {hasOverpayment && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-[12px] text-amber-700">
                Some payouts exceed allocated amounts. This is allowed but please verify.
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              className="flex-1 h-9 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isSubmitting || totalPayoutCents === 0}
              className="flex-1 h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {isSubmitting ? 'Recording...' : hasExistingPayouts ? 'Update Payouts' : 'Confirm Payout'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Step 2: Verify no TypeScript errors**

Check IDE diagnostics for `src/components/tips/TipPayoutSheet.tsx`.

**Step 3: Commit**

```bash
git add src/components/tips/TipPayoutSheet.tsx
git commit -m "feat: add TipPayoutSheet component for recording daily cash payouts"
```

---

### Task 4: Update `TipPeriodTimeline` with payout indicators

**Files:**
- Modify: `src/components/tips/TipPeriodTimeline.tsx`

**Step 1: Add payout data to props and DayData**

At line 8, add import:
```typescript
import type { TipPayoutWithEmployee } from '@/hooks/useTipPayouts';
import { Banknote } from 'lucide-react';
```

Update `TipPeriodTimelineProps` (line 11-17) to add:
```typescript
payouts?: TipPayoutWithEmployee[];
onRecordPayout?: (split: TipSplitWithItems) => void;
```

Update `DayData` (line 19-24) to add:
```typescript
payoutStatus: 'none' | 'partial' | 'full';
payoutTotalCents: number;
```

**Step 2: Compute payout status in the `days` useMemo**

In the `days` useMemo (line 37-51), after computing `totalCents`, add payout status logic:

```typescript
// Calculate payout status for this day
const dayPayouts = payouts?.filter(p => p.payout_date === dateStr) || [];
const payoutTotalCents = dayPayouts.reduce((sum, p) => sum + p.amount, 0);
let payoutStatus: 'none' | 'partial' | 'full' = 'none';
if (payoutTotalCents > 0 && split) {
  payoutStatus = payoutTotalCents >= split.total_amount ? 'full' : 'partial';
}
```

Include `payouts` in the useMemo dependency array.

**Step 3: Add payout indicator to day cards**

After the status indicator `<div>` (around line 142-144), add payout badge:

```typescript
{/* Payout indicator */}
{(day.status === 'approved' || day.status === 'archived') && day.payoutStatus !== 'none' && (
  <Badge
    variant="outline"
    className={cn(
      'mt-1 text-[10px] px-1.5 py-0',
      day.payoutStatus === 'full'
        ? 'border-emerald-500/50 text-emerald-700 bg-emerald-500/10'
        : 'border-amber-500/50 text-amber-700 bg-amber-500/10'
    )}
  >
    {day.payoutStatus === 'full' ? 'Paid' : 'Partial'}
  </Badge>
)}
```

**Step 4: Add "Record Payout" button for approved days without full payout**

Below the amount badge (around line 147-163), add a small button for approved/archived days:

```typescript
{/* Record payout button */}
{(day.status === 'approved' || day.status === 'archived') && day.payoutStatus !== 'full' && onRecordPayout && day.split && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onRecordPayout(day.split!);
    }}
    className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
    aria-label={`Record payout for ${format(day.date, 'MMMM d')}`}
  >
    <Banknote className="h-3 w-3 inline mr-0.5" />
    Pay out
  </button>
)}
```

**Step 5: Add "Paid" to legend**

After the "Locked" legend item (around line 183-186), add:
```typescript
<div className="flex items-center gap-2 text-xs text-muted-foreground">
  <div className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/30" />
  <span>Paid Out</span>
</div>
```

**Step 6: Commit**

```bash
git add src/components/tips/TipPeriodTimeline.tsx
git commit -m "feat: add payout status indicators to tip period timeline"
```

---

### Task 5: Integrate payout flow into Tips page

**Files:**
- Modify: `src/pages/Tips.tsx`

**Step 1: Add imports and hook**

Add imports at the top of `src/pages/Tips.tsx`:
```typescript
import { useTipPayouts } from '@/hooks/useTipPayouts';
import { TipPayoutSheet } from '@/components/tips/TipPayoutSheet';
```

**Step 2: Add state and hook call**

After existing state declarations (around line 56), add:
```typescript
const [payoutSheetSplit, setPayoutSheetSplit] = useState<TipSplitWithItems | null>(null);
```

After existing hook calls (around line 105), add the `useTipPayouts` hook:
```typescript
const {
  payouts,
  isLoading: payoutsLoading,
  createPayouts,
  isCreating: isCreatingPayouts,
  deletePayout,
} = useTipPayouts(restaurantId, periodStartStr, periodEndStr);
```

Where `restaurantId`, `periodStartStr`, `periodEndStr` are the same variables used for `useTipSplits`.

**Step 3: Add payout handler**

After `handleLockPeriod` (around line 172), add:
```typescript
const handleRecordPayout = (split: TipSplitWithItems) => {
  setPayoutSheetSplit(split);
};

const handleConfirmPayout = async (payoutEntries: Array<{
  employee_id: string;
  amount: number;
  payout_date: string;
  tip_split_id: string;
}>) => {
  await createPayouts({ payouts: payoutEntries });
  setPayoutSheetSplit(null);
};
```

**Step 4: Pass payouts to TipPeriodTimeline**

Find where `<TipPeriodTimeline>` is rendered and add the new props:
```typescript
<TipPeriodTimeline
  startDate={periodStart}
  endDate={periodEnd}
  splits={periodSplits}
  onDayClick={handleDayClick}
  isLoading={periodSplitsLoading}
  payouts={payouts}
  onRecordPayout={handleRecordPayout}
/>
```

**Step 5: Render TipPayoutSheet**

At the bottom of the component's JSX (before the closing fragment/div), add:
```typescript
{payoutSheetSplit && (
  <TipPayoutSheet
    key={payoutSheetSplit.id}
    open={!!payoutSheetSplit}
    onClose={() => setPayoutSheetSplit(null)}
    split={payoutSheetSplit}
    existingPayouts={(payouts || []).filter(p => p.tip_split_id === payoutSheetSplit.id)}
    onConfirm={handleConfirmPayout}
    onDeletePayout={deletePayout}
    isSubmitting={isCreatingPayouts}
  />
)}
```

**Step 6: Commit**

```bash
git add src/pages/Tips.tsx
git commit -m "feat: integrate tip payout recording flow into Tips page"
```

---

### Task 6: Update payroll calculations for tip payout deduction

**Files:**
- Modify: `src/utils/payrollCalculations.ts`
- Test: `tests/unit/payrollCalculations.test.ts` (if exists, otherwise create)

**Step 1: Write tests for the new tip fields**

Check if test file exists: `tests/unit/payrollCalculations.test.ts`. If it does, add tests. If not, create a focused test file.

```typescript
// In the test file, add:
import { calculateEmployeePay } from '@/utils/payrollCalculations';

describe('calculateEmployeePay tip payout deduction', () => {
  const baseEmployee = {
    id: 'emp-1',
    name: 'Maria',
    position: 'Server',
    compensation_type: 'hourly' as const,
    hourly_rate: 1500, // $15/hr in cents
    restaurant_id: 'rest-1',
    status: 'active' as const,
  };

  it('should set tipsPaidOut and compute tipsOwed correctly', () => {
    const result = calculateEmployeePay(
      baseEmployee,
      [], // no punches
      8000, // $80 tips earned (cents)
      undefined,
      undefined,
      [], // no manual payments
      6000, // $60 tips already paid out (cents)
    );

    expect(result.totalTips).toBe(8000);       // tipsEarned
    expect(result.tipsPaidOut).toBe(6000);      // paid out
    expect(result.tipsOwed).toBe(2000);         // 8000 - 6000
    expect(result.totalPay).toBe(result.grossPay + 2000); // only owed tips added
  });

  it('should handle zero payouts (backward compatible)', () => {
    const result = calculateEmployeePay(
      baseEmployee, [], 5000, undefined, undefined, [], 0
    );

    expect(result.totalTips).toBe(5000);
    expect(result.tipsPaidOut).toBe(0);
    expect(result.tipsOwed).toBe(5000);
    expect(result.totalPay).toBe(result.grossPay + 5000);
  });

  it('should handle payout exceeding tips earned', () => {
    const result = calculateEmployeePay(
      baseEmployee, [], 5000, undefined, undefined, [], 7000
    );

    expect(result.totalTips).toBe(5000);
    expect(result.tipsPaidOut).toBe(7000);
    expect(result.tipsOwed).toBe(0); // floor at 0, don't go negative
    expect(result.totalPay).toBe(result.grossPay); // no tips added
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/payrollCalculations.test.ts`

Expected: FAIL — `tipsPaidOut` and `tipsOwed` don't exist on `EmployeePayroll` yet.

**Step 3: Update `EmployeePayroll` interface**

In `src/utils/payrollCalculations.ts`, update the `EmployeePayroll` interface (lines 40-60):

Add after `totalTips` (line 57):
```typescript
tipsPaidOut: number; // In cents - tips already paid out as cash
tipsOwed: number; // In cents - tips still owed (totalTips - tipsPaidOut)
```

**Step 4: Update `calculateEmployeePay` function**

In `src/utils/payrollCalculations.ts`, modify the function signature (line 387-394) to accept `tipsPaidOut`:

```typescript
export function calculateEmployeePay(
  employee: Employee,
  punches: TimePunch[],
  tips: number, // In cents
  periodStartDate?: Date,
  periodEndDate?: Date,
  manualPayments: ManualPayment[] = [],
  tipsPaidOut: number = 0, // In cents - already paid out as cash
): EmployeePayroll {
```

Then update the pay calculation (around line 469-470):

```typescript
const grossPay = regularPay + overtimePay + salaryPay + contractorPay + dailyRatePay + manualPaymentsTotal;
const tipsOwed = Math.max(0, tips - tipsPaidOut);
const totalPay = grossPay + tipsOwed;
```

And the return object (around line 472-492), add:

```typescript
tipsPaidOut,
tipsOwed,
```

**Step 5: Update `calculatePayrollPeriod`**

Modify signature (line 548-554) to accept `tipPayoutsPerEmployee`:

```typescript
export function calculatePayrollPeriod(
  startDate: Date,
  endDate: Date,
  employees: Employee[],
  punchesPerEmployee: Map<string, TimePunch[]>,
  tipsPerEmployee: Map<string, number>,
  manualPaymentsPerEmployee: Map<string, ManualPayment[]> = new Map(),
  tipPayoutsPerEmployee: Map<string, number> = new Map(),
): PayrollPeriod {
```

Pass it through (around line 558-561):

```typescript
const tipsPaidOut = tipPayoutsPerEmployee.get(employee.id) || 0;
return calculateEmployeePay(employee, punches, tips, startDate, endDate, manualPayments, tipsPaidOut);
```

Update `PayrollPeriod` interface (lines 62-70) to add:

```typescript
totalTipsPaidOut: number; // In cents
totalTipsOwed: number; // In cents
```

And compute them in the function:

```typescript
const totalTipsPaidOut = employeePayrolls.reduce((sum, ep) => sum + ep.tipsPaidOut, 0);
const totalTipsOwed = employeePayrolls.reduce((sum, ep) => sum + ep.tipsOwed, 0);
```

Add to the return object:

```typescript
totalTipsPaidOut,
totalTipsOwed,
```

**Step 6: Update CSV export**

In `exportPayrollToCSV` (lines 583-624), update headers:

```typescript
const headers = [
  'Employee Name', 'Position', 'Hourly Rate',
  'Regular Hours', 'Overtime Hours',
  'Regular Pay', 'Overtime Pay', 'Gross Pay',
  'Tips Earned', 'Tips Paid', 'Tips Owed',
  'Total Pay',
].join(',');
```

Update row mapping to include three tip columns:

```typescript
formatCurrency(ep.totalTips),      // Tips Earned
formatCurrency(ep.tipsPaidOut),    // Tips Paid
formatCurrency(ep.tipsOwed),       // Tips Owed
```

Update total row similarly.

**Step 7: Run tests to verify they pass**

Run: `npm run test -- tests/unit/payrollCalculations.test.ts`

Expected: PASS

**Step 8: Commit**

```bash
git add src/utils/payrollCalculations.ts tests/unit/payrollCalculations.test.ts
git commit -m "feat: add tipsPaidOut/tipsOwed to payroll calculations"
```

---

### Task 7: Update `usePayroll` hook to fetch tip payouts

**Files:**
- Modify: `src/hooks/usePayroll.tsx`

**Step 1: Add tip_payouts query to the payroll queryFn**

After the `employeeTips` query (around line 196-203), add:

```typescript
// Fetch tip payouts for the period
const { data: tipPayoutsData, error: tipPayoutsError } = await supabase
  .from('tip_payouts')
  .select('employee_id, amount')
  .eq('restaurant_id', restaurantId)
  .gte('payout_date', format(startDate, 'yyyy-MM-dd'))
  .lte('payout_date', format(endDate, 'yyyy-MM-dd'));

if (tipPayoutsError) throw tipPayoutsError;
```

**Step 2: Aggregate payouts per employee**

After the `manualPaymentsPerEmployee` grouping (around line 252), add:

```typescript
// Group tip payouts by employee (sum amounts in cents)
const tipPayoutsPerEmployee = new Map<string, number>();
(tipPayoutsData || []).forEach((payout: { employee_id: string; amount: number }) => {
  const current = tipPayoutsPerEmployee.get(payout.employee_id) || 0;
  tipPayoutsPerEmployee.set(payout.employee_id, current + payout.amount);
});
```

**Step 3: Pass to `calculatePayrollPeriod`**

Update the call to `calculatePayrollPeriod` (around line 261-268) to pass the new parameter:

```typescript
const payroll = calculatePayrollPeriod(
  startDate,
  endDate,
  eligibleEmployees,
  punchesPerEmployee,
  tipsPerEmployee,
  manualPaymentsPerEmployee,
  tipPayoutsPerEmployee,
);
```

**Step 4: Verify TypeScript compiles**

Check IDE diagnostics for `src/hooks/usePayroll.tsx`.

**Step 5: Commit**

```bash
git add src/hooks/usePayroll.tsx
git commit -m "feat: fetch tip payouts in usePayroll hook"
```

---

### Task 8: Update Payroll.tsx UI with three tip columns

**Files:**
- Modify: `src/pages/Payroll.tsx`

**Step 1: Update table headers**

Replace the single "Tips" header (line 490) with three columns:

```typescript
<TableHead className="text-right">Tips Earned</TableHead>
<TableHead className="text-right">Tips Paid</TableHead>
<TableHead className="text-right">Tips Owed</TableHead>
```

**Step 2: Update employee row tip cells**

Replace the single Tips cell (lines 566-568) with three cells:

```typescript
<TableCell className="text-right">
  {employee.totalTips > 0 ? formatCurrency(employee.totalTips) : '-'}
</TableCell>
<TableCell className="text-right">
  {employee.tipsPaidOut > 0 ? formatCurrency(employee.tipsPaidOut) : '-'}
</TableCell>
<TableCell className="text-right font-medium">
  {employee.tipsOwed > 0 ? formatCurrency(employee.tipsOwed) : '-'}
</TableCell>
```

**Step 3: Update total row**

Replace the single tips total (line 607) with three cells:

```typescript
<TableCell className="text-right">
  {formatCurrency(payrollPeriod.totalTips)}
</TableCell>
<TableCell className="text-right">
  {formatCurrency(payrollPeriod.totalTipsPaidOut)}
</TableCell>
<TableCell className="text-right">
  {formatCurrency(payrollPeriod.totalTipsOwed)}
</TableCell>
```

**Step 4: Update total row colSpan**

The total row at line 589 has `colSpan={3}`. The total column count is now 12 (was 10). Verify `colSpan` values match the new column layout. The TOTAL label should still span Employee + Position + Rate = 3.

Also update the grand total cell calculation:
```typescript
{formatCurrency(payrollPeriod.totalGrossPay + payrollPeriod.totalTipsOwed)}
```

**Step 5: Update summary cards (if they show tip totals)**

Search for any summary card that displays `totalTips` and update to show earned vs. owed breakdown if appropriate.

**Step 6: Commit**

```bash
git add src/pages/Payroll.tsx
git commit -m "feat: show Tips Earned/Paid/Owed columns in payroll table"
```

---

### Task 9: Update EmployeeTips page with payout status

**Files:**
- Modify: `src/pages/EmployeeTips.tsx`

**Step 1: Fetch employee's payouts**

Add the `useTipPayouts` hook call (or a simpler direct query) to fetch payouts for the current employee in the date range.

Since `EmployeeTips` uses the employee's own view, and we added an employee RLS policy that lets them see their own payouts, this should work:

```typescript
const { payouts } = useTipPayouts(restaurantId, startDateStr, endDateStr);
```

Or use a simpler inline query since we only need the current employee's payouts.

**Step 2: Show payout badge on tip day cards**

In the tip day cards rendering, add a payout indicator:

```typescript
{/* Payout status */}
{(() => {
  const payout = payouts?.find(p =>
    p.employee_id === currentEmployee.id &&
    p.payout_date === tip.date
  );
  if (payout) {
    return (
      <Badge variant="outline" className="border-emerald-500/50 text-emerald-700 bg-emerald-500/10 text-[11px]">
        Paid {formatCurrencyFromCents(payout.amount)} cash
      </Badge>
    );
  }
  return null;
})()}
```

**Step 3: Commit**

```bash
git add src/pages/EmployeeTips.tsx
git commit -m "feat: show cash payout status on employee tips view"
```

---

### Task 10: Manual testing and final verification

**Step 1: Test the full flow**

1. Start dev server: `npm run dev`
2. Go to Tips page → create a tip split → approve it
3. Click "Record Payout" on the approved day in the timeline
4. Verify the TipPayoutSheet opens with correct employee amounts
5. Adjust amounts, confirm payout
6. Verify the timeline shows "Paid" badge
7. Go to Payroll page → verify Tips Earned / Tips Paid / Tips Owed columns
8. Verify Total Pay only includes Tips Owed
9. Export CSV → verify three tip columns
10. Check EmployeeTips page → verify payout badge appears

**Step 2: Check for TypeScript errors**

Run: `npx tsc --noEmit`

**Step 3: Run all existing tests**

Run: `npm run test`

Fix any regressions (most likely in existing payroll tests that expect the old `calculateEmployeePay` signature — add `0` as the new `tipsPaidOut` parameter for backward compatibility).

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test regressions and TypeScript errors from tip payout feature"
```

---

### Summary of all files touched

| Action | File |
|--------|------|
| Create | `supabase/migrations/*_create_tip_payouts_table.sql` |
| Create | `src/hooks/useTipPayouts.tsx` |
| Create | `src/components/tips/TipPayoutSheet.tsx` |
| Create/Modify | `tests/unit/payrollCalculations.test.ts` |
| Modify | `src/utils/payrollCalculations.ts` (interfaces + functions + CSV) |
| Modify | `src/hooks/usePayroll.tsx` (fetch payouts, pass to calculations) |
| Modify | `src/pages/Payroll.tsx` (3 tip columns) |
| Modify | `src/pages/Tips.tsx` (payout hook + sheet + handler) |
| Modify | `src/components/tips/TipPeriodTimeline.tsx` (payout indicators) |
| Modify | `src/pages/EmployeeTips.tsx` (payout badge) |
