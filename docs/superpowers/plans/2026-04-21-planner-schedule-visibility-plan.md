# Planner Schedule Visibility & Week Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the selected week across Schedule/Planner tabs via URL param, and grow the Planner with four composable visibility layers (coverage strip, day overview panel, employee mini-weeks, allocation overlay) so managers can see "what does this week look like" and "where does this person fit" without leaving the Planner.

**Architecture:** One new shared-week hook (`useSharedWeek`) reading/writing `?week=YYYY-MM-DD`. One pure utility (`computeAllocationStatus`). One derivations hook (`usePlannerShiftsIndex`) that memoizes coverage, overview-day, and shifts-by-employee indexes from the existing `shifts` query. Four new presentational components (`CoverageStrip`, `ScheduleOverviewPanel` + `OverviewDayCard`, `EmployeeMiniWeek`). Minimal prop additions to `ShiftCell`, `TemplateGrid`, `EmployeeSidebar`. `useShiftPlanner` gains an optional `externalWeekStart` to defer to the shared source. No new Supabase calls.

**Tech Stack:** React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, React Router 6 `useSearchParams`, `@dnd-kit/core`, `date-fns`, Vitest, Playwright. Follows CLAUDE.md Apple/Notion typography + semantic tokens (`bg-muted/30`, `border-border/40`, `rounded-xl`).

---

## File Structure

### New files
- `src/hooks/useSharedWeek.ts` — URL-backed Monday-aligned week state hook
- `src/hooks/usePlannerShiftsIndex.ts` — memoized derivations (coverage/overview/shiftsByEmployee)
- `src/lib/shiftAllocation.ts` — pure `computeAllocationStatus` + `computeAllocationStatuses`
- `src/components/scheduling/ShiftPlanner/CoverageStrip.tsx` — horizontal heatmap under day headers (desktop)
- `src/components/scheduling/ShiftPlanner/ScheduleOverviewPanel.tsx` — panel above the grid
- `src/components/scheduling/ShiftPlanner/OverviewDayCard.tsx` — single-day Gantt card (reused desktop+mobile)
- `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx` — 7-column per-employee mini-timeline
- `tests/unit/useSharedWeek.test.ts`
- `tests/unit/usePlannerShiftsIndex.test.ts`
- `tests/unit/shiftAllocation.test.ts`
- `tests/unit/CoverageStrip.test.tsx`
- `tests/unit/OverviewDayCard.test.tsx`
- `tests/unit/EmployeeMiniWeek.test.tsx`
- `tests/e2e/planner-week-sync.spec.ts`
- `tests/e2e/planner-allocation-overlay.spec.ts`

### Modified files
- `src/pages/Scheduling.tsx` — replace `currentWeekStart` `useState` with `useSharedWeek()`
- `src/hooks/useShiftPlanner.ts` — accept optional `externalWeekStart`/`setExternalWeekStart` props
- `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` — pass shared week down, own `pickedEmployeeId` state, mount Coverage + Overview + overlay plumbing
- `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx` — accept `allocationStatuses`, `coverageStrip` slot, thread down to `ShiftCell`
- `src/components/scheduling/ShiftPlanner/ShiftCell.tsx` — accept `allocationStatus` prop, render outline/stripe/tint + chip
- `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx` — render mini-week inside each `DraggableEmployee`, wire hover/select → `onEmployeePick`

---

## Phase 1 — Shared Week State

### Task 1.1: Write failing test for `useSharedWeek` hook

**Files:**
- Create: `tests/unit/useSharedWeek.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { ReactNode } from 'react';

import { useSharedWeek } from '@/hooks/useSharedWeek';

function wrap(initialUrl: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="/scheduling" element={<>{children}</>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('useSharedWeek', () => {
  it('defaults to the Monday of the current week when no param is present', () => {
    const { result } = renderHook(() => useSharedWeek(), { wrapper: wrap('/scheduling') });
    expect(result.current.weekStart.getDay()).toBe(1); // Monday
    expect(result.current.weekStart.getHours()).toBe(0);
  });

  it('reads ?week=YYYY-MM-DD and returns that Monday', () => {
    const { result } = renderHook(() => useSharedWeek(), {
      wrapper: wrap('/scheduling?week=2026-04-20'),
    });
    expect(result.current.weekStart.getFullYear()).toBe(2026);
    expect(result.current.weekStart.getMonth()).toBe(3); // April
    expect(result.current.weekStart.getDate()).toBe(20);
    expect(result.current.weekStart.getDay()).toBe(1);
  });

  it('normalizes a non-Monday param to the Monday of that week', () => {
    // 2026-04-22 is a Wednesday -> Monday is 2026-04-20
    const { result } = renderHook(() => useSharedWeek(), {
      wrapper: wrap('/scheduling?week=2026-04-22'),
    });
    expect(result.current.weekStart.getDate()).toBe(20);
    expect(result.current.weekStart.getDay()).toBe(1);
  });

  it('falls back to current Monday when param is malformed', () => {
    const { result } = renderHook(() => useSharedWeek(), {
      wrapper: wrap('/scheduling?week=not-a-date'),
    });
    expect(result.current.weekStart.getDay()).toBe(1);
  });

  it('setWeekStart updates the URL param to the Monday', () => {
    const wrapper = wrap('/scheduling?week=2026-04-20');
    const { result } = renderHook(
      () => {
        const shared = useSharedWeek();
        const [params] = useSearchParams();
        return { shared, param: params.get('week') };
      },
      { wrapper },
    );
    act(() => {
      result.current.shared.setWeekStart(new Date(2026, 4, 4)); // 2026-05-04 Monday
    });
    expect(result.current.param).toBe('2026-05-04');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/useSharedWeek.test.ts`
Expected: FAIL — "Cannot find module '@/hooks/useSharedWeek'"

### Task 1.2: Implement `useSharedWeek` hook

**Files:**
- Create: `src/hooks/useSharedWeek.ts`

- [ ] **Step 1: Write the minimal implementation**

```typescript
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getMondayOfWeek } from '@/hooks/useShiftPlanner';

const WEEK_PARAM = 'week';

function formatIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseWeekParam(value: string | null): Date {
  if (!value) return getMondayOfWeek(new Date());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return getMondayOfWeek(new Date());
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return getMondayOfWeek(new Date());
  return getMondayOfWeek(parsed);
}

export interface UseSharedWeekReturn {
  weekStart: Date;
  setWeekStart: (date: Date) => void;
}

export function useSharedWeek(): UseSharedWeekReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawWeek = searchParams.get(WEEK_PARAM);

  const weekStart = useMemo(() => parseWeekParam(rawWeek), [rawWeek]);

  const setWeekStart = useCallback(
    (date: Date) => {
      const monday = getMondayOfWeek(date);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(WEEK_PARAM, formatIsoDate(monday));
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  return { weekStart, setWeekStart };
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test -- tests/unit/useSharedWeek.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSharedWeek.ts tests/unit/useSharedWeek.test.ts
git commit -m "feat(scheduling): add useSharedWeek hook for URL-backed week state"
```

### Task 1.3: Thread `externalWeekStart` through `useShiftPlanner`

**Files:**
- Modify: `src/hooks/useShiftPlanner.ts:307-313`

- [ ] **Step 1: Update the hook signature and internal state**

Replace the current function signature and the week-navigation block:

```typescript
// Line 307-313 (approx) — replace:
export function useShiftPlanner(
  restaurantId: string | null,
): UseShiftPlannerReturn {
  // Week navigation state
  const [weekStart, setWeekStart] = useState<Date>(() =>
    getMondayOfWeek(new Date()),
  );

// With:
export interface UseShiftPlannerOptions {
  /**
   * When provided, the hook defers all week state to this external source
   * (e.g. useSharedWeek) instead of owning it internally. When omitted,
   * the hook manages its own weekStart via useState.
   */
  externalWeekStart?: Date;
  onExternalWeekStartChange?: (next: Date) => void;
}

export function useShiftPlanner(
  restaurantId: string | null,
  options: UseShiftPlannerOptions = {},
): UseShiftPlannerReturn {
  const { externalWeekStart, onExternalWeekStartChange } = options;

  const [internalWeekStart, setInternalWeekStart] = useState<Date>(() =>
    getMondayOfWeek(new Date()),
  );

  const weekStart = externalWeekStart ?? internalWeekStart;
  const setWeekStart = useCallback(
    (updater: Date | ((prev: Date) => Date)) => {
      if (externalWeekStart !== undefined && onExternalWeekStartChange) {
        const next =
          typeof updater === 'function'
            ? (updater as (prev: Date) => Date)(externalWeekStart)
            : updater;
        onExternalWeekStartChange(getMondayOfWeek(next));
      } else {
        setInternalWeekStart((prev) =>
          typeof updater === 'function'
            ? (updater as (prev: Date) => Date)(prev)
            : updater,
        );
      }
    },
    [externalWeekStart, onExternalWeekStartChange],
  );
```

