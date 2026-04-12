# Open Shift Claiming PR2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees can find and claim open shifts in a unified feed alongside existing shift trades.

**Architecture:** Server-side SQL RPCs handle open shift detection and atomic claiming. A unified React hook merges open shifts with marketplace trades. The existing `EmployeeShiftMarketplace` page is replaced with an `AvailableShiftsPage`. A restaurant-level feature gate controls visibility.

**Tech Stack:** PostgreSQL (RPCs, RLS), TypeScript/React, React Query, Vitest, pgTAP, Playwright

**Design spec:** `docs/superpowers/specs/2026-04-11-open-shift-claiming-pr2-design.md`

**IMPORTANT:** Before writing any Supabase query, verify actual table/column names via `npx supabase db dump --local --schema public 2>&1 | grep -A 20 "CREATE TABLE.*<table_name>"`. Never trust plan text for column names.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `supabase/migrations/YYYYMMDD_open_shift_claims.sql` | Table, settings columns, RLS, RPCs |
| `supabase/tests/open_shift_claims.test.sql` | pgTAP tests for RPCs |
| `src/types/scheduling.ts` | Add `OpenShiftClaim` type, update `Shift.source`, update `StaffingSettings` |
| `src/hooks/useOpenShifts.ts` | Fetch open shifts via RPC |
| `src/hooks/useOpenShiftClaims.ts` | Claim mutations, fetch employee claims |
| `src/hooks/useAvailableShifts.ts` | Merge open shifts + trades into unified feed |
| `src/hooks/useStaffingSettings.ts` | Update to include new boolean columns |
| `src/pages/AvailableShiftsPage.tsx` | Unified employee feed (replaces EmployeeShiftMarketplace) |
| `src/components/scheduling/OpenShiftCard.tsx` | Open shift card component |
| `src/components/scheduling/ClaimConfirmDialog.tsx` | Claim confirmation dialog |
| `src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx` | Add feature toggles |
| `src/components/PublishScheduleDialog.tsx` | Update nudge text when feature disabled |
| `src/components/schedule/TradeApprovalQueue.tsx` | Add claim approvals |
| `tests/unit/availableShifts.test.ts` | Unit tests for merge hook |
| `tests/e2e/open-shift-claiming.spec.ts` | E2E tests |

---

### Task 1: Database migration — table, settings, RLS, RPCs

**Files:**
- Create: `supabase/migrations/YYYYMMDD_open_shift_claims.sql`
- Create: `supabase/tests/open_shift_claims.test.sql`

- [ ] **Step 1: Write pgTAP tests**

Create `supabase/tests/open_shift_claims.test.sql`:

```sql
BEGIN;
SELECT plan(12);

-- Test 1: open_shift_claims table exists
SELECT has_table('open_shift_claims', 'open_shift_claims table should exist');

-- Test 2: Required columns exist
SELECT has_column('open_shift_claims', 'shift_template_id', 'should have shift_template_id');
SELECT has_column('open_shift_claims', 'shift_date', 'should have shift_date');
SELECT has_column('open_shift_claims', 'claimed_by_employee_id', 'should have claimed_by_employee_id');
SELECT has_column('open_shift_claims', 'status', 'should have status');
SELECT has_column('open_shift_claims', 'resulting_shift_id', 'should have resulting_shift_id');

-- Test 3: Settings columns exist on staffing_settings
SELECT has_column('staffing_settings', 'open_shifts_enabled', 'staffing_settings should have open_shifts_enabled');
SELECT has_column('staffing_settings', 'require_shift_claim_approval', 'staffing_settings should have require_shift_claim_approval');

-- Test 4: Default values
SELECT col_default_is('staffing_settings', 'open_shifts_enabled', 'false',
  'open_shifts_enabled should default to false');
SELECT col_default_is('staffing_settings', 'require_shift_claim_approval', 'false',
  'require_shift_claim_approval should default to false');

-- Test 5: RPC functions exist
SELECT has_function('get_open_shifts', ARRAY['uuid', 'date', 'date'],
  'get_open_shifts function should exist');
SELECT has_function('claim_open_shift', ARRAY['uuid', 'uuid', 'date', 'uuid'],
  'claim_open_shift function should exist');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:db`
Expected: FAIL — table and functions don't exist.

- [ ] **Step 3: Create the migration**

Run `npx supabase migration new open_shift_claims` to get the timestamp, then write the migration file. The migration must contain:

