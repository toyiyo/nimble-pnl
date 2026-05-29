# Staffing Suggestions: Actionable + Dead-End Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Planner staffing-suggestions card actionable (render the computed-but-unused `shiftBlocks`; "Apply" creates open shifts as `shift_templates`) and close the no-data / discovery / clarity dead-ends.

**Architecture:** Two pure helpers (`distributePositions`, `shiftBlocksToTemplates`) feed a new `useApplySuggestedShifts` mutation that upserts `shift_templates` with DB-enforced idempotency. New `SuggestedShifts` + `ApplyShiftsDialog` components render inside `StaffingOverlay`. Dead-end fixes are edits to `StaffingOverlay` + `StaffingConfigPanel`.

**Tech Stack:** React 18 + TS, React Query, shadcn/ui (Dialog, Checkbox, Button), Supabase Postgres, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-28-staffing-suggestions-actionable-design.md`

**Key types (already in `src/types/scheduling.ts`):**
- `ShiftBlock { startHour: number; endHour: number; headcount: number; day: string }` — `day` is a `YYYY-MM-DD` date string.
- `ShiftTemplate { id; restaurant_id; name; days: number[]; start_time; end_time; break_duration; position; capacity; area?; is_active; ... }`
- `MinCrew { [position: string]: number }`
- Day-of-week: `new Date(day + 'T12:00:00').getDay()` (0=Sun..6=Sat), matching `StaffingOverlay`'s existing convention.

---

### Task 1: `distributePositions` pure helper

**Files:**
- Create: `src/lib/staffingApply.ts`
- Test: `tests/unit/staffingApply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { distributePositions } from '@/lib/staffingApply';