- [ ] **Step 2: Audit all `setWeekStart` call sites within the hook**

Run: `grep -n "setWeekStart" src/hooks/useShiftPlanner.ts`
For each match (goToNextWeek, goToPrevWeek, goToToday, jumpToWeek), the signature is unchanged because `setWeekStart` still accepts `Date | (prev => Date)`. Confirm each still compiles.

- [ ] **Step 3: Run the planner hook tests**

Run: `npm run test -- tests/unit/useShiftPlanner.test.ts`
Expected: PASS (no behavior change when options are unset)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useShiftPlanner.ts
git commit -m "feat(scheduling): allow useShiftPlanner to defer week state to external source"
```

### Task 1.4: Wire `useSharedWeek` into `Scheduling.tsx`

**Files:**
- Modify: `src/pages/Scheduling.tsx:331` (replace `useState` for `currentWeekStart`)

- [ ] **Step 1: Replace the local state with the shared hook**

Find line 331:
```typescript
const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
```

Replace with:
```typescript
const { weekStart: currentWeekStart, setWeekStart: setCurrentWeekStart } = useSharedWeek();
```

And add the import near the top of the file (after existing `@/hooks/...` imports):
```typescript
import { useSharedWeek } from '@/hooks/useSharedWeek';
```

- [ ] **Step 2: Remove the now-unused `startOfWeek` seed (if only used for that line)**

Run: `grep -n "startOfWeek" src/pages/Scheduling.tsx`
If the only remaining use is in `endOfWeek(currentWeekStart, { weekStartsOn: 1 })` nearby, leave the `date-fns` import alone (other uses remain). Do NOT delete the import.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat(scheduling): persist selected week across tabs via URL param"
```

### Task 1.5: Pass shared week into `ShiftPlannerTab`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:45-69` (props + hook call)
- Modify: `src/pages/Scheduling.tsx` (pass `weekStart`+`setWeekStart` to `<ShiftPlannerTab>`)

- [ ] **Step 1: Update `ShiftPlannerTabProps`**

In `ShiftPlannerTab.tsx`, replace:
```typescript
interface ShiftPlannerTabProps {
  restaurantId: string;
}

export function ShiftPlannerTab({
  restaurantId,
}: Readonly<ShiftPlannerTabProps>) {
```

With:
```typescript
interface ShiftPlannerTabProps {
  restaurantId: string;
  weekStart: Date;
  onWeekStartChange: (next: Date) => void;
}

export function ShiftPlannerTab({
  restaurantId,
  weekStart: externalWeekStart,
  onWeekStartChange,
}: Readonly<ShiftPlannerTabProps>) {
```

- [ ] **Step 2: Forward them into `useShiftPlanner`**

Find the `useShiftPlanner(restaurantId)` call (around line 52) and change to:
```typescript
const {
  weekStart,
  weekEnd,
  weekDays,
  goToNextWeek,
  goToPrevWeek,
  goToToday,
  shifts,
  employees,
  isLoading,
  error,
  validateAndCreate,
  forceCreate,
  deleteShift,
  validationResult,
  clearValidation,
  totalHours,
} = useShiftPlanner(restaurantId, {
  externalWeekStart,
  onExternalWeekStartChange: onWeekStartChange,
});
```

- [ ] **Step 3: Update the caller in `Scheduling.tsx`**

Find `<ShiftPlannerTab restaurantId={restaurantId} />` (around line 1821) and replace with:
```typescript
<ShiftPlannerTab
  restaurantId={restaurantId}
  weekStart={currentWeekStart}
  onWeekStartChange={setCurrentWeekStart}
/>
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx src/pages/Scheduling.tsx
git commit -m "feat(scheduling): thread shared week from Scheduling into ShiftPlannerTab"
```

---

## Phase 2 — Shift Allocation Utility

### Task 2.1: Write failing tests for `computeAllocationStatus`

**Files:**
- Create: `tests/unit/shiftAllocation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';

import { computeAllocationStatus } from '@/lib/shiftAllocation';

import type { Shift, ShiftTemplate } from '@/types/scheduling';

function makeShift(partial: Partial<Shift>): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-04-20T13:00:00Z',
    end_time: '2026-04-20T21:00:00Z',
    break_duration: 0,
    position: 'server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

function makeTemplate(partial: Partial<ShiftTemplate>): ShiftTemplate {
  return {
    id: 't1',
    restaurant_id: 'r1',
    name: 'Open',
    days: [1, 2, 3, 4, 5],
    start_time: '09:00:00',
    end_time: '17:00:00',
    break_duration: 0,
    position: 'server',
    capacity: 2,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('computeAllocationStatus', () => {
  const template = makeTemplate({ start_time: '09:00:00', end_time: '17:00:00' });

  it('returns "none" when template is not active on the day', () => {
    const tpl = makeTemplate({ days: [1, 2, 3] }); // Mon-Wed only
    const sundayShifts: Shift[] = [];
    // 2026-04-19 is a Sunday (day 0)
    const result = computeAllocationStatus(sundayShifts, tpl, '2026-04-19');
    expect(result).toBe('none');
  });

  it('returns "highlight" when employee already has a shift encompassing the template slot', () => {
    const shift = makeShift({
      start_time: '2026-04-20T09:00:00',
      end_time: '2026-04-20T17:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('highlight');
  });

  it('returns "highlight" when employee shift strictly contains the template slot', () => {
    const shift = makeShift({
      start_time: '2026-04-20T08:00:00',
      end_time: '2026-04-20T18:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('highlight');
  });

  it('returns "conflict" when employee has a partially-overlapping shift', () => {
    const shift = makeShift({
      start_time: '2026-04-20T12:00:00',
      end_time: '2026-04-20T20:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('conflict');
  });

  it('returns "available" when employee has no shift on the day', () => {
    expect(computeAllocationStatus([], template, '2026-04-20')).toBe('available');
  });

  it('returns "available" when employee has a shift on a different day', () => {
    const shift = makeShift({
      start_time: '2026-04-21T12:00:00',
      end_time: '2026-04-21T20:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('available');
  });

  it('ignores cancelled shifts', () => {
    const shift = makeShift({
      start_time: '2026-04-20T12:00:00',
      end_time: '2026-04-20T20:00:00',
      status: 'cancelled',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('available');
  });

  it('treats touching-but-not-overlapping shifts as available', () => {
    const shift = makeShift({
      start_time: '2026-04-20T17:00:00',
      end_time: '2026-04-20T22:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('available');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/shiftAllocation.test.ts`
Expected: FAIL — "Cannot find module '@/lib/shiftAllocation'"

### Task 2.2: Implement `computeAllocationStatus`

**Files:**
- Create: `src/lib/shiftAllocation.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import { templateAppliesToDay } from '@/hooks/useShiftTemplates';

import type { Shift, ShiftTemplate } from '@/types/scheduling';

export type AllocationStatus = 'none' | 'highlight' | 'conflict' | 'available';

/**
 * Classifies how an employee's existing shifts relate to a template slot
 * on a given day. Used by the planner allocation overlay.
 *
 * - "none": template is not active on the day (no annotation)
 * - "highlight": employee is already scheduled covering this slot
 * - "conflict": employee has a shift that partially overlaps this slot
 * - "available": template is active, employee has no overlapping shift
 */
export function computeAllocationStatus(
  employeeShifts: readonly Shift[],
  template: ShiftTemplate,
  day: string,
): AllocationStatus {
  if (!templateAppliesToDay(template, day)) return 'none';

  const templateStart = toDateTime(day, template.start_time);
  const templateEnd = toDateTime(day, template.end_time);

  let hasOverlap = false;
  let isEncompassed = false;

  for (const shift of employeeShifts) {
    if (shift.status === 'cancelled') continue;
    if (!sameDay(shift.start_time, day)) continue;

    const shiftStart = new Date(shift.start_time).getTime();
    const shiftEnd = new Date(shift.end_time).getTime();

    if (shiftStart <= templateStart && shiftEnd >= templateEnd) {
      isEncompassed = true;
    } else if (shiftStart < templateEnd && shiftEnd > templateStart) {
      hasOverlap = true;
    }
  }

  if (isEncompassed) return 'highlight';
  if (hasOverlap) return 'conflict';
  return 'available';
}

function sameDay(isoString: string, day: string): boolean {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${dd}` === day;
}

function toDateTime(day: string, hhmmss: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mm, s] = hhmmss.split(':').map(Number);
  return new Date(y, m - 1, d, h, mm, s || 0).getTime();
}