1. `CREATE TABLE open_shift_claims` with all columns from the spec (id, restaurant_id, shift_template_id, shift_date, claimed_by_employee_id, status with CHECK constraint, resulting_shift_id, reviewed_by, reviewed_at, created_at, updated_at)
2. Unique partial index on (shift_template_id, shift_date, claimed_by_employee_id) WHERE status IN ('pending_approval', 'approved')
3. Query indexes on restaurant_id, claimed_by_employee_id, and (restaurant_id, status)
4. RLS ENABLE + 5 policies (employees view own, managers view all, employees insert own, employees cancel own pending, managers review)
5. `ALTER TABLE staffing_settings ADD COLUMN open_shifts_enabled BOOLEAN NOT NULL DEFAULT false`
6. `ALTER TABLE staffing_settings ADD COLUMN require_shift_claim_approval BOOLEAN NOT NULL DEFAULT false`
7. `CREATE OR REPLACE FUNCTION get_open_shifts(p_restaurant_id UUID, p_week_start DATE, p_week_end DATE)` — SECURITY DEFINER, returns open spots for published weeks only when feature enabled. Use the SQL from the design spec but add `area TEXT` to the return columns (shift_templates now has an optional `area` column). Include `st.area` in the template_days CTE and return it in the final SELECT.
8. `CREATE OR REPLACE FUNCTION claim_open_shift(p_restaurant_id UUID, p_template_id UUID, p_shift_date DATE, p_employee_id UUID)` — SECURITY DEFINER, atomic claim with capacity check, conflict check, approval mode. Use the exact SQL from the design spec. Note: the `source` column on shifts uses `source_type` in the DB (not `source`). Verify with `npx supabase db dump --local --schema public 2>&1 | grep -A 30 "CREATE TABLE.*public.shifts"` before writing the INSERT.
9. `CREATE OR REPLACE FUNCTION approve_open_shift_claim(p_claim_id UUID, p_reviewer_note TEXT DEFAULT NULL)` — from spec
10. `CREATE OR REPLACE FUNCTION reject_open_shift_claim(p_claim_id UUID, p_reviewer_note TEXT DEFAULT NULL)` — from spec
11. `GRANT EXECUTE ON FUNCTION` for all 4 functions to `authenticated`
12. Updated_at trigger on open_shift_claims

For RLS policies, use the `user_restaurants` table pattern (not `restaurant_members` — verify the actual table name). The existing pattern is:
```sql
EXISTS (
  SELECT 1 FROM user_restaurants
  WHERE user_restaurants.user_id = auth.uid()
  AND user_restaurants.restaurant_id = open_shift_claims.restaurant_id
  AND user_restaurants.role IN ('owner', 'manager')
)
```

For employee self-identification, use:
```sql
claimed_by_employee_id IN (
  SELECT id FROM employees WHERE user_id = auth.uid()
)
```

- [ ] **Step 4: Reset database and run tests**

Run: `npx supabase db reset && npm run test:db`
Expected: All pgTAP tests pass.

- [ ] **Step 5: Regenerate TypeScript types**

