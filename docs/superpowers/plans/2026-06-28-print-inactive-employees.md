# Print Schedule Inactive-Employee Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the print/export schedule show exactly the employees the on-screen grid shows — active employees plus inactive employees who still have a non-cancelled shift — and strip cancelled shifts from printed output.

**Architecture:** Extract the grid's two pure visibility helpers (`buildActiveShiftEmployeeIds`, `filterEmployeesForScheduleView`) out of `src/pages/Scheduling.tsx` into a new `src/lib/scheduleVisibility.ts`, re-export them from `Scheduling.tsx` for backward compatibility, add a new `selectVisibleRosterInputs(shifts, employees)` helper there, and apply it as a single chokepoint at the top of `ScheduleExportDialog` so the checkbox list, preview, and both PDF generators all consume the visibility-filtered data.

**Tech Stack:** React 18 + TypeScript, Vitest, date-fns.

**Spec:** `docs/superpowers/specs/2026-06-28-print-inactive-employees-design.md`

---

## File Structure

- **Create** `src/lib/scheduleVisibility.ts` — owns the schedule visibility rule: `buildActiveShiftEmployeeIds`, `filterEmployeesForScheduleView`, and the new `selectVisibleRosterInputs`.
- **Create** `tests/unit/scheduleVisibility.test.ts` — unit tests for `selectVisibleRosterInputs` + grid-parity assertion, importing directly from `@/lib/scheduleVisibility`.
- **Modify** `src/pages/Scheduling.tsx` — remove the two helper definitions; import them from the new lib and re-export them (so `@/pages/Scheduling` consumers/tests keep working).
- **Modify** `src/components/scheduling/ScheduleExportDialog.tsx` — apply `selectVisibleRosterInputs` at the prop boundary; route every downstream consumer through the filtered data.
- **Unchanged** `src/utils/scheduleExport.ts` — the generators receive pre-filtered arrays; no signature change.

---

## Task 1: Create `scheduleVisibility.ts` with the moved helpers

**Files:**
- Create: `src/lib/scheduleVisibility.ts`
- Reference (source of truth to copy verbatim): `src/pages/Scheduling.tsx:131-161`

- [ ] **Step 1: Create the lib file with the two moved helpers (no behavior change yet)**

Create `src/lib/scheduleVisibility.ts`:

```typescript
import type { Employee } from '@/types/scheduling';

/** Build set of employee IDs who have at least one non-cancelled shift.
 *  Cancelled shifts should not keep inactive employees visible in the grid. */
export function buildActiveShiftEmployeeIds(
  shifts: { employee_id: string; status: string }[],
): Set<string> {
  return new Set(
    shifts.filter(s => s.status !== 'cancelled').map(s => s.employee_id)
  );
}

/** Filter employees for the weekly schedule grid:
 *  - Active employees always shown (so managers can schedule them)
 *  - Inactive employees shown only if they have shifts this week */
export function filterEmployeesForScheduleView(
  allEmployees: Employee[],
  shiftEmployeeIds: Set<string>,
  positionFilter: string | null,
  areaFilter: string | null,
): Employee[] {
  const filtered = allEmployees.filter(emp =>
    emp.is_active || shiftEmployeeIds.has(emp.id)
  );
  let result = filtered;
  if (areaFilter && areaFilter !== 'all') {
    result = result.filter(emp => emp.area === areaFilter);
  }
  if (positionFilter && positionFilter !== 'all') {
    result = result.filter(emp => emp.position === positionFilter);
  }
  return result;
}
```

- [ ] **Step 2: Typecheck the new file compiles**