/**
 * Batch version — for every (template × day) cell, returns the allocation
 * status keyed by `${templateId}:${day}`. O(templates × days × shifts) with
 * a per-day shift bucket for the hot path.
 */
export function computeAllocationStatuses(
  employeeShifts: readonly Shift[],
  templates: readonly ShiftTemplate[],
  weekDays: readonly string[],
): Map<string, AllocationStatus> {
  const shiftsByDay = new Map<string, Shift[]>();
  for (const shift of employeeShifts) {
    const iso = shift.start_time.slice(0, 10);
    let bucket = shiftsByDay.get(iso);
    if (!bucket) {
      bucket = [];
      shiftsByDay.set(iso, bucket);
    }
    bucket.push(shift);
  }

  const result = new Map<string, AllocationStatus>();
  for (const template of templates) {
    for (const day of weekDays) {
      const bucket = shiftsByDay.get(day) ?? [];
      result.set(`${template.id}:${day}`, computeAllocationStatus(bucket, template, day));
    }
  }
  return result;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test -- tests/unit/shiftAllocation.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 3: Commit**

```bash
git add src/lib/shiftAllocation.ts tests/unit/shiftAllocation.test.ts
git commit -m "feat(scheduling): add shift allocation status utility"
```

---

## Phase 3 — Planner Shifts Index Hook

### Task 3.1: Write failing tests for `usePlannerShiftsIndex`

**Files:**
- Create: `tests/unit/usePlannerShiftsIndex.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import { usePlannerShiftsIndex } from '@/hooks/usePlannerShiftsIndex';

import type { Shift } from '@/types/scheduling';

function makeShift(partial: Partial<Shift>): Shift {
  return {
    id: 's' + Math.random().toString(36).slice(2, 8),
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-04-20T13:00:00',
    end_time: '2026-04-20T21:00:00',
    break_duration: 0,
    position: 'server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

const weekDays = [
  '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23',
  '2026-04-24', '2026-04-25', '2026-04-26',
];

describe('usePlannerShiftsIndex', () => {
  it('groups shifts by employee', () => {
    const shifts: Shift[] = [
      makeShift({ id: 'a', employee_id: 'e1' }),
      makeShift({ id: 'b', employee_id: 'e2' }),
      makeShift({ id: 'c', employee_id: 'e1', start_time: '2026-04-21T13:00:00', end_time: '2026-04-21T17:00:00' }),
    ];
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    expect(result.current.shiftsByEmployee.get('e1')).toHaveLength(2);
    expect(result.current.shiftsByEmployee.get('e2')).toHaveLength(1);
  });

  it('ignores cancelled shifts in all derivations', () => {
    const shifts: Shift[] = [
      makeShift({ id: 'a', status: 'cancelled' }),
    ];
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    expect(result.current.shiftsByEmployee.size).toBe(0);
    expect(result.current.coverageByDay.get('2026-04-20')?.every((n) => n === 0)).toBe(true);
  });

  it('computes coverage counts by hour bucket', () => {
    // A shift 13:00-17:00 covers buckets for hours 13,14,15,16 (4 buckets).
    const shifts: Shift[] = [
      makeShift({ start_time: '2026-04-20T13:00:00', end_time: '2026-04-20T17:00:00' }),
      makeShift({ start_time: '2026-04-20T14:00:00', end_time: '2026-04-20T18:00:00' }),
    ];
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    const coverage = result.current.coverageByDay.get('2026-04-20')!;
    // Buckets are 6am-11pm (17 buckets). Bucket N covers hour 6+N.
    // Shift 13:00-17:00 covers buckets 7..10 (hours 13,14,15,16).
    // Shift 14:00-18:00 covers buckets 8..11 (hours 14,15,16,17).
    expect(coverage[7]).toBe(1);  // 1pm: only first shift
    expect(coverage[8]).toBe(2);  // 2pm: both shifts
    expect(coverage[10]).toBe(2); // 4pm: both shifts
    expect(coverage[11]).toBe(1); // 5pm: only second shift
    expect(coverage[12]).toBe(0); // 6pm: no one
  });

  it('builds overview day entries for the visible week only', () => {
    const shifts: Shift[] = [
      makeShift({ start_time: '2026-04-20T13:00:00', end_time: '2026-04-20T21:00:00' }),
      makeShift({ start_time: '2026-04-10T13:00:00', end_time: '2026-04-10T21:00:00' }),
    ];
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    const overview = result.current.overviewDays;
    expect(overview).toHaveLength(7);
    expect(overview[0].day).toBe('2026-04-20');
    expect(overview[0].pills).toHaveLength(1);
    expect(overview[1].pills).toHaveLength(0);
  });

  it('packs overlapping shifts into separate lanes up to 3, collapses remainder', () => {
    const day = '2026-04-20';
    const shifts: Shift[] = Array.from({ length: 5 }, (_, i) =>
      makeShift({ id: `s${i}`, start_time: `${day}T13:00:00`, end_time: `${day}T17:00:00` }),
    );
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    const monday = result.current.overviewDays[0];
    expect(monday.pills.filter((p) => p.lane >= 0 && p.lane < 3)).toHaveLength(3);
    expect(monday.collapsedCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/usePlannerShiftsIndex.test.ts`
Expected: FAIL — "Cannot find module '@/hooks/usePlannerShiftsIndex'"

### Task 3.2: Implement `usePlannerShiftsIndex`

**Files:**
- Create: `src/hooks/usePlannerShiftsIndex.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import { useMemo } from 'react';

import type { Shift } from '@/types/scheduling';

export const COVERAGE_START_HOUR = 6;
export const COVERAGE_END_HOUR = 23; // exclusive
export const COVERAGE_BUCKETS = COVERAGE_END_HOUR - COVERAGE_START_HOUR; // 17
export const MAX_OVERVIEW_LANES = 3;

export interface OverviewPill {
  shiftId: string;
  employeeId: string | null;
  employeeName: string;
  position: string | null;
  startHour: number; // float, e.g. 13.5
  endHour: number;
  lane: number;    // 0..MAX_OVERVIEW_LANES-1 or -1 for overflow
}

export interface OverviewDay {
  day: string;            // YYYY-MM-DD
  pills: OverviewPill[];
  collapsedCount: number; // shifts that didn't fit in visible lanes
  hasGap: boolean;
  gapLabel: string | null;
  unstaffed: boolean;
}

export interface UsePlannerShiftsIndexReturn {
  shiftsByEmployee: Map<string, Shift[]>;
  coverageByDay: Map<string, number[]>; // day -> 17 numbers
  overviewDays: OverviewDay[];
}

function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

function hourOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}

export function usePlannerShiftsIndex(
  shifts: readonly Shift[],
  weekDays: readonly string[],
): UsePlannerShiftsIndexReturn {
  const shiftsByEmployee = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of shifts) {
      if (shift.status === 'cancelled' || !shift.employee_id) continue;
      const bucket = map.get(shift.employee_id) ?? [];
      bucket.push(shift);
      map.set(shift.employee_id, bucket);
    }
    return map;
  }, [shifts]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const day of weekDays) map.set(day, []);
    for (const shift of shifts) {
      if (shift.status === 'cancelled') continue;
      const key = isoDay(shift.start_time);
      const bucket = map.get(key);
      if (bucket) bucket.push(shift);
    }
    return map;
  }, [shifts, weekDays]);

  const coverageByDay = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const day of weekDays) {
      const counts = new Array<number>(COVERAGE_BUCKETS).fill(0);
      const dayShifts = shiftsByDay.get(day) ?? [];
      for (const shift of dayShifts) {
        const startHour = hourOfDay(shift.start_time);
        const endHour = hourOfDay(shift.end_time);
        const startBucket = Math.max(0, Math.floor(startHour) - COVERAGE_START_HOUR);
        const endBucket = Math.min(COVERAGE_BUCKETS, Math.ceil(endHour) - COVERAGE_START_HOUR);
        for (let b = startBucket; b < endBucket; b++) counts[b]++;
      }
      map.set(day, counts);
    }
    return map;
  }, [shiftsByDay, weekDays]);

  const overviewDays = useMemo<OverviewDay[]>(() => {
    return weekDays.map((day) => {
      const dayShifts = (shiftsByDay.get(day) ?? [])
        .slice()
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      const lanes: number[] = []; // lanes[i] = end timestamp of last shift in lane i
      const pills: OverviewPill[] = [];
      let collapsedCount = 0;

      for (const shift of dayShifts) {
        const start = new Date(shift.start_time).getTime();
        const end = new Date(shift.end_time).getTime();
        let placed = -1;
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i] <= start) {
            placed = i;
            lanes[i] = end;
            break;
          }
        }
        if (placed === -1) {
          if (lanes.length < MAX_OVERVIEW_LANES) {
            placed = lanes.length;
            lanes.push(end);
          } else {
            collapsedCount++;
            continue;
          }
        }
        pills.push({
          shiftId: shift.id,
          employeeId: shift.employee_id ?? null,
          employeeName: shift.employee?.name ?? 'Unassigned',
          position: shift.position ?? null,
          startHour: hourOfDay(shift.start_time),
          endHour: hourOfDay(shift.end_time),
          lane: placed,
        });
      }

      const { hasGap, gapLabel } = detectGap(dayShifts);
      const unstaffed = dayShifts.length === 0;

      return { day, pills, collapsedCount, hasGap, gapLabel, unstaffed };
    });
  }, [shiftsByDay, weekDays]);

  return { shiftsByEmployee, coverageByDay, overviewDays };
}

function detectGap(dayShifts: readonly Shift[]): { hasGap: boolean; gapLabel: string | null } {
  if (dayShifts.length < 2) return { hasGap: false, gapLabel: null };
  const sorted = dayShifts.slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
  const earliest = new Date(sorted[0].start_time).getTime();
  const latest = Math.max(...sorted.map((s) => new Date(s.end_time).getTime()));

  // Walk the timeline in 30-minute chunks; flag the first >=60-min window with 0 coverage.
  const STEP_MS = 30 * 60 * 1000;
  let cursor = earliest;
  while (cursor < latest) {
    const chunkEnd = cursor + STEP_MS;
    const covered = sorted.some((s) => {
      const start = new Date(s.start_time).getTime();
      const end = new Date(s.end_time).getTime();
      return start < chunkEnd && end > cursor;
    });
    if (!covered) {
      // Extend gap window forward
      let gapEnd = chunkEnd;
      while (gapEnd < latest) {
        const next = gapEnd + STEP_MS;
        const nextCovered = sorted.some((s) => {
          const start = new Date(s.start_time).getTime();
          const end = new Date(s.end_time).getTime();
          return start < next && end > gapEnd;
        });
        if (nextCovered) break;
        gapEnd = next;
      }
      if (gapEnd - cursor >= 60 * 60 * 1000) {
        const gapDate = new Date(cursor);
        const hour = gapDate.getHours();
        const suffix = hour >= 12 ? 'p' : 'a';
        const display = ((hour + 11) % 12) + 1;
        return { hasGap: true, gapLabel: `Gap ${display}${suffix}` };
      }
      cursor = gapEnd;
    } else {
      cursor = chunkEnd;
    }
  }
  return { hasGap: false, gapLabel: null };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test -- tests/unit/usePlannerShiftsIndex.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePlannerShiftsIndex.ts tests/unit/usePlannerShiftsIndex.test.ts
git commit -m "feat(scheduling): add usePlannerShiftsIndex for planner derivations"
```

---

## Phase 4 — Coverage Strip (Feature A)

### Task 4.1: Write failing test for `CoverageStrip`

**Files:**
- Create: `tests/unit/CoverageStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { CoverageStrip } from '@/components/scheduling/ShiftPlanner/CoverageStrip';

const weekDays = [
  '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23',
  '2026-04-24', '2026-04-25', '2026-04-26',
];

describe('<CoverageStrip>', () => {
  it('renders one bar per day in weekDays', () => {
    const coverage = new Map<string, number[]>();
    for (const d of weekDays) coverage.set(d, new Array(17).fill(0));
    const { container } = render(<CoverageStrip weekDays={weekDays} coverageByDay={coverage} />);
    const columns = container.querySelectorAll('[data-coverage-day]');
    expect(columns).toHaveLength(7);
  });

  it('applies density class based on bucket value', () => {
    const coverage = new Map<string, number[]>();
    const row = new Array(17).fill(0);
    row[6] = 3;
    coverage.set('2026-04-20', row);
    for (let i = 1; i < weekDays.length; i++) coverage.set(weekDays[i], new Array(17).fill(0));
    const { container } = render(<CoverageStrip weekDays={weekDays} coverageByDay={coverage} />);
    const buckets = container.querySelectorAll('[data-density]');
    // First day's 7th bucket should be density=3
    const monday = container.querySelector('[data-coverage-day="2026-04-20"]')!;
    const mondayBuckets = monday.querySelectorAll('[data-density]');
    expect(mondayBuckets[6].getAttribute('data-density')).toBe('3');
    expect(buckets.length).toBeGreaterThan(0);
  });

  it('clamps headcounts ≥4 to density 4', () => {
    const coverage = new Map<string, number[]>();
    const row = new Array(17).fill(0);
    row[0] = 7;
    coverage.set('2026-04-20', row);
    for (let i = 1; i < weekDays.length; i++) coverage.set(weekDays[i], new Array(17).fill(0));
    const { container } = render(<CoverageStrip weekDays={weekDays} coverageByDay={coverage} />);
    const monday = container.querySelector('[data-coverage-day="2026-04-20"]')!;
    const first = monday.querySelector('[data-density]')!;
    expect(first.getAttribute('data-density')).toBe('4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/CoverageStrip.test.tsx`
Expected: FAIL — cannot find module

### Task 4.2: Implement `CoverageStrip`

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/CoverageStrip.tsx`

- [ ] **Step 1: Write the implementation**

```typescript
import { memo } from 'react';

import { cn } from '@/lib/utils';

import { COVERAGE_BUCKETS, COVERAGE_START_HOUR } from '@/hooks/usePlannerShiftsIndex';

interface CoverageStripProps {
  weekDays: readonly string[];
  coverageByDay: Map<string, number[]>;
}

function densityFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

const DENSITY_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-muted/30',
  1: 'bg-primary/20',
  2: 'bg-primary/40',
  3: 'bg-primary/60',
  4: 'bg-primary/80',
};