Run: `npx supabase gen types typescript --local 2>/dev/null > src/integrations/supabase/types.ts`
Verify line 1 starts with `export type` (not a log message).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_open_shift_claims.sql supabase/tests/open_shift_claims.test.sql src/integrations/supabase/types.ts
git commit -m "feat: add open_shift_claims table, settings, and RPCs"
```

---

### Task 2: TypeScript types

**Files:**
- Modify: `src/types/scheduling.ts`

- [ ] **Step 1: Add OpenShiftClaim interface**

After the `ShiftTrade` interface (or at end of file), add:

```typescript
export interface OpenShiftClaim {
  id: string;
  restaurant_id: string;
  shift_template_id: string;
  shift_date: string;
  claimed_by_employee_id: string;
  status: 'pending_approval' | 'approved' | 'rejected' | 'cancelled';
  resulting_shift_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpenShift {
  template_id: string;
  template_name: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  position: string;
  area: string | null;
  capacity: number;
  assigned_count: number;
  pending_claims: number;
  open_spots: number;
}
```

- [ ] **Step 2: Update Shift.source union**

Change line 106 from:
```typescript
source: 'manual' | 'ai' | 'template';
```
to:
```typescript
source: 'manual' | 'ai' | 'template' | 'claimed';
```

- [ ] **Step 3: Update StaffingSettings interface**

Add to the `StaffingSettings` interface (after `min_crew`):
```typescript
open_shifts_enabled: boolean;
require_shift_claim_approval: boolean;
```

- [ ] **Step 4: Commit**

```bash
git add src/types/scheduling.ts
git commit -m "feat: add OpenShiftClaim and OpenShift types"
```

---

### Task 3: Hooks — useOpenShifts and useOpenShiftClaims

**Files:**
- Create: `src/hooks/useOpenShifts.ts`
- Create: `src/hooks/useOpenShiftClaims.ts`
- Modify: `src/hooks/useStaffingSettings.ts`

- [ ] **Step 1: Create useOpenShifts hook**

Create `src/hooks/useOpenShifts.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { OpenShift } from '@/types/scheduling';

export function useOpenShifts(restaurantId: string | null, weekStart: Date | null, weekEnd: Date | null) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['open_shifts', restaurantId, weekStart?.toISOString(), weekEnd?.toISOString()],
    queryFn: async () => {
      if (!restaurantId || !weekStart || !weekEnd) return [];

      const startStr = weekStart.toISOString().split('T')[0];
      const endStr = weekEnd.toISOString().split('T')[0];

      const { data, error } = await (supabase.rpc as any)('get_open_shifts', {
        p_restaurant_id: restaurantId,
        p_week_start: startStr,
        p_week_end: endStr,
      });

      if (error) throw error;
      return (data ?? []) as OpenShift[];
    },
    enabled: !!restaurantId && !!weekStart && !!weekEnd,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return { openShifts: data ?? [], loading: isLoading, error, refetch };
}
```

- [ ] **Step 2: Create useOpenShiftClaims hook**

Create `src/hooks/useOpenShiftClaims.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { OpenShiftClaim } from '@/types/scheduling';

export function useOpenShiftClaims(restaurantId: string | null, employeeId?: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['open_shift_claims', restaurantId, employeeId],
    queryFn: async () => {
      if (!restaurantId) return [];
      let query = (supabase.from('open_shift_claims') as any)
        .select('*, shift_template:shift_templates(name, start_time, end_time, position)')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (employeeId) {
        query = query.eq('claimed_by_employee_id', employeeId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as (OpenShiftClaim & { shift_template?: { name: string; start_time: string; end_time: string; position: string } })[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return { claims: data ?? [], loading: isLoading, error };
}

export function useClaimOpenShift() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      restaurantId: string;
      templateId: string;
      shiftDate: string;
      employeeId: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)('claim_open_shift', {
        p_restaurant_id: params.restaurantId,
        p_template_id: params.templateId,
        p_shift_date: params.shiftDate,
        p_employee_id: params.employeeId,
      });

      if (error) throw error;
      const result = data as { success: boolean; error?: string; status?: string; message?: string };
      if (!result.success) throw new Error(result.error ?? 'Failed to claim shift');
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['open_shifts'] });
      queryClient.invalidateQueries({ queryKey: ['open_shift_claims'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: result.status === 'pending_approval' ? 'Claim submitted' : 'Shift claimed!',
        description: result.message,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Cannot claim shift', description: error.message, variant: 'destructive' });
    },
  });
}