Run: `npm run typecheck`
Expected: PASS (no errors). The new file is not yet imported anywhere, but it must compile.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduleVisibility.ts
git commit -m "refactor(scheduling): extract grid visibility helpers to scheduleVisibility lib"
```

---

## Task 2: Re-point `Scheduling.tsx` at the lib (re-export for back-compat)

**Files:**
- Modify: `src/pages/Scheduling.tsx:131-161` (delete the two function definitions)
- Modify: `src/pages/Scheduling.tsx` import block (add an import + re-export)

- [ ] **Step 1: Delete the two helper definitions from `Scheduling.tsx`**

Remove the entire block at `src/pages/Scheduling.tsx:131-161` — i.e. the `buildActiveShiftEmployeeIds` function (with its doc comment starting `/** Build set of employee IDs ...`) and the `filterEmployeesForScheduleView` function (with its doc comment starting `/** Filter employees for the weekly schedule grid:`). Leave `getShiftStatusClass` (lines 118-128) in place.

- [ ] **Step 2: Add an import + re-export so existing consumers keep working**

In `src/pages/Scheduling.tsx`, just after the existing `import { calculateShiftHours } from '@/lib/scheduleRoster';` line (line 27), add:

```typescript
import {
  buildActiveShiftEmployeeIds,
  filterEmployeesForScheduleView,
  selectVisibleRosterInputs,
} from '@/lib/scheduleVisibility';
```

Then, immediately below the `SKELETON_DAYS` constant (around line 116, before `getShiftStatusClass`), add a re-export so the existing test import path `@/pages/Scheduling` still resolves these names:

```typescript
// Re-exported from scheduleVisibility for backward compatibility (tests and
// other consumers import these from '@/pages/Scheduling').
export { buildActiveShiftEmployeeIds, filterEmployeesForScheduleView };
```

(Keep the `selectVisibleRosterInputs` import even if Scheduling.tsx does not call it yet — it will be unused here; if the linter flags an unused import, drop `selectVisibleRosterInputs` from this import statement and import it only in the dialog. `buildActiveShiftEmployeeIds` and `filterEmployeesForScheduleView` ARE still used inside `Scheduling.tsx` at the `filteredEmployeesWithShifts` memo, so they must remain imported.)

- [ ] **Step 3: Run the existing helper tests — they must still pass via the re-export**

Run: `npm run test -- tests/unit/schedulingHelpers.test.ts`
Expected: PASS — all `getShiftStatusClass`, `buildActiveShiftEmployeeIds`, and `filterEmployeesForScheduleView` cases green, proving the re-export preserves the `@/pages/Scheduling` import path.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "refactor(scheduling): source visibility helpers from lib, re-export for compat"
```

---

## Task 3: Add `selectVisibleRosterInputs` (TDD)

**Files:**
- Test: `tests/unit/scheduleVisibility.test.ts` (create)
- Modify: `src/lib/scheduleVisibility.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scheduleVisibility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  selectVisibleRosterInputs,
  filterEmployeesForScheduleView,
  buildActiveShiftEmployeeIds,
} from '@/lib/scheduleVisibility';
import type { Employee, Shift } from '@/types/scheduling';

const emp = (id: string, is_active: boolean): Employee =>
  ({ id, name: `Emp ${id}`, is_active } as unknown as Employee);

const shift = (id: string, employee_id: string, status: Shift['status']): Shift =>
  ({
    id,
    employee_id,
    status,
    start_time: '2026-06-29T09:00:00.000Z',
    end_time: '2026-06-29T17:00:00.000Z',
    break_duration: 0,
  } as unknown as Shift);

describe('selectVisibleRosterInputs', () => {
  it('excludes an inactive employee whose only shift is cancelled, and strips the cancelled shift', () => {
    const employees = [emp('active1', true), emp('inactive1', false)];
    const shifts = [
      shift('s1', 'active1', 'scheduled'),
      shift('s2', 'inactive1', 'cancelled'),
    ];
    const result = selectVisibleRosterInputs(shifts, employees);
    expect(result.employees.map(e => e.id)).toEqual(['active1']);
    expect(result.shifts.map(s => s.id)).toEqual(['s1']);
  });

  it('includes an inactive employee who has a non-cancelled shift', () => {
    const employees = [emp('inactive1', false)];
    const shifts = [shift('s1', 'inactive1', 'scheduled')];
    const result = selectVisibleRosterInputs(shifts, employees);
    expect(result.employees.map(e => e.id)).toEqual(['inactive1']);
    expect(result.shifts.map(s => s.id)).toEqual(['s1']);
  });

  it('always keeps active employees and strips their cancelled shifts', () => {
    const employees = [emp('active1', true)];
    const shifts = [
      shift('s1', 'active1', 'confirmed'),
      shift('s2', 'active1', 'cancelled'),
    ];
    const result = selectVisibleRosterInputs(shifts, employees);
    expect(result.employees.map(e => e.id)).toEqual(['active1']);
    expect(result.shifts.map(s => s.id)).toEqual(['s1']);
  });

  it('removes cancelled shifts regardless of employee', () => {
    const employees = [emp('active1', true), emp('active2', true)];
    const shifts = [
      shift('s1', 'active1', 'cancelled'),
      shift('s2', 'active2', 'cancelled'),
    ];
    const result = selectVisibleRosterInputs(shifts, employees);
    expect(result.shifts).toEqual([]);
    // both employees are active, so they remain even with no live shift
    expect(result.employees.map(e => e.id).sort()).toEqual(['active1', 'active2']);
  });

  it('returns empty arrays for empty inputs', () => {
    expect(selectVisibleRosterInputs([], [])).toEqual({ shifts: [], employees: [] });
  });

  it('matches the grid visibility rule (parity with filterEmployeesForScheduleView)', () => {
    const employees = [
      emp('active1', true),
      emp('inactiveLive', false),
      emp('inactiveCancelled', false),
      emp('inactiveNoShift', false),
    ];
    const shifts = [
      shift('s1', 'active1', 'scheduled'),
      shift('s2', 'inactiveLive', 'confirmed'),
      shift('s3', 'inactiveCancelled', 'cancelled'),
    ];
    const fromVisible = selectVisibleRosterInputs(shifts, employees).employees.map(e => e.id).sort();
    const fromGrid = filterEmployeesForScheduleView(
      employees,
      buildActiveShiftEmployeeIds(shifts),
      null,
      null,
    ).map(e => e.id).sort();
    expect(fromVisible).toEqual(fromGrid);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/scheduleVisibility.test.ts`
Expected: FAIL — `selectVisibleRosterInputs is not a function` (not yet exported).

- [ ] **Step 3: Implement `selectVisibleRosterInputs`**

Append to `src/lib/scheduleVisibility.ts`:

```typescript
import type { Shift } from '@/types/scheduling';

/**
 * Restrict export/print inputs to what the on-screen schedule grid shows.
 *
 * - Strips cancelled shifts (a cancelled shift is not a real scheduled shift
 *   and must not appear on a printed roster).
 * - Keeps an employee iff they are active OR they still have a non-cancelled
 *   shift — the same predicate the grid applies via
 *   `filterEmployeesForScheduleView`, minus position/area filtering (the export
 *   dialog applies position/area on top of this).
 *
 * Pass the RAW (un-position/area-filtered) shifts + employees: the live-shift
 * id set must be computed from the full shift list, mirroring how the grid
 * derives it before applying position/area to the employee list.
 */