function hourLabel(bucket: number): string {
  const hour = COVERAGE_START_HOUR + bucket;
  const suffix = hour >= 12 ? 'p' : 'a';
  const display = ((hour + 11) % 12) + 1;
  return `${display}${suffix}`;
}

export const CoverageStrip = memo(function CoverageStrip({
  weekDays,
  coverageByDay,
}: Readonly<CoverageStripProps>) {
  return (
    <>
      <div
        className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-t border-border/40"
        aria-hidden="true"
      >
        Coverage
      </div>
      {weekDays.map((day) => {
        const buckets = coverageByDay.get(day) ?? new Array(COVERAGE_BUCKETS).fill(0);
        return (
          <div
            key={day}
            data-coverage-day={day}
            className="border-t border-l border-border/40 flex items-stretch h-6"
            role="img"
            aria-label={`Coverage for ${day}`}
          >
            {buckets.map((count, idx) => {
              const density = densityFor(count);
              return (
                <div
                  key={idx}
                  data-density={density}
                  title={`${hourLabel(idx)} · ${count} on shift`}
                  className={cn('flex-1 border-r border-border/20 last:border-r-0', DENSITY_CLASS[density])}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test -- tests/unit/CoverageStrip.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/CoverageStrip.tsx tests/unit/CoverageStrip.test.tsx
git commit -m "feat(scheduling): add CoverageStrip hour heatmap component"
```

### Task 4.3: Mount `CoverageStrip` in `TemplateGrid` header

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`

- [ ] **Step 1: Extend `TemplateGridProps` with `coverageSlot?: ReactNode`**

Replace the `TemplateGridProps` interface (lines 25-38) — add `coverageSlot`:
```typescript
import type { ReactNode } from 'react';
// ...existing imports
interface TemplateGridProps {
  weekDays: string[];
  templates: ShiftTemplate[];
  gridData: Map<string, Map<string, Shift[]>>;
  onRemoveShift: (shiftId: string) => void;
  onEditTemplate: (template: ShiftTemplate) => void;
  onDeleteTemplate: (templateId: string) => void;
  onAddTemplate: () => void;
  highlightCellId?: string | null;
  onMobileCellTap?: (templateId: string, day: string) => void;
  hasMobileSelection?: boolean;
  areaFilter?: string | null;
  /** Optional row rendered immediately under the day headers (e.g., coverage strip). */
  coverageSlot?: ReactNode;
}
```

- [ ] **Step 2: Render `coverageSlot` below the day headers**

Find the closing of the day-header map (after the `weekDays.map((day) => { ... })` block, before the "Template rows grouped by area" comment) and insert:

```typescript
{coverageSlot && (
  <>
    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1 border-t border-border/40">
      Cover
    </div>
    {coverageSlot}
  </>
)}
```

Note: the CoverageStrip renders its own 7 day cells as grid children (because the parent is a `grid-cols-[…_repeat(7,1fr)]`). The first `<div>` above fills the `[SHIFT]` column; the slot fills the 7 day columns.

Remove the inner `<div>` header from `CoverageStrip` to avoid duplication — update CoverageStrip to render ONLY the 7 day cells (no "Coverage" label), since the label lives in the TemplateGrid integration now.

- [ ] **Step 3: Update `CoverageStrip` to drop its own header**

Edit `src/components/scheduling/ShiftPlanner/CoverageStrip.tsx` — remove the first `<div>` ("Coverage" label) and the wrapping fragment if unneeded. Final render body:

```typescript
return (
  <>
    {weekDays.map((day) => {
      // ...existing day-cell render
    })}
  </>
);
```

Re-run the test: the test only counts `[data-coverage-day]` elements, so it still passes.

Run: `npm run test -- tests/unit/CoverageStrip.test.tsx`
Expected: PASS

- [ ] **Step 4: Pass `coverageSlot` from `ShiftPlannerTab`**

In `ShiftPlannerTab.tsx`, around the TemplateGrid call (line 481 area), compute and pass the slot:

```typescript
// Near other useMemo'd derivations:
const { shiftsByEmployee, coverageByDay, overviewDays } = usePlannerShiftsIndex(shifts, weekDays);

// Note: applying areaFilter to coverage/overview is deferred (see spec "Out of Scope").
// v1 shows ALL shifts in the coverage + overview regardless of filter.

// Then in the grid render:
<TemplateGrid
  weekDays={weekDays}
  templates={templates}
  gridData={templateGridData}
  onRemoveShift={deleteShift}
  onEditTemplate={handleEditTemplate}
  onDeleteTemplate={deleteTemplate}
  onAddTemplate={handleAddTemplate}
  highlightCellId={highlightCellId}
  onMobileCellTap={isMobile ? handleMobileCellTap : undefined}
  hasMobileSelection={isMobile && !!selectedMobileEmployee}
  areaFilter={areaFilter}
  coverageSlot={!isMobile ? <CoverageStrip weekDays={weekDays} coverageByDay={coverageByDay} /> : undefined}
/>
```

Add imports at the top:
```typescript
import { CoverageStrip } from './CoverageStrip';
import { usePlannerShiftsIndex } from '@/hooks/usePlannerShiftsIndex';
```

- [ ] **Step 5: Manual check in dev**

Run: `npm run dev` in a separate terminal. Navigate to `/scheduling?week=2026-04-20`, click the Planner tab.
Expected: a thin horizontal strip under the day headers with varying density. On mobile viewport (≤768px), the strip is absent.

- [ ] **Step 6: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateGrid.tsx src/components/scheduling/ShiftPlanner/CoverageStrip.tsx src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat(scheduling): wire CoverageStrip under Planner day headers"
```

---

## Phase 5 — Schedule Overview Panel (Feature B)

### Task 5.1: Write failing tests for `OverviewDayCard`

**Files:**
- Create: `tests/unit/OverviewDayCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OverviewDayCard } from '@/components/scheduling/ShiftPlanner/OverviewDayCard';

const baseDay = {
  day: '2026-04-20',
  pills: [],
  collapsedCount: 0,
  hasGap: false,
  gapLabel: null,
  unstaffed: true,
};

describe('<OverviewDayCard>', () => {
  it('renders an "unstaffed" chip when there are no shifts', () => {
    render(<OverviewDayCard data={baseDay} />);
    expect(screen.getByText(/unstaffed/i)).toBeInTheDocument();
  });

  it('renders one pill per shift up to 3 lanes', () => {
    const data = {
      ...baseDay,
      unstaffed: false,
      pills: [
        { shiftId: '1', employeeId: 'e1', employeeName: 'Alice', position: 'server', startHour: 9, endHour: 13, lane: 0 },
        { shiftId: '2', employeeId: 'e2', employeeName: 'Bob', position: 'cook', startHour: 10, endHour: 16, lane: 1 },
        { shiftId: '3', employeeId: 'e3', employeeName: 'Cal', position: 'dish', startHour: 14, endHour: 18, lane: 0 },
      ],
    };
    const { container } = render(<OverviewDayCard data={data} />);
    const pills = container.querySelectorAll('[data-shift-pill]');
    expect(pills).toHaveLength(3);
  });

  it('renders "+N more" chip when shifts were collapsed', () => {
    const data = {
      ...baseDay,
      unstaffed: false,
      collapsedCount: 2,
      pills: [
        { shiftId: '1', employeeId: 'e1', employeeName: 'Alice', position: 'server', startHour: 9, endHour: 13, lane: 0 },
      ],
    };
    render(<OverviewDayCard data={data} />);
    expect(screen.getByText(/\+2 more/i)).toBeInTheDocument();
  });

  it('renders gap chip when hasGap is true', () => {
    const data = {
      ...baseDay,
      unstaffed: false,
      pills: [
        { shiftId: '1', employeeId: 'e1', employeeName: 'Alice', position: 'server', startHour: 9, endHour: 11, lane: 0 },
      ],
      hasGap: true,
      gapLabel: 'Gap 3p',
    };
    render(<OverviewDayCard data={data} />);
    expect(screen.getByText(/gap 3p/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/OverviewDayCard.test.tsx`
Expected: FAIL — cannot find module

### Task 5.2: Implement `OverviewDayCard`

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/OverviewDayCard.tsx`

- [ ] **Step 1: Write the implementation**

```typescript
import { memo } from 'react';

import { cn } from '@/lib/utils';

import { COVERAGE_START_HOUR, COVERAGE_BUCKETS } from '@/hooks/usePlannerShiftsIndex';
import type { OverviewDay, OverviewPill } from '@/hooks/usePlannerShiftsIndex';

interface OverviewDayCardProps {
  data: OverviewDay;
  dayLabel?: string;
  variant?: 'desktop' | 'mobile';
  coverage?: number[];
}

const ROLE_BG: Record<string, string> = {
  server: 'bg-sky-500/70',
  cook: 'bg-amber-500/70',
  dish: 'bg-emerald-500/70',
  closer: 'bg-violet-500/70',
};

function pillColor(position: string | null): string {
  if (!position) return 'bg-primary/60';
  const key = position.toLowerCase();
  return ROLE_BG[key] ?? 'bg-primary/60';
}

function pillStyle(pill: OverviewPill): React.CSSProperties {
  const start = Math.max(0, pill.startHour - COVERAGE_START_HOUR);
  const end = Math.min(COVERAGE_BUCKETS, pill.endHour - COVERAGE_START_HOUR);
  const left = (start / COVERAGE_BUCKETS) * 100;
  const width = Math.max(2, ((end - start) / COVERAGE_BUCKETS) * 100);
  return { left: `${left}%`, width: `${width}%` };
}

export const OverviewDayCard = memo(function OverviewDayCard({
  data,
  dayLabel,
  variant = 'desktop',
  coverage,
}: Readonly<OverviewDayCardProps>) {
  const { pills, collapsedCount, hasGap, gapLabel, unstaffed } = data;
  const laneHeight = variant === 'mobile' ? 10 : 8;

  return (
    <div
      className={cn(
        'rounded-xl border border-border/40 bg-background p-3 flex flex-col gap-2',
        variant === 'mobile' ? 'w-full' : 'min-w-[120px]',
      )}
      data-overview-day={data.day}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-foreground">
          {dayLabel ?? data.day}
        </span>
        <div className="flex gap-1">
          {unstaffed && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive">
              Unstaffed
            </span>
          )}
          {!unstaffed && hasGap && gapLabel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700">
              {gapLabel}
            </span>
          )}
          {collapsedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
              +{collapsedCount} more
            </span>
          )}
        </div>
      </div>

      {!unstaffed && (
        <div
          className="relative w-full rounded-md bg-muted/40"
          style={{ height: laneHeight * 3 + 6 }}
          aria-hidden="true"
        >
          {pills.map((pill) => (
            <div
              key={pill.shiftId}
              data-shift-pill={pill.shiftId}
              title={`${pill.employeeName} · ${pill.position ?? ''}`}
              className={cn('absolute rounded-sm', pillColor(pill.position))}
              style={{
                ...pillStyle(pill),
                top: pill.lane * laneHeight + 3,
                height: laneHeight - 2,
              }}
            />
          ))}
        </div>
      )}

      {variant === 'mobile' && coverage && (
        <div className="flex h-3 rounded-sm overflow-hidden">
          {coverage.map((count, idx) => {
            const density = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4;
            const classMap = ['bg-muted/40', 'bg-primary/20', 'bg-primary/40', 'bg-primary/60', 'bg-primary/80'] as const;
            return <div key={idx} className={cn('flex-1', classMap[density])} />;
          })}
        </div>
      )}
    </div>
  );
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test -- tests/unit/OverviewDayCard.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/OverviewDayCard.tsx tests/unit/OverviewDayCard.test.tsx
git commit -m "feat(scheduling): add OverviewDayCard mini-Gantt card"
```

### Task 5.3: Implement `ScheduleOverviewPanel`

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/ScheduleOverviewPanel.tsx`

- [ ] **Step 1: Write the implementation**

```typescript
import { memo, useState } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

import { OverviewDayCard } from './OverviewDayCard';
import type { OverviewDay } from '@/hooks/usePlannerShiftsIndex';

interface ScheduleOverviewPanelProps {
  overviewDays: OverviewDay[];
  coverageByDay: Map<string, number[]>;
  isMobile: boolean;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shortLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAY_LABELS[date.getDay()]} ${d}`;
}

export const ScheduleOverviewPanel = memo(function ScheduleOverviewPanel({
  overviewDays,
  coverageByDay,
  isMobile,
}: Readonly<ScheduleOverviewPanelProps>) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section
      aria-label="Weekly schedule overview"
      className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-[13px] font-semibold text-foreground">Schedule overview</span>
        </span>
        <span className="text-[12px] text-muted-foreground">
          {overviewDays.filter((d) => !d.unstaffed).length}/7 days staffed
        </span>
      </button>

      {expanded && (
        <div
          className={cn(
            'p-3',
            isMobile ? 'flex flex-col gap-2' : 'grid grid-cols-7 gap-2',
          )}
        >
          {overviewDays.map((d) => (
            <OverviewDayCard
              key={d.day}
              data={d}
              dayLabel={shortLabel(d.day)}
              variant={isMobile ? 'mobile' : 'desktop'}
              coverage={isMobile ? coverageByDay.get(d.day) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
});
```

- [ ] **Step 2: Mount in `ShiftPlannerTab`**

In `ShiftPlannerTab.tsx`, add import:
```typescript
import { ScheduleOverviewPanel } from './ScheduleOverviewPanel';
```

Then find the `<StaffingOverlay>` block (search for `<StaffingOverlay`) and insert immediately AFTER it, BEFORE the `<AreaFilterPills>`:

```typescript
<ScheduleOverviewPanel
  overviewDays={overviewDays}
  coverageByDay={coverageByDay}
  isMobile={isMobile}
/>
```

- [ ] **Step 3: Manual dev check**

Run: `npm run dev` → `/scheduling`. Click Planner. Panel should be visible above the grid, expanded by default, 7 columns on desktop, stacked on mobile.

- [ ] **Step 4: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ScheduleOverviewPanel.tsx src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat(scheduling): add Schedule Overview panel above Planner grid"
```

---

## Phase 6 — Rich Employee Cards with Mini-Week (Feature 1)

### Task 6.1: Write failing tests for `EmployeeMiniWeek`

**Files:**
- Create: `tests/unit/EmployeeMiniWeek.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { EmployeeMiniWeek } from '@/components/scheduling/ShiftPlanner/EmployeeMiniWeek';

import type { Shift } from '@/types/scheduling';

function makeShift(partial: Partial<Shift>): Shift {
  return {
    id: 's' + Math.random().toString(36).slice(2, 8),
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-04-20T13:00:00',
    end_time: '2026-04-20T21:00:00',
    break_duration: 0,
    position: 'server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

const weekDays = [
  '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23',
  '2026-04-24', '2026-04-25', '2026-04-26',
];

describe('<EmployeeMiniWeek>', () => {
  it('renders 7 day columns', () => {
    const { container } = render(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={[]} />,
    );
    expect(container.querySelectorAll('[data-mini-week-day]')).toHaveLength(7);
  });

  it('renders a shift bar only inside the day matching the shift start', () => {
    const shifts = [makeShift({ start_time: '2026-04-21T09:00:00', end_time: '2026-04-21T17:00:00' })];
    const { container } = render(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={shifts} />,
    );
    const tuesday = container.querySelector('[data-mini-week-day="2026-04-21"]')!;
    expect(tuesday.querySelectorAll('[data-mini-bar]')).toHaveLength(1);
    const monday = container.querySelector('[data-mini-week-day="2026-04-20"]')!;
    expect(monday.querySelectorAll('[data-mini-bar]')).toHaveLength(0);
  });

  it('renders multiple bars when employee has multiple shifts on the same day', () => {
    const shifts = [
      makeShift({ id: 'a', start_time: '2026-04-20T07:00:00', end_time: '2026-04-20T11:00:00' }),
      makeShift({ id: 'b', start_time: '2026-04-20T17:00:00', end_time: '2026-04-20T22:00:00' }),
    ];
    const { container } = render(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={shifts} />,
    );
    const monday = container.querySelector('[data-mini-week-day="2026-04-20"]')!;
    expect(monday.querySelectorAll('[data-mini-bar]')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/EmployeeMiniWeek.test.tsx`
Expected: FAIL — cannot find module

### Task 6.2: Implement `EmployeeMiniWeek`

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx`

- [ ] **Step 1: Write the implementation**

```typescript
import { memo, useMemo } from 'react';

import { cn } from '@/lib/utils';

import { COVERAGE_START_HOUR, COVERAGE_BUCKETS } from '@/hooks/usePlannerShiftsIndex';
import type { Shift } from '@/types/scheduling';

interface EmployeeMiniWeekProps {
  weekDays: readonly string[];
  employeeShifts: readonly Shift[];
  size?: 'sm' | 'md';
}

const ROLE_BG: Record<string, string> = {
  server: 'bg-sky-500/70',
  cook: 'bg-amber-500/70',
  dish: 'bg-emerald-500/70',
  closer: 'bg-violet-500/70',
};

function barColor(position: string | null): string {
  if (!position) return 'bg-primary/60';
  return ROLE_BG[position.toLowerCase()] ?? 'bg-primary/60';
}

function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

function hourOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}

function isToday(day: string): boolean {
  const now = new Date();
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}` === day;
}

export const EmployeeMiniWeek = memo(function EmployeeMiniWeek({
  weekDays,
  employeeShifts,
  size = 'sm',
}: Readonly<EmployeeMiniWeekProps>) {
  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of employeeShifts) {
      if (shift.status === 'cancelled') continue;
      const key = isoDay(shift.start_time);
      const bucket = map.get(key) ?? [];
      bucket.push(shift);
      map.set(key, bucket);
    }
    return map;
  }, [employeeShifts]);

  const trackHeight = size === 'md' ? 32 : 28;

  return (
    <div className="grid grid-cols-7 gap-0.5 mt-1.5">
      {weekDays.map((day) => {
        const dayShifts = shiftsByDay.get(day) ?? [];
        const off = dayShifts.length === 0;
        return (
          <div
            key={day}
            data-mini-week-day={day}
            className={cn(
              'relative rounded-sm overflow-hidden border',
              off ? 'bg-muted/30 border-border/20' : 'bg-muted/50 border-border/30',
              isToday(day) && 'ring-1 ring-primary/40',
            )}
            style={{ height: trackHeight }}
            aria-hidden="true"
          >
            {dayShifts.map((shift) => {
              const startHour = hourOfDay(shift.start_time);
              const endHour = hourOfDay(shift.end_time);
              const startPct = Math.max(0, ((startHour - COVERAGE_START_HOUR) / COVERAGE_BUCKETS) * 100);
              const endPct = Math.min(100, ((endHour - COVERAGE_START_HOUR) / COVERAGE_BUCKETS) * 100);
              const height = Math.max(4, endPct - startPct);
              return (
                <div
                  key={shift.id}
                  data-mini-bar={shift.id}
                  className={cn('absolute left-0.5 right-0.5 rounded-[2px]', barColor(shift.position))}
                  style={{ top: `${startPct}%`, height: `${height}%` }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test -- tests/unit/EmployeeMiniWeek.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx tests/unit/EmployeeMiniWeek.test.tsx
git commit -m "feat(scheduling): add EmployeeMiniWeek 7-day per-employee timeline"
```

### Task 6.3: Render `EmployeeMiniWeek` inside `DraggableEmployee`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx`

- [ ] **Step 1: Extend `DraggableEmployeeProps` and the card body**

Add to the `DraggableEmployeeProps` interface (line 69):
```typescript
interface DraggableEmployeeProps {
  employee: Employee;
  shiftCount: number;
  hours: number;
  onSelect?: (employee: { id: string; name: string }) => void;
  weekDays: readonly string[];
  employeeShifts: readonly Shift[];
  onPick?: (employeeId: string | null) => void;
}
```

Inside `DraggableEmployee`'s returned `<div>` (after the position line, before the closing `</div>`), insert:

```typescript
<EmployeeMiniWeek weekDays={weekDays} employeeShifts={employeeShifts} />
```

Add `onMouseEnter`/`onMouseLeave` to the card root:
```typescript
<div
  ref={setNodeRef}
  style={style}
  {...(onSelect ? {} : { ...listeners, ...attributes })}
  onClick={onSelect ? () => onSelect({ id: employee.id, name: employee.name }) : undefined}
  onMouseEnter={onPick ? () => onPick(employee.id) : undefined}
  onMouseLeave={onPick ? () => onPick(null) : undefined}
  className={...}
>
```

Add import at the top of the file:
```typescript
import { EmployeeMiniWeek } from './EmployeeMiniWeek';
```

- [ ] **Step 2: Update memo comparator**

Extend the comparator at the bottom of `DraggableEmployee`:
```typescript
(prev, next) =>
  prev.employee.id === next.employee.id &&
  prev.employee.name === next.employee.name &&
  prev.employee.position === next.employee.position &&
  prev.shiftCount === next.shiftCount &&
  prev.hours === next.hours &&
  prev.onSelect === next.onSelect &&
  prev.onPick === next.onPick &&
  prev.weekDays === next.weekDays &&
  prev.employeeShifts === next.employeeShifts,
```

- [ ] **Step 3: Wire `EmployeeSidebarProps` with `weekDays`, `shiftsByEmployee`, `onEmployeePick`**

Update the interface (line 55):
```typescript
export interface EmployeeSidebarProps {
  employees: Employee[];
  shifts: Shift[];
  weekDays: readonly string[];
  shiftsByEmployee: Map<string, Shift[]>;
  className?: string;
  onEmployeeSelect?: (employee: { id: string; name: string }) => void;
  onEmployeePick?: (employeeId: string | null) => void;
  plannerAreaFilter?: string | null;
}
```

Forward to the map at line 266:
```typescript
{filtered.map((employee) => (
  <DraggableEmployee
    key={employee.id}
    employee={employee}
    shiftCount={shiftCounts.get(employee.id) ?? 0}
    hours={hoursPerEmployee.get(employee.id) ?? 0}
    onSelect={onEmployeeSelect}
    onPick={onEmployeePick}
    weekDays={weekDays}
    employeeShifts={shiftsByEmployee.get(employee.id) ?? EMPTY_SHIFTS}
  />
))}
```

Add a module-level constant above `EmployeeSidebar` so the empty-array reference is stable:
```typescript
const EMPTY_SHIFTS: readonly Shift[] = [];
```

- [ ] **Step 4: Pass new props from `ShiftPlannerTab`**

In `ShiftPlannerTab.tsx`, update both `<EmployeeSidebar ...>` mounts (desktop and mobile) to:
```typescript
<EmployeeSidebar
  employees={employees}
  shifts={shifts}
  weekDays={weekDays}
  shiftsByEmployee={shiftsByEmployee}
  plannerAreaFilter={areaFilter}
  onEmployeePick={setPickedEmployeeId}
/>
```
(Mobile mount also keeps `className="w-full border-l-0"` and `onEmployeeSelect={handleMobileEmployeeSelect}`.)

Add the state (near other useState hooks at the top of the component):
```typescript
const [pickedEmployeeId, setPickedEmployeeId] = useState<string | null>(null);
```

- [ ] **Step 5: Run typecheck + tests**

Run: `npm run typecheck && npm run test -- tests/unit/EmployeeMiniWeek.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat(scheduling): render EmployeeMiniWeek inside sidebar cards and wire pick handler"
```

---

## Phase 7 — Allocation Overlay (Feature 2)

### Task 7.1: Extend `ShiftCell` with `allocationStatus`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`

- [ ] **Step 1: Add prop to interface and render annotation**

Update `ShiftCellProps` (line 12):
```typescript
import type { AllocationStatus } from '@/lib/shiftAllocation';

interface ShiftCellProps {
  templateId: string;
  day: string;
  isActiveDay: boolean;
  shifts: Shift[];
  capacity: number;
  onRemoveShift: (shiftId: string) => void;
  isHighlighted?: boolean;
  onMobileTap?: (templateId: string, day: string) => void;
  hasMobileSelection?: boolean;
  allocationStatus?: AllocationStatus;
  pickedEmployeeName?: string;
}
```

Inside the component (replace the existing returned `<div>` for active cells with):
```typescript
const overlayClass = cn(
  allocationStatus === 'highlight' && 'outline outline-2 outline-primary bg-primary/5',
  allocationStatus === 'conflict' && 'outline outline-2 outline-destructive bg-destructive/10 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,hsl(var(--destructive)/0.15)_6px,hsl(var(--destructive)/0.15)_12px)]',
  allocationStatus === 'available' && 'bg-primary/5',
);

return (
  <div
    ref={setNodeRef}
    onClick={hasMobileSelection && onMobileTap ? () => onMobileTap(templateId, day) : undefined}
    data-allocation-status={allocationStatus ?? 'none'}
    className={cn(
      'min-h-[64px] p-1.5 space-y-1 transition-colors duration-200 relative',
      'border-l-2 border-primary/40',
      isOver && 'bg-foreground/5 ring-1 ring-foreground/20 rounded',
      isHighlighted && 'bg-green-500/10',
      hasMobileSelection && 'bg-primary/5 ring-1 ring-primary/30 rounded cursor-pointer',
      overlayClass,
    )}
  >
    {allocationStatus === 'highlight' && pickedEmployeeName && (
      <div className="absolute top-0 right-0 m-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary text-primary-foreground pointer-events-none">
        {pickedEmployeeName}
      </div>
    )}
    {allocationStatus === 'conflict' && (
      <div className="absolute top-0 right-0 m-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground pointer-events-none">
        Conflicts
      </div>
    )}
    {shifts.map((shift) => (
      <EmployeeChip
        key={shift.id}
        shiftId={shift.id}
        employeeName={shift.employee?.name ?? 'Unassigned'}
        position={shift.position}
        source={shift.source}
        onRemove={onRemoveShift}
      />
    ))}
    {capacity > 1 && (() => {
      const status = classifyCapacity(capacity, shifts.length);
      return (
        <div
          className={cn(
            'text-[10px] font-medium px-1.5 py-0.5 rounded text-center',
            status === 'full'
              ? 'text-emerald-600 bg-emerald-500/10'
              : status === 'partial'
                ? 'text-amber-600 bg-amber-500/10'
                : 'text-red-500 bg-red-500/10',
          )}
        >
          {shifts.length}/{capacity}
        </div>
      );
    })()}
  </div>
);
```

- [ ] **Step 2: Update memo comparator**

Extend:
```typescript
(prev, next) =>
  prev.templateId === next.templateId &&
  prev.day === next.day &&
  prev.isActiveDay === next.isActiveDay &&
  prev.shifts === next.shifts &&
  prev.capacity === next.capacity &&
  prev.onRemoveShift === next.onRemoveShift &&
  prev.isHighlighted === next.isHighlighted &&
  prev.hasMobileSelection === next.hasMobileSelection &&
  prev.onMobileTap === next.onMobileTap &&
  prev.allocationStatus === next.allocationStatus &&
  prev.pickedEmployeeName === next.pickedEmployeeName,
```

- [ ] **Step 3: Run existing tests (sanity)**

Run: `npm run test -- tests/unit/shiftCellDayIndicators.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftCell.tsx
git commit -m "feat(scheduling): render allocation overlay classes on ShiftCell"
```

### Task 7.2: Extend `TemplateGrid` with `allocationStatuses` prop

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`

- [ ] **Step 1: Add props and thread to `ShiftCell`**

Update `TemplateGridProps`:
```typescript
import type { AllocationStatus } from '@/lib/shiftAllocation';

interface TemplateGridProps {
  // ...existing fields
  allocationStatuses?: Map<string, AllocationStatus>;
  pickedEmployeeName?: string;
}
```

Update the component signature to destructure the new props, then in the `ShiftCell` render inside the day map (the one with `templateId={template.id}`), pass:

```typescript
<ShiftCell
  templateId={template.id}
  day={day}
  isActiveDay={isActiveDay}
  shifts={shifts}
  capacity={template.capacity ?? 1}
  onRemoveShift={onRemoveShift}
  isHighlighted={highlightCellId === `${template.id}:${day}`}
  onMobileTap={onMobileCellTap}
  hasMobileSelection={hasMobileSelection}
  allocationStatus={allocationStatuses?.get(`${template.id}:${day}`) ?? 'none'}
  pickedEmployeeName={pickedEmployeeName}
/>
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateGrid.tsx
git commit -m "feat(scheduling): thread allocationStatuses through TemplateGrid"
```

### Task 7.3: Compute statuses in `ShiftPlannerTab`, wire drag/tap/hover

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

- [ ] **Step 1: Compute statuses when `pickedEmployeeId` is set**

Near other `useMemo` blocks (e.g. after `templateGridData`), add:

```typescript
import { computeAllocationStatuses, type AllocationStatus } from '@/lib/shiftAllocation';

const allocationStatuses = useMemo<Map<string, AllocationStatus> | undefined>(() => {
  if (!pickedEmployeeId) return undefined;
  const employeeShifts = shiftsByEmployee.get(pickedEmployeeId) ?? [];
  return computeAllocationStatuses(employeeShifts, templates, weekDays);
}, [pickedEmployeeId, shiftsByEmployee, templates, weekDays]);

const pickedEmployeeName = useMemo(() => {
  if (!pickedEmployeeId) return undefined;
  return employees.find((e) => e.id === pickedEmployeeId)?.name;
}, [pickedEmployeeId, employees]);
```

- [ ] **Step 2: Pass into `TemplateGrid`**

Inside the existing `<TemplateGrid ... />` call, add:
```typescript
allocationStatuses={allocationStatuses}
pickedEmployeeName={pickedEmployeeName}
```

- [ ] **Step 3: Drag start sets picked employee; drag end clears**

Find the existing `handleDragStart(event: DragStartEvent)` (already set in the component) and add:
```typescript
const handleDragStart = (event: DragStartEvent) => {
  const emp = event.active.data.current?.employee as { id: string; name: string } | undefined;
  if (emp) {
    setActiveDragEmployee(emp);
    setPickedEmployeeId(emp.id);
  }
};
```

Similarly extend `handleDragEnd` and `handleDragCancel` to `setPickedEmployeeId(null)`.

- [ ] **Step 4: Mobile tap-select sets picked employee**

Find `handleMobileEmployeeSelect` and extend:
```typescript
const handleMobileEmployeeSelect = useCallback((e: { id: string; name: string }) => {
  setSelectedMobileEmployee(e);
  setPickedEmployeeId(e.id);
  setMobileSidebarOpen(false);
}, []);
```

Also `clearMobileSelection` should call `setPickedEmployeeId(null)`.

- [ ] **Step 5: Manual dev check**

Run: `npm run dev` → /scheduling → Planner. Hover an employee card (desktop). Grid cells for that employee's existing shifts should highlight purple; conflicting cells should stripe red; other active cells should light subtle green.

- [ ] **Step 6: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat(scheduling): wire allocation overlay via pickedEmployeeId state"
```

---

## Phase 8 — E2E, Verification, Final Polish

### Task 8.1: E2E — week sync across tabs

**Files:**
- Create: `tests/e2e/planner-week-sync.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Planner shared week state', () => {
  test('selected week persists across Schedule and Planner tabs', async ({ page }) => {
    const user = generateTestUser('week-sync');
    await signUpAndCreateRestaurant(page, user);
    await page.goto('/scheduling');

    // Read current week label on Schedule tab
    await expect(page.getByRole('tab', { name: /schedule/i })).toBeVisible();
    const nextWeekBtn = page.getByRole('button', { name: /next week/i });
    await nextWeekBtn.click();

    // URL should have ?week=YYYY-MM-DD
    await page.waitForURL(/\?week=\d{4}-\d{2}-\d{2}/);
    const schedUrl = page.url();
    const weekParam = new URL(schedUrl).searchParams.get('week');
    expect(weekParam).toMatch(/\d{4}-\d{2}-\d{2}/);

    // Switch to Planner tab
    await page.getByRole('tab', { name: /planner/i }).click();

    // URL should still carry the same week param
    const plannerUrl = page.url();
    expect(new URL(plannerUrl).searchParams.get('week')).toBe(weekParam);
  });

  test('reloading the Scheduling page preserves the week param', async ({ page }) => {
    const user = generateTestUser('week-reload');
    await signUpAndCreateRestaurant(page, user);
    await page.goto('/scheduling?week=2026-05-04');
    await page.reload();
    expect(new URL(page.url()).searchParams.get('week')).toBe('2026-05-04');
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `npm run test:e2e -- planner-week-sync.spec.ts`
Expected: PASS (2 tests)

If a test fails because the "Next week" button label differs (e.g., uses an icon `aria-label`), inspect the actual label and update the selector. Check `PlannerHeader.tsx` for the authoritative aria-label.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/planner-week-sync.spec.ts
git commit -m "test(scheduling): e2e coverage for shared week state across tabs"
```

### Task 8.2: E2E — allocation overlay renders on hover

**Files:**
- Create: `tests/e2e/planner-allocation-overlay.spec.ts`

- [ ] **Step 1: Write the test**

We test the simpler "available" path — hovering an employee who has no existing shifts for the week. The template cells for active days should pick up the `.bg-primary\\/5` class (the available state). This avoids the complexity of seeding a shift via helpers; the other states are covered by unit tests on `computeAllocationStatus`.

```typescript
import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Planner allocation overlay', () => {
  test('hovering an employee tints active template cells (available state)', async ({ page }) => {
    const user = generateTestUser('alloc-overlay');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());

    await page.evaluate(
      ({ restId }) => (window as any).__insertEmployees(
        [
          { name: 'Jose Delgado', position: 'server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId,
      ),
      { restId: restaurantId },
    );

    await page.goto('/scheduling');
    await page.getByRole('tab', { name: /planner/i }).click();
    await expect(page.getByText('Jose Delgado')).toBeVisible({ timeout: 10000 });

    // Create a simple weekday template so the grid has at least one active cell.
    await page.getByRole('button', { name: /add shift template/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator('#template-name').fill('Morning');
    await dialog.locator('#template-start').fill('09:00');
    await dialog.locator('#template-end').fill('17:00');
    await dialog.getByRole('button', { name: /save|create/i }).click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // Hover the employee card
    await page.getByText('Jose Delgado').hover();

    // At least one cell should carry data-allocation-status="available"
    await expect(
      page.locator('[data-allocation-status="available"]').first(),
    ).toBeVisible({ timeout: 3000 });
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `npm run test:e2e -- planner-allocation-overlay.spec.ts`
Expected: PASS. The test relies on the `data-allocation-status` attribute rendered by `ShiftCell` (Task 7.1).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/planner-allocation-overlay.spec.ts
git commit -m "test(scheduling): e2e coverage for planner allocation overlay"
```

### Task 8.3: E2E — mobile overview panel stays accessible

**Files:**
- Create: `tests/e2e/planner-mobile-overview.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
import { test, expect, devices } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

test.use({ ...devices['iPhone 13'] });

test.describe('Planner mobile layout', () => {
  test('overview panel renders stacked with visible day cards', async ({ page }) => {
    const user = generateTestUser('mobile-overview');
    await signUpAndCreateRestaurant(page, user);
    await page.goto('/scheduling');
    await page.getByRole('tab', { name: /planner/i }).click();

    // Overview panel expanded by default
    await expect(page.getByRole('region', { name: /weekly schedule overview/i })).toBeVisible();

    // 7 day cards are rendered
    const dayCards = page.locator('[data-overview-day]');
    await expect(dayCards).toHaveCount(7);

    // Collapsing works
    await page.getByRole('button', { expanded: true, name: /schedule overview/i }).click();
    await expect(dayCards).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:e2e -- planner-mobile-overview.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/planner-mobile-overview.spec.ts
git commit -m "test(scheduling): e2e coverage for planner mobile overview panel"
```

### Task 8.4: Full verification loop

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS. Fix any unused-import warnings inline (e.g., remove `formatLocalTime` from `shiftAllocation.ts` if unused).

- [ ] **Step 3: Unit tests**

Run: `npm run test -- tests/unit/useSharedWeek.test.ts tests/unit/shiftAllocation.test.ts tests/unit/usePlannerShiftsIndex.test.ts tests/unit/CoverageStrip.test.tsx tests/unit/OverviewDayCard.test.tsx tests/unit/EmployeeMiniWeek.test.tsx`
Expected: All PASS.

- [ ] **Step 4: Full unit suite (regressions)**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 6: Manual mobile viewport check**

Run: `npm run dev`. In browser devtools, switch to an iPhone 14 viewport (390×844). Navigate to `/scheduling` → Planner. Verify:
- Overview panel is expanded, stacked vertically, each day card has a thin coverage strip at the bottom
- Coverage strip under day headers is ABSENT on mobile (handled by the day cards)
- Tapping "Team" → tapping an employee → grid cells show overlay states
- Mini-week is visible inside each employee card in the drawer

- [ ] **Step 7: No commit needed here — this is verification only**

---

## Done

After the final verification passes, the plan is complete. The development-workflow skill will take over for PR creation, CodeRabbit review, and CI loop.