describe('distributePositions', () => {
  it('returns generic Staff when min_crew is null', () => {
    expect(distributePositions(3, null)).toEqual([{ position: 'Staff', count: 3 }]);
  });
  it('returns generic Staff when min_crew is empty', () => {
    expect(distributePositions(2, {})).toEqual([{ position: 'Staff', count: 2 }]);
  });
  it('splits proportionally and preserves total headcount', () => {
    const out = distributePositions(3, { Server: 3, Cook: 2 }); // weights 3:2
    expect(out.reduce((s, p) => s + p.count, 0)).toBe(3);
    expect(out.find((p) => p.position === 'Server')!.count).toBe(2);
    expect(out.find((p) => p.position === 'Cook')!.count).toBe(1);
  });
  it('gives every listed position at least the headcount it can when headcount < positions', () => {
    const out = distributePositions(1, { Server: 1, Cook: 1, Host: 1 });
    expect(out.reduce((s, p) => s + p.count, 0)).toBe(1);
  });
  it('returns empty for zero headcount', () => {
    expect(distributePositions(0, { Server: 1 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/staffingApply.test.ts`
Expected: FAIL — `distributePositions is not a function`.

- [ ] **Step 3: Implement**

```ts
import type { MinCrew, ShiftBlock, ShiftTemplate } from '@/types/scheduling';

export interface PositionCount {
  position: string;
  count: number;
}

/**
 * Split a headcount across Minimum Crew positions proportionally to their weights,
 * preserving the total. Largest-remainder rounding (no lost or invented heads).
 * Falls back to a single generic "Staff" position when no crew is configured.
 */
export function distributePositions(headcount: number, minCrew: MinCrew | null): PositionCount[] {
  if (headcount <= 0) return [];
  const entries = minCrew ? Object.entries(minCrew).filter(([, w]) => w > 0) : [];
  if (entries.length === 0) return [{ position: 'Staff', count: headcount }];

  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  const raw = entries.map(([position, w]) => ({ position, exact: (w / totalWeight) * headcount }));
  const floored = raw.map((r) => ({ position: r.position, count: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let assigned = floored.reduce((s, r) => s + r.count, 0);

  // Distribute the remaining heads to the largest remainders.
  const byRemainder = [...floored].sort((a, b) => b.rem - a.rem);
  let i = 0;
  while (assigned < headcount && byRemainder.length > 0) {
    byRemainder[i % byRemainder.length].count += 1;
    assigned += 1;
    i += 1;
  }
  return floored.filter((r) => r.count > 0).map((r) => ({ position: r.position, count: r.count }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/staffingApply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/staffingApply.ts tests/unit/staffingApply.test.ts
git commit -m "feat(staffing): add distributePositions helper"
```

---

### Task 2: `shiftBlocksToTemplates` pure helper

**Files:**
- Modify: `src/lib/staffingApply.ts`
- Test: `tests/unit/staffingApply.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
import { shiftBlocksToTemplates } from '@/lib/staffingApply';
import type { ShiftBlock } from '@/types/scheduling';

describe('shiftBlocksToTemplates', () => {
  const restaurantId = 'r1';
  // 2026-05-29 is a Friday -> getDay() === 5
  const block: ShiftBlock = { startHour: 17, endHour: 22, headcount: 3, day: '2026-05-29' };

  it('maps a block to one template row per crew position with capacity = split count', () => {
    const rows = shiftBlocksToTemplates([block], { Server: 2, Cook: 1 }, restaurantId);
    expect(rows).toHaveLength(2); // Server + Cook
    const server = rows.find((r) => r.position === 'Server')!;
    expect(server.days).toEqual([5]);
    expect(server.start_time).toBe('17:00:00');
    expect(server.end_time).toBe('22:00:00');
    expect(server.capacity).toBe(2);
    expect(server.is_active).toBe(true);
    expect(server.restaurant_id).toBe(restaurantId);
    expect(server.name).toBe('Suggested · Server 17:00-22:00');
    expect(rows.reduce((s, r) => s + r.capacity, 0)).toBe(3);
  });

  it('falls back to a single generic Staff template when no crew', () => {
    const rows = shiftBlocksToTemplates([block], null, restaurantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe('Staff');
    expect(rows[0].capacity).toBe(3);
  });

  it('skips blocks with zero headcount', () => {
    expect(shiftBlocksToTemplates([{ ...block, headcount: 0 }], null, restaurantId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/staffingApply.test.ts`
Expected: FAIL — `shiftBlocksToTemplates is not a function`.

- [ ] **Step 3: Implement (append to `src/lib/staffingApply.ts`)**

```ts
export type TemplateInsert = Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at' | 'area'>;

const pad = (h: number) => `${String(h % 24).padStart(2, '0')}:00:00`;

/** Day-of-week (0=Sun..6=Sat) from a YYYY-MM-DD string, noon-anchored to dodge DST. */
export function dayStringToDow(day: string): number {
  return new Date(day + 'T12:00:00').getDay();
}

/**
 * Convert consolidated shift blocks into shift_templates insert rows.
 * Headcount is split across Minimum Crew positions; each position becomes one
 * template with capacity = its share. start/end are restaurant-local TIME values.
 */
export function shiftBlocksToTemplates(
  blocks: ShiftBlock[],
  minCrew: MinCrew | null,
  restaurantId: string,
): TemplateInsert[] {
  const rows: TemplateInsert[] = [];
  for (const block of blocks) {
    const dow = dayStringToDow(block.day);
    const start = pad(block.startHour);
    const end = pad(block.endHour);
    for (const { position, count } of distributePositions(block.headcount, minCrew)) {
      rows.push({
        restaurant_id: restaurantId,
        name: `Suggested · ${position} ${start.slice(0, 5)}-${end.slice(0, 5)}`,
        days: [dow],
        start_time: start,
        end_time: end,
        break_duration: 0,
        position,
        capacity: count,
        is_active: true,
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/staffingApply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/staffingApply.ts tests/unit/staffingApply.test.ts
git commit -m "feat(staffing): add shiftBlocksToTemplates helper"
```

---

### Task 3: Idempotency migration + pgTAP

**Files:**
- Create: `supabase/migrations/20260528120000_shift_templates_idempotent_apply.sql`
- Test: `supabase/tests/<n>_shift_templates_idempotent_apply.sql` (next free number in `supabase/tests/`)

- [ ] **Step 1: Write the migration**

```sql
-- Idempotent "Apply suggested shifts": a partial unique constraint lets the
-- client upsert with ON CONFLICT DO NOTHING so re-applying a week is a no-op.
-- Scoped to active templates only (soft-deleted rows must not block re-creation).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_templates_active_slot
  ON public.shift_templates (restaurant_id, position, start_time, end_time)
  WHERE is_active = true;
```

> Note: `ON CONFLICT` can target a partial unique index by repeating its predicate:
> `ON CONFLICT (restaurant_id, position, start_time, end_time) WHERE is_active = true DO NOTHING`.
> The `days` array is intentionally NOT in the key — a single slot may serve
> multiple days; re-apply should merge, and per-day differences are rare for
> suggestions. (If per-day uniqueness is later required, revisit.)

- [ ] **Step 2: Write the pgTAP test**

```sql
BEGIN;
SELECT plan(3);

-- Seed a restaurant + active template.
INSERT INTO restaurants (id, name) VALUES ('00000000-0000-0000-0000-0000000000aa', 'T');
INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active)
VALUES ('00000000-0000-0000-0000-0000000000aa','Suggested · Server 17:00-22:00','{5}','17:00:00','22:00:00',0,'Server',2,true);

-- 1. A duplicate active slot is rejected by the unique index.
SELECT throws_ok(
  $$INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active)
    VALUES ('00000000-0000-0000-0000-0000000000aa','dup','{5}','17:00:00','22:00:00',0,'Server',2,true)$$,
  '23505', NULL, 'duplicate active slot violates unique index'
);

-- 2. ON CONFLICT DO NOTHING makes re-apply a silent no-op.
SELECT lives_ok(
  $$INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active)
    VALUES ('00000000-0000-0000-0000-0000000000aa','dup','{5}','17:00:00','22:00:00',0,'Server',2,true)
    ON CONFLICT (restaurant_id, position, start_time, end_time) WHERE is_active = true DO NOTHING$$,
  'ON CONFLICT DO NOTHING re-apply is a no-op'
);

-- 3. A distinct slot (different position) still inserts.
SELECT lives_ok(
  $$INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active)
    VALUES ('00000000-0000-0000-0000-0000000000aa','Suggested · Cook 17:00-22:00','{5}','17:00:00','22:00:00',0,'Cook',1,true)$$,
  'distinct position inserts'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run the migration + test**

Run: `npm run db:reset && npm run test:db`
Expected: the new pgTAP file passes (3/3).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260528120000_shift_templates_idempotent_apply.sql supabase/tests/*_shift_templates_idempotent_apply.sql
git commit -m "feat(staffing): DB idempotency for Apply suggested shifts"
```

---

### Task 4: `useApplySuggestedShifts` hook

**Files:**
- Create: `src/hooks/useApplySuggestedShifts.ts`
- Test: `tests/unit/useApplySuggestedShifts.test.ts`

- [ ] **Step 1: Write the failing test** (mock supabase; assert chunked upsert, returned counts, invalidation)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const upsertMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ upsert: upsertMock }) },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useApplySuggestedShifts } from '@/hooks/useApplySuggestedShifts';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useApplySuggestedShifts', () => {
  beforeEach(() => upsertMock.mockReset());

  it('upserts rows and returns created/skipped counts', async () => {
    upsertMock.mockReturnValue({ select: () => Promise.resolve({ data: [{ id: '1' }], error: null }) });
    const { result } = renderHook(() => useApplySuggestedShifts('r1'), { wrapper });
    const rows = [{ restaurant_id: 'r1', name: 'x', days: [5], start_time: '17:00:00', end_time: '22:00:00', break_duration: 0, position: 'Server', capacity: 2, is_active: true }];
    const res = await result.current.applyShifts(rows);
    expect(upsertMock).toHaveBeenCalledOnce();
    expect(res).toEqual({ created: 1, skipped: 0 });
  });

  it('reports skipped when ON CONFLICT drops a row', async () => {
    upsertMock.mockReturnValue({ select: () => Promise.resolve({ data: [], error: null }) });
    const { result } = renderHook(() => useApplySuggestedShifts('r1'), { wrapper });
    const rows = [{ restaurant_id: 'r1', name: 'x', days: [5], start_time: '17:00:00', end_time: '22:00:00', break_duration: 0, position: 'Server', capacity: 2, is_active: true }];
    const res = await result.current.applyShifts(rows);
    expect(res).toEqual({ created: 0, skipped: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/useApplySuggestedShifts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

import type { TemplateInsert } from '@/lib/staffingApply';

const CHUNK = 200;

export function useApplySuggestedShifts(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (rows: TemplateInsert[]) => {
      let created = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { data, error } = await (supabase.from('shift_templates') as any)
          .upsert(chunk, {
            onConflict: 'restaurant_id,position,start_time,end_time',
            ignoreDuplicates: true,
          })
          .select('id');
        if (error) throw error;
        created += data?.length ?? 0;
      }
      return { created, skipped: rows.length - created };
    },
    onSuccess: ({ created, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ['shift_templates', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['open_shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      toast({
        title: `${created} open shift${created === 1 ? '' : 's'} created`,
        description: skipped > 0 ? `${skipped} already existed and were skipped.` : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not apply suggestions', description: error.message, variant: 'destructive' });
    },
  });

  return { applyShifts: mutation.mutateAsync, isApplying: mutation.isPending };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/useApplySuggestedShifts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useApplySuggestedShifts.ts tests/unit/useApplySuggestedShifts.test.ts
git commit -m "feat(staffing): useApplySuggestedShifts upsert hook"
```

---

### Task 5: `ApplyShiftsDialog` component

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/ApplyShiftsDialog.tsx`

UI components are unit-test-optional (CLAUDE.md); behavior is covered by the E2E in Task 9. Build to the a11y contract from the spec.

- [ ] **Step 1: Implement**

```tsx
import { useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import { CalendarClock } from 'lucide-react';

import { shiftBlocksToTemplates } from '@/lib/staffingApply';
import { useApplySuggestedShifts } from '@/hooks/useApplySuggestedShifts';

import type { MinCrew, ShiftBlock } from '@/types/scheduling';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtHour = (h: number) => {
  const m = h % 24;
  const ampm = m < 12 ? 'AM' : 'PM';
  const display = m % 12 === 0 ? 12 : m % 12;
  return `${display}${ampm}`;
};
const label = (b: ShiftBlock) =>
  `${DOW[new Date(b.day + 'T12:00:00').getDay()]} ${fmtHour(b.startHour)}–${fmtHour(b.endHour)}, ${b.headcount} staff`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: ShiftBlock[];
  minCrew: MinCrew | null;
  restaurantId: string;
  openShiftsEnabled: boolean;
}

export function ApplyShiftsDialog({ open, onOpenChange, blocks, minCrew, restaurantId, openShiftsEnabled }: Readonly<Props>) {
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const { applyShifts, isApplying } = useApplySuggestedShifts(restaurantId);

  const selected = useMemo(() => blocks.filter((_, i) => !excluded.has(i)), [blocks, excluded]);
  const hasCrew = !!minCrew && Object.keys(minCrew).length > 0;

  const toggle = (i: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const handleConfirm = async () => {
    const rows = shiftBlocksToTemplates(selected, minCrew, restaurantId);
    await applyShifts(rows);
    onOpenChange(false);
    setExcluded(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] p-0 gap-0 border-border/40 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <CalendarClock className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Apply suggested shifts</DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">Creates open shifts you can assign or let staff claim.</p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-4 space-y-2 overflow-y-auto">
          {!hasCrew && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-muted-foreground">
              No Minimum Crew set — these will be created as generic “Staff” shifts. Set a crew to split by role.
            </div>
          )}
          {!openShiftsEnabled && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20 text-[12px] text-muted-foreground">
              Created shifts appear in your template grid now. Enable Open Shift Claiming for staff to claim them.
            </div>
          )}
          {blocks.map((b, i) => (
            <label key={`${b.day}-${b.startHour}-${b.endHour}`} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/40 hover:border-border transition-colors cursor-pointer">
              <Checkbox checked={!excluded.has(i)} onCheckedChange={() => toggle(i)} aria-label={`Include ${label(b)}`} />
              <span className="text-[14px] font-medium text-foreground">{label(b)}</span>
            </label>
          ))}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/40">
          <Button variant="ghost" className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium" disabled={selected.length === 0 || isApplying} onClick={handleConfirm}>
            {isApplying ? 'Creating…' : `Create ${selected.length} shift${selected.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS (verify `@/components/ui/checkbox` exists; if not, `npx shadcn@latest add checkbox`).

```bash
git add src/components/scheduling/ShiftPlanner/ApplyShiftsDialog.tsx
git commit -m "feat(staffing): ApplyShiftsDialog preview + confirm"
```

---

### Task 6: `SuggestedShifts` component

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/SuggestedShifts.tsx`

- [ ] **Step 1: Implement** (groups blocks by day; three states; opens the dialog)

```tsx
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';

import { CalendarPlus } from 'lucide-react';

import { ApplyShiftsDialog } from './ApplyShiftsDialog';

import type { MinCrew, ShiftBlock } from '@/types/scheduling';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtHour = (h: number) => {
  const m = h % 24;
  const ampm = m < 12 ? 'AM' : 'PM';
  return `${m % 12 === 0 ? 12 : m % 12}${ampm}`;
};

interface Props {
  blocks: ShiftBlock[];
  minCrew: MinCrew | null;
  restaurantId: string;
  openShiftsEnabled: boolean;
}

export function SuggestedShifts({ blocks, minCrew, restaurantId, openShiftsEnabled }: Readonly<Props>) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const byDay = useMemo(() => {
    const m = new Map<string, ShiftBlock[]>();
    for (const b of blocks) (m.get(b.day) ?? m.set(b.day, []).get(b.day)!).push(b);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [blocks]);

  if (blocks.length === 0) {
    return (
      <div className="px-4 py-3 border-t border-border/40 text-[13px] text-muted-foreground">
        No consolidated shifts to suggest this week — try lowering your target Sales per Labor Hour.
      </div>
    );
  }

  return (
    <div className="border-t border-border/40">
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-[13px] font-semibold text-foreground">Suggested shifts</span>
        <Button
          className="h-8 px-3 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[12px] font-medium"
          onClick={() => setDialogOpen(true)}
        >
          <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />
          Apply suggested shifts
        </Button>
      </div>
      <div className="px-4 pb-3 space-y-1.5">
        {byDay.map(([day, dayBlocks]) => (
          <div key={day} className="flex items-center gap-3 text-[13px]">
            <span className="w-10 font-medium text-muted-foreground">{DOW[new Date(day + 'T12:00:00').getDay()]}</span>
            <span className="text-foreground">
              {dayBlocks.map((b) => `${fmtHour(b.startHour)}–${fmtHour(b.endHour)} (${b.headcount})`).join(', ')}
            </span>
          </div>
        ))}
      </div>
      <ApplyShiftsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        blocks={blocks}
        minCrew={minCrew}
        restaurantId={restaurantId}
        openShiftsEnabled={openShiftsEnabled}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck` → PASS.

```bash
git add src/components/scheduling/ShiftPlanner/SuggestedShifts.tsx
git commit -m "feat(staffing): SuggestedShifts list + apply trigger"
```

---

### Task 7: Wire `SuggestedShifts` into `StaffingOverlay` + collect blocks + default-expanded

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx`

- [ ] **Step 1: Expose `min_crew` + `open_shifts_enabled` and aggregate blocks.** In `useWeekStaffingSuggestions`, the return already exposes `activeSettings`. Add an aggregated blocks array computed from `daySuggestions`:

```tsx
// after the `summary` useMemo in StaffingOverlay (~line 242)
const allShiftBlocks = useMemo(
  () => [...daySuggestions.values()].flatMap((s) => s.shiftBlocks),
  [daySuggestions],
);
```

- [ ] **Step 2: Default the card expanded** — change line 186:

```tsx
const [isExpanded, setIsExpanded] = useState(true);
```

- [ ] **Step 3: Render `SuggestedShifts`** immediately after the Summary row block (after line 376, before `</>`):

```tsx
{hasSalesData && (
  <SuggestedShifts
    blocks={allShiftBlocks}
    minCrew={activeSettings.min_crew}
    restaurantId={restaurantId}
    openShiftsEnabled={activeSettings.open_shifts_enabled}
  />
)}
```

- [ ] **Step 4: Add import** near the other local imports (~line 23):

```tsx
import { SuggestedShifts } from './SuggestedShifts';
```

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → PASS.

```bash
git add src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx
git commit -m "feat(staffing): render SuggestedShifts in overlay"
```

---

### Task 8: Dead-end fixes in `StaffingOverlay`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx`

- [ ] **Step 1: Always show the "How it works" explainer.** Replace the `{hasSalesData && ( ... )}` wrapper around the explainer (lines 293–317) so the explainer renders unconditionally; only the `hasHourlyBreakdown` ternary inside stays. Keep the explainer block, drop the `hasSalesData &&` guard.

- [ ] **Step 2: Add a no-data empty state.** Inside `CollapsibleContent`, after the error branch and before/around the grid, render when `!hasSalesData`:

```tsx
{!hasSalesData && (
  <div className="px-4 py-6 text-center space-y-2">
    <p className="text-[13px] text-muted-foreground">
      Staffing suggestions need sales history. Connect your POS or enter sales to see recommendations.
    </p>
    <Link to="/integrations" className="text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:underline">
      Connect your POS
    </Link>
  </div>
)}
```

Add `import { Link } from 'react-router-dom';` (import-order group 1). Gate the day-columns grid + summary + SuggestedShifts on `hasSalesData` (already true for summary/SuggestedShifts).

- [ ] **Step 3: Error state gets a Retry.** Capture `refetch` from the sales query (return it from `useWeekStaffingSuggestions`) and render a button in the error branch:

```tsx
<button onClick={() => refetch()} className="ml-2 text-[13px] font-medium text-foreground underline">Retry</button>
```

(Add `refetch` to the `useQuery` destructure for `allSales` and to the hook's return.)

- [ ] **Step 4: Show the legend on mobile.** Change line 328 `className="hidden md:flex ..."` → `className="flex flex-wrap ..."` so the On-target/Over-budget legend renders on all widths.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → PASS.

```bash
git add src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx
git commit -m "fix(staffing): empty state, always-on explainer, retry, mobile legend"
```

---

### Task 9: `StaffingConfigPanel` clarity — Save gating + Help labels

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx`
- Modify: `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` (pass `hasPendingChanges`)

- [ ] **Step 1: Pass pending state.** In `StaffingOverlay`, pass `hasPendingChanges={localSettings !== null}` to `<StaffingConfigPanel .../>` (around line 281).

- [ ] **Step 2: Use it.** In `StaffingConfigPanel`, accept `hasPendingChanges: boolean`; set the "Save as Default" button `disabled={!hasPendingChanges || isSaving}`; add helper text under it: `Toggles save automatically; numeric settings save here.` (`text-[12px] text-muted-foreground`).

- [ ] **Step 3: Help icon labels.** For each `TooltipTrigger` wrapping a `HelpCircle`, add `aria-label={\`Help for ${fieldName}\`}` to the trigger (e.g. "Help for Sales per Labor Hour").

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck` → PASS.

```bash
git add src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx
git commit -m "fix(staffing): clarify save mechanics + help labels"
```

---

### Task 10: E2E — apply suggestions flow

**Files:**
- Create: `tests/e2e/staffing-suggestions.spec.ts`

- [ ] **Step 1: Write the test** (helpers from `'../helpers/e2e-supabase'`, `generateTestUser()`, accessible selectors)

```ts
import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant } from '../helpers/e2e-supabase';

test('staffing suggestions: empty state, then apply creates shifts', async ({ page }) => {
  await signUpAndCreateRestaurant(page);
  await page.goto('/scheduling');
  await page.getByRole('tab', { name: /planner/i }).click();

  // Card defaults expanded; with no sales data the empty-state CTA shows.
  await expect(page.getByRole('link', { name: /connect your pos/i })).toBeVisible();

  // (Seed sales via helper here, reload, then:)
  // await expect(page.getByText('Suggested shifts')).toBeVisible();
  // await page.getByRole('button', { name: /apply suggested shifts/i }).click();
  // await expect(page.getByRole('dialog', { name: /apply suggested shifts/i })).toBeVisible();
  // await page.getByRole('button', { name: /create \d+ shift/i }).click();
  // await expect(page.getByText(/open shifts? created/i)).toBeVisible();
});
```

> The seeded-sales half is commented because it needs a sales-seeding helper; the
> Phase-4 agent should add seeding via the existing e2e Supabase helper (mirror how
> other scheduling specs seed `unified_sales`) and un-comment the assertions.

- [ ] **Step 2: Run**

Run: `npx playwright test tests/e2e/staffing-suggestions.spec.ts`
Expected: the empty-state assertion passes; the seeded half passes once seeding is wired.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/staffing-suggestions.spec.ts
git commit -m "test(staffing): e2e for empty state + apply flow"
```

---

## Self-Review

- **Spec coverage:** A.1 empty state + always-on explainer → Task 8; A.2 retry → Task 8; A.3 default-expanded → Task 7; A.4 save clarity → Task 9; A.5 chart legend → Task 8; B.6 render shiftBlocks → Tasks 6–7; B.7 ApplyShiftsDialog → Task 5; B.8 upsert + invalidate → Task 4; migration/idempotency → Task 3; helpers → Tasks 1–2; a11y contract → Tasks 5/9; tests → Tasks 1–4, 10. ✅ All spec sections mapped.
- **Type consistency:** `TemplateInsert` (Task 2) is consumed by `shiftBlocksToTemplates` output and `useApplySuggestedShifts` input (Task 4) and `ApplyShiftsDialog` (Task 5). `distributePositions` → `PositionCount` used only internally. `ShiftBlock`/`MinCrew`/`ShiftTemplate` match `src/types/scheduling.ts`. ✅
- **Placeholder scan:** the only deferred item is the E2E sales-seeding half (Task 10), explicitly flagged with how to complete it — not a silent TODO.
- **Chart axis label** (spec A.5) is partially covered (legend on mobile); a dedicated "Staff per Hour" axis label already exists at line 322. No extra task needed.