export function selectVisibleRosterInputs(
  shifts: Shift[],
  employees: Employee[],
): { shifts: Shift[]; employees: Employee[] } {
  const liveShifts = shifts.filter(s => s.status !== 'cancelled');
  const liveShiftEmployeeIds = buildActiveShiftEmployeeIds(shifts);
  const visibleEmployees = employees.filter(
    emp => emp.is_active || liveShiftEmployeeIds.has(emp.id),
  );
  return { shifts: liveShifts, employees: visibleEmployees };
}
```

Note: merge the `import type { Shift }` into the existing `import type { Employee }` line so there is a single type import: `import type { Employee, Shift } from '@/types/scheduling';`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/unit/scheduleVisibility.test.ts`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduleVisibility.ts tests/unit/scheduleVisibility.test.ts
git commit -m "feat(scheduling): add selectVisibleRosterInputs roster visibility helper"
```

---

## Task 4: Apply the chokepoint inside `ScheduleExportDialog`

**Files:**
- Modify: `src/components/scheduling/ScheduleExportDialog.tsx`

- [ ] **Step 1: Import the helper**

In `src/components/scheduling/ScheduleExportDialog.tsx`, add to the imports (after the `buildRosterDay` import on line 18):

```typescript
import { selectVisibleRosterInputs } from '@/lib/scheduleVisibility';
```

- [ ] **Step 2: Derive `visibleShifts` / `visibleEmployees` from the raw props**

Immediately after the `weekDays` declaration (line 53, `const weekDays = eachDayOfInterval(...)`), add:

```typescript
  // Mirror the on-screen grid: drop cancelled shifts and inactive employees
  // who have no remaining live shift. Computed from the RAW props before the
  // position/area filter below (the grid derives its live-shift id set from
  // the full shift list, then applies position/area to the employee list).
  const { shifts: visibleShifts, employees: visibleEmployees } = useMemo(
    () => selectVisibleRosterInputs(shifts, employees),
    [shifts, employees],
  );
```

- [ ] **Step 3: Route `filteredShifts` through the visible data**

Replace the `filteredShifts` memo (lines 56-64) with:

```typescript
  // Filter shifts by area and position (AND semantics) on top of visibility.
  const filteredShifts = useMemo(() =>
    visibleShifts.filter(s => {
      const emp = visibleEmployees.find(e => e.id === s.employee_id);
      if (positionFilter && positionFilter !== "all" && emp?.position !== positionFilter) return false;
      if (areaFilter && areaFilter !== "all" && emp?.area !== areaFilter) return false;
      return true;
    }),
    [visibleShifts, visibleEmployees, positionFilter, areaFilter]
  );