export function useApproveClaimMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { claimId: string; note?: string }) => {
      const { data, error } = await (supabase.rpc as any)('approve_open_shift_claim', {
        p_claim_id: params.claimId,
        p_reviewer_note: params.note ?? null,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error ?? 'Failed to approve claim');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['open_shift_claims'] });
      queryClient.invalidateQueries({ queryKey: ['open_shifts'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({ title: 'Claim approved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}

export function useRejectClaimMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { claimId: string; note?: string }) => {
      const { data, error } = await (supabase.rpc as any)('reject_open_shift_claim', {
        p_claim_id: params.claimId,
        p_reviewer_note: params.note ?? null,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error ?? 'Failed to reject claim');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['open_shift_claims'] });
      queryClient.invalidateQueries({ queryKey: ['open_shifts'] });
      toast({ title: 'Claim rejected' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}
```

- [ ] **Step 3: Update useStaffingSettings defaults**

In `src/hooks/useStaffingSettings.ts`, add to the DEFAULTS object (around line 9):
```typescript
open_shifts_enabled: false,
require_shift_claim_approval: false,
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useOpenShifts.ts src/hooks/useOpenShiftClaims.ts src/hooks/useStaffingSettings.ts
git commit -m "feat: add hooks for open shifts and claims"
```

---

### Task 4: useAvailableShifts — merge open shifts + trades

**Files:**
- Create: `src/hooks/useAvailableShifts.ts`
- Create: `tests/unit/availableShifts.test.ts`

- [ ] **Step 1: Write failing unit test**

Create `tests/unit/availableShifts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeAvailableShifts, AvailableShiftItem } from '@/hooks/useAvailableShifts';
import type { OpenShift } from '@/types/scheduling';

const makeOpenShift = (overrides: Partial<OpenShift> = {}): OpenShift => ({
  template_id: 'tpl-1',
  template_name: 'Closing Server',
  shift_date: '2026-04-18',
  start_time: '16:00:00',
  end_time: '22:00:00',
  position: 'Server',
  area: null,
  capacity: 3,
  assigned_count: 1,
  pending_claims: 0,
  open_spots: 2,
  ...overrides,
});

const makeTrade = (overrides: Record<string, unknown> = {}) => ({
  id: 'trade-1',
  status: 'open' as const,
  offered_shift: { id: 's1', start_time: '2026-04-18T14:00:00Z', end_time: '2026-04-18T20:00:00Z', position: 'Server', break_duration: 0 },
  offered_by: { id: 'emp-1', name: 'Maria', email: null, position: 'Server' },
  ...overrides,
});

describe('mergeAvailableShifts', () => {
  it('returns empty array when no shifts or trades', () => {
    expect(mergeAvailableShifts([], [])).toEqual([]);
  });

  it('includes open shifts with type "open_shift"', () => {
    const result = mergeAvailableShifts([makeOpenShift()], []);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('open_shift');
    expect(result[0].openShift?.template_name).toBe('Closing Server');
  });

  it('includes trades with type "trade"', () => {
    const result = mergeAvailableShifts([], [makeTrade()]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('trade');
  });

  it('sorts by date ascending', () => {
    const result = mergeAvailableShifts(
      [makeOpenShift({ shift_date: '2026-04-20' })],
      [makeTrade({ offered_shift: { id: 's1', start_time: '2026-04-18T14:00:00Z', end_time: '2026-04-18T20:00:00Z', position: 'Server', break_duration: 0 } })],
    );
    expect(result[0].type).toBe('trade');
    expect(result[1].type).toBe('open_shift');
  });

  it('generates unique keys', () => {
    const result = mergeAvailableShifts(
      [makeOpenShift(), makeOpenShift({ template_id: 'tpl-2', template_name: 'Opener' })],
      [makeTrade()],
    );
    const keys = result.map(r => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/availableShifts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement mergeAvailableShifts**

Create `src/hooks/useAvailableShifts.ts`:

```typescript
import { useMemo } from 'react';
import type { OpenShift } from '@/types/scheduling';
import type { ShiftTrade } from '@/hooks/useShiftTrades';
import { useOpenShifts } from '@/hooks/useOpenShifts';
import { useMarketplaceTrades } from '@/hooks/useShiftTrades';

export interface AvailableShiftItem {
  key: string;
  type: 'open_shift' | 'trade';
  date: string; // YYYY-MM-DD for sorting
  openShift?: OpenShift;
  trade?: ShiftTrade & { hasConflict?: boolean };
}

export function mergeAvailableShifts(
  openShifts: OpenShift[],
  trades: (ShiftTrade & { hasConflict?: boolean })[],
): AvailableShiftItem[] {
  const items: AvailableShiftItem[] = [];

  for (const os of openShifts) {
    items.push({
      key: `open-${os.template_id}-${os.shift_date}`,
      type: 'open_shift',
      date: os.shift_date,
      openShift: os,
    });
  }

  for (const trade of trades) {
    const tradeDate = trade.offered_shift?.start_time?.split('T')[0] ?? '';
    items.push({
      key: `trade-${trade.id}`,
      type: 'trade',
      date: tradeDate,
      trade,
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}

export function useAvailableShifts(
  restaurantId: string | null,
  employeeId: string | null,
  weekStart: Date | null,
  weekEnd: Date | null,
) {
  const { openShifts, loading: openLoading } = useOpenShifts(restaurantId, weekStart, weekEnd);
  const { trades, loading: tradesLoading } = useMarketplaceTrades(restaurantId, employeeId);

  const items = useMemo(
    () => mergeAvailableShifts(openShifts, trades),
    [openShifts, trades],
  );

  return {
    items,
    loading: openLoading || tradesLoading,
    openShiftCount: openShifts.length,
    tradeCount: trades.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/availableShifts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAvailableShifts.ts tests/unit/availableShifts.test.ts
git commit -m "feat: add useAvailableShifts hook merging open shifts and trades"
```

---

### Task 5: Settings UI — feature toggles in StaffingConfigPanel

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx`

- [ ] **Step 1: Add the Open Shift Claiming section**

After the existing Minimum Crew section (around line 259), add a new section with:

1. A section header: "Open Shift Claiming"
2. A Switch toggle for `open_shifts_enabled` with label "Allow employees to claim open shifts"
3. Helper text: "When enabled, employees can see and claim unfilled shifts after you publish the schedule."
4. When `open_shifts_enabled` is true, show a sub-toggle for `require_shift_claim_approval` with label "Require manager approval"
5. Helper text: "When off, employees are instantly assigned. When on, claims go to your approval queue."
6. First-enable note (show once when toggling on): "You control which shifts are open through template capacity settings."

Use the existing `onSettingsChange` callback for both toggles. Import `Switch` from `@/components/ui/switch`.

Follow the existing styling patterns in the panel: `text-[12px] font-medium text-muted-foreground uppercase tracking-wider` for labels, `text-[13px] text-muted-foreground` for helper text.

- [ ] **Step 2: Update StaffingConfigPanel props**

The `settings` prop type needs to include the new fields. Update the interface to include `open_shifts_enabled: boolean` and `require_shift_claim_approval: boolean`.

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx
git commit -m "feat: add open shift claiming toggles to staffing settings"
```

---

### Task 6: AvailableShiftsPage — unified employee feed

**Files:**
- Create: `src/pages/AvailableShiftsPage.tsx`
- Create: `src/components/scheduling/OpenShiftCard.tsx`
- Create: `src/components/scheduling/ClaimConfirmDialog.tsx`
- Modify: `src/App.tsx` (route update)

- [ ] **Step 1: Create OpenShiftCard component**

Create `src/components/scheduling/OpenShiftCard.tsx` — a memoized card for an open shift. Props:

```typescript
interface OpenShiftCardProps {
  openShift: OpenShift;
  hasConflict: boolean;
  onClaim: (openShift: OpenShift) => void;
  isClaiming: boolean;
}
```

Display: Green `OPEN SHIFT` badge, template name, date (formatted), time range, position, area (if set), spots remaining ("2 spots left"), and a "Claim" button. When `hasConflict`, gray out the card and show "Schedule conflict" instead of the button.

Follow CLAUDE.md card styling: `rounded-xl border border-border/40 bg-background`. Use `text-[14px]` for names, `text-[13px]` for details, `text-[11px]` for badges.

- [ ] **Step 2: Create ClaimConfirmDialog**

Create `src/components/scheduling/ClaimConfirmDialog.tsx`:

```typescript
interface ClaimConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openShift: OpenShift | null;
  onConfirm: () => void;
  isPending: boolean;
}
```

A simple confirmation dialog: "Claim [Template Name] on [Date], [Time]?" with Cancel and Confirm buttons. Follow CLAUDE.md dialog structure with icon box header.

- [ ] **Step 3: Create AvailableShiftsPage**

Create `src/pages/AvailableShiftsPage.tsx` — replaces EmployeeShiftMarketplace. Structure:

1. Use `useRestaurantContext()` and `useCurrentEmployee()` for context
2. Compute current and next week dates
3. Call `useAvailableShifts(restaurantId, employeeId, weekStart, weekEnd)`
4. Call `useOpenShiftClaims(restaurantId, employeeId)` for "My Claims" section
5. Call `useClaimOpenShift()` for the claim mutation
6. Check employee's existing shifts for conflict detection (reuse pattern from `useMarketplaceTrades`)
7. Render a virtualized list of `AvailableShiftItem` cards (per CLAUDE.md performance rules):
   - `type === 'open_shift'` → render `OpenShiftCard`
   - `type === 'trade'` → render existing trade card UI (port from EmployeeShiftMarketplace)
8. Handle loading, error, and empty states
9. "My Claims" collapsible section at the bottom showing pending/approved/rejected claims
10. `ClaimConfirmDialog` rendered at page level (single dialog pattern)

Page header: "Available Shifts" with count badge showing total items.

- [ ] **Step 4: Update route in App.tsx**

In `src/App.tsx`, find the route for `/employee/shifts` (currently pointing to `EmployeeShiftMarketplace`) and change it to `AvailableShiftsPage`:

```typescript
import { AvailableShiftsPage } from '@/pages/AvailableShiftsPage';
// ...
<Route path="/employee/shifts" element={<AvailableShiftsPage />} />
```

Keep `EmployeeShiftMarketplace.tsx` file intact (don't delete) — it can be removed in a future cleanup.

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/pages/AvailableShiftsPage.tsx src/components/scheduling/OpenShiftCard.tsx src/components/scheduling/ClaimConfirmDialog.tsx src/App.tsx
git commit -m "feat: add unified available shifts page with open shift cards"
```

---

### Task 7: Publish dialog nudge and TradeApprovalQueue integration

**Files:**
- Modify: `src/components/PublishScheduleDialog.tsx`
- Modify: `src/components/schedule/TradeApprovalQueue.tsx`

- [ ] **Step 1: Update publish dialog nudge**

In `PublishScheduleDialog.tsx`, the open shifts alert (added in PR1) currently shows "You can fill these now or broadcast to your team later." Update to be conditional on `open_shifts_enabled`:

Add `openShiftsEnabled: boolean` prop. When `openShiftsEnabled` is false and `openShiftCount > 0`:
```
N shifts still need staff. Want employees to fill these? Enable open shift claiming →
```
The link text should call a callback `onEnableOpenShifts?: () => void` that navigates to staffing settings.

When `openShiftsEnabled` is true:
```
N shifts still need staff. You can fill these now or broadcast to your team later.
```

- [ ] **Step 2: Add claim approvals to TradeApprovalQueue**

In `TradeApprovalQueue.tsx`, add a third section for pending open shift claims:

1. Import `useOpenShiftClaims`, `useApproveClaimMutation`, `useRejectClaimMutation`
2. Fetch claims with status `pending_approval` for the restaurant
3. Render claim cards with a distinct "CLAIM" badge (green) vs "TRADE" badge (amber)
4. Each claim card shows: employee name, template name, date, time, position
5. Approve/Reject buttons following the existing trade approval pattern
6. Use the existing manager note dialog pattern for approve/reject actions

- [ ] **Step 3: Commit**

```bash
git add src/components/PublishScheduleDialog.tsx src/components/schedule/TradeApprovalQueue.tsx
git commit -m "feat: add claim approvals to trade queue and publish dialog nudge"
```

---

### Task 8: E2E test — employee claims an open shift

**Files:**
- Create: `tests/e2e/open-shift-claiming.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/open-shift-claiming.spec.ts`:

Test flow:
1. Sign up as manager, create restaurant
2. Enable open shift claiming in staffing settings (via Supabase helper — insert into staffing_settings with open_shifts_enabled=true)
3. Create a shift template with capacity=3 via Supabase insert
4. Publish the schedule (insert into schedule_publications)
5. Create a staff employee via Supabase insert
6. Navigate to `/employee/shifts` as the staff user (or use the same user if roles allow)
7. Verify open shift card is visible with template name
8. Click "Claim" button
9. Confirm in the dialog
10. Verify success toast appears
11. Verify the shift appears on the employee's schedule

Keep assertions timezone-agnostic per the lessons learned. Use `getByRole` and `getByText` with accessible selectors.

- [ ] **Step 2: Run the E2E test**

Run: `npx playwright test tests/e2e/open-shift-claiming.spec.ts`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/open-shift-claiming.spec.ts
git commit -m "test: E2E for open shift claiming flow"
```

---

## Self-Review

**Spec coverage:**
- `open_shift_claims` table: Task 1 ✓
- Settings columns: Task 1 ✓
- RLS policies: Task 1 ✓
- `get_open_shifts` RPC: Task 1 ✓
- `claim_open_shift` RPC: Task 1 ✓
- `approve/reject` RPCs: Task 1 ✓
- TypeScript types: Task 2 ✓
- Hooks (useOpenShifts, useClaimOpenShift, useOpenShiftClaims): Task 3 ✓
- useAvailableShifts merge: Task 4 ✓
- Settings UI toggles: Task 5 ✓
- Unified employee feed: Task 6 ✓
- OpenShiftCard: Task 6 ✓
- ClaimConfirmDialog: Task 6 ✓
- My Claims section: Task 6 ✓
- Publish dialog nudge: Task 7 ✓
- Claim approvals in queue: Task 7 ✓
- Conflict detection: Task 6 (inline check against employee shifts) ✓
- Feature gate (open_shifts_enabled): Tasks 1, 3, 5, 7 ✓
- E2E tests: Task 8 ✓
- pgTAP tests: Task 1 ✓
- Unit tests: Task 4 ✓

**Type consistency:** `OpenShift` and `OpenShiftClaim` types defined in Task 2, used consistently across Tasks 3-8. `mergeAvailableShifts` function name consistent between Task 4 test and implementation.

**No placeholders found.**