```

- [ ] **Step 4: Route `allEmployeesWithShifts` through `visibleEmployees`**

Replace the `allEmployeesWithShifts` memo (lines 67-72) with:

```typescript
  // All employees who have shifts (after visibility + area + position filter)
  const allEmployeesWithShifts = useMemo(() => {
    const ids = new Set(filteredShifts.map(s => s.employee_id));
    return visibleEmployees
      .filter(emp => ids.has(emp.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredShifts, visibleEmployees]);
```

- [ ] **Step 5: Route the roster preview through `visibleEmployees`**

In the `previewRosterDay` memo (lines 110-118), change the `buildRosterDay` call to pass `visibleEmployees` and update the dependency array. The memo becomes:

```typescript
  const previewRosterDay = useMemo(() => {
    if (layout !== 'roster' || weekDays.length === 0) return null;
    const day =
      rosterDay === 'all'
        ? weekDays[0]
        : weekDays.find(d => format(d, 'yyyy-MM-dd') === rosterDay) ?? weekDays[0];
    const selectedShifts = filteredShifts.filter(s => selectedEmployeeIds.has(s.employee_id));
    return buildRosterDay(selectedShifts, visibleEmployees, day, sortBy, groupBy);
  }, [layout, rosterDay, weekDays, filteredShifts, selectedEmployeeIds, visibleEmployees, sortBy, groupBy]);
```

- [ ] **Step 6: Pass visible data to both PDF generators in `handleExport`**

In `handleExport` (lines 148-185), change BOTH generator calls to pass the visible arrays. In the `generateRosterPDF({...})` call, change `shifts,` → `shifts: visibleShifts,` and `employees,` → `employees: visibleEmployees,`. In the `generateSchedulePDF({...})` call, do the same: `shifts: visibleShifts,` and `employees: visibleEmployees,`. The rest of each options object is unchanged.

After the edit, the two calls read:

```typescript
      generateRosterPDF({
        shifts: visibleShifts,
        employees: visibleEmployees,
        days,
        weekStart,
        weekEnd,
        restaurantName,
        sortBy,
        groupBy,
        positionFilter,
        areaFilter,
        selectedEmployeeIds,
        includePositions,
        includeHoursSummary,
      });
```

```typescript
      generateSchedulePDF({
        shifts: visibleShifts,
        employees: visibleEmployees,
        weekStart,
        weekEnd,
        restaurantName,
        includePositions,
        includeHoursSummary,
        positionFilter,
        areaFilter,
        groupBy,
        selectedEmployeeIds,
      });
```

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (If lint flags an unused `selectVisibleRosterInputs` import in `Scheduling.tsx` from Task 2 Step 2, remove that one name from the `Scheduling.tsx` import now — the dialog is the only runtime caller.)

- [ ] **Step 8: Run the scheduling/export unit suites**

Run: `npm run test -- tests/unit/scheduleExport.test.ts tests/unit/scheduleExportGrouping.test.ts tests/unit/scheduleExportHelpers.test.ts tests/unit/scheduleRoster.test.ts tests/unit/scheduleRosterExport.test.ts tests/unit/schedulingHelpers.test.ts tests/unit/scheduleVisibility.test.ts`
Expected: PASS — all green.

- [ ] **Step 9: Commit**

```bash
git add src/components/scheduling/ScheduleExportDialog.tsx src/pages/Scheduling.tsx
git commit -m "fix(scheduling): print schedule mirrors grid visibility (hide inactive employees)"
```

---

## Task 5: Full local verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test`
Expected: PASS — full green, no regressions.

- [ ] **Step 2: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 3: Commit any incidental fixes (only if needed)**

```bash
git add -A
git commit -m "chore(scheduling): verification fixups"
```

(Skip if there is nothing to commit.)

---

## Self-Review Notes (spec coverage)

- Spec "extract helpers into lib + re-export" → Tasks 1, 2.
- Spec "`selectVisibleRosterInputs` drops cancelled shifts + inactive-no-live-shift employees" → Task 3.
- Spec "apply once at dialog boundary; route checkbox list, preview, BOTH PDF generators" → Task 4 Steps 2-6.
- Spec "filter on RAW props before position/area" → Task 4 Step 2 (comment + dep array).
- Spec "new test imports from `@/lib/scheduleVisibility`" → Task 3 Step 1.
- Spec "parity test feeds full shift list to `buildActiveShiftEmployeeIds`" → Task 3 Step 1 parity case.
- Spec "generators need no signature change" → Task 4 leaves `scheduleExport.ts` untouched; generators receive pre-filtered arrays.
- Spec "`selectedEmployeeIds ⊆ visibleEmployees`" → upheld because the init `useEffect` keys off `allEmployeesWithShifts` (now derived from `visibleEmployees`), unchanged in this plan.
