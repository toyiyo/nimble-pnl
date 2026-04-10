# Hide Inactive Employees from Scheduling View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide inactive employees from the scheduling grid unless they have shifts in the currently displayed week.

**Architecture:** Filter change in `Scheduling.tsx` — modify `filteredEmployeesWithShifts` to include active employees OR inactive employees with shifts. Bug fixes in 3 components that use `emp.status === 'active'` instead of `emp.is_active`.

**Tech Stack:** React, TypeScript, Vitest

**Spec:** `docs/plans/2026-03-24-hide-inactive-from-scheduling-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/pages/Scheduling.tsx` | Modify lines 340-348 | Core filter logic change |
| `src/components/scheduling/EmployeeSelector.tsx` | Modify line 23 | Bug fix: `status` → `is_active` |
| `src/components/ShiftDialog.tsx` | Modify line 252 | Bug fix: `status` → `is_active` |
| `src/components/schedule/TradeRequestDialog.tsx` | Modify line 57 | Bug fix: remove redundant `status` check |
| `tests/unit/schedulingHelpers.test.ts` | Modify | Add filter logic tests |

---

### Task 1: Extract and test the employee filter logic

The filter logic currently lives inline in a `useMemo` inside `Scheduling.tsx`. We'll extract it as a named, exported pure function so we can unit test it directly.

**Files:**
- Modify: `src/pages/Scheduling.tsx:340-348`
- Modify: `tests/unit/schedulingHelpers.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/schedulingHelpers.test.ts`:

```typescript
import { filterEmployeesForScheduleView } from '@/pages/Scheduling';

describe('filterEmployeesForScheduleView', () => {
  const activeWithShifts = { id: '1', name: 'Alice', is_active: true, position: 'Server' };
  const activeNoShifts = { id: '2', name: 'Bob', is_active: true, position: 'Cook' };
  const inactiveWithShifts = { id: '3', name: 'Carol', is_active: false, position: 'Server' };
  const inactiveNoShifts = { id: '4', name: 'Dave', is_active: false, position: 'Cook' };
  const allEmployees = [activeWithShifts, activeNoShifts, inactiveWithShifts, inactiveNoShifts];
  const shiftEmployeeIds = new Set(['1', '3']); // Alice and Carol have shifts

  it('includes active employees regardless of shifts', () => {
    const result = filterEmployeesForScheduleView(allEmployees as any, shiftEmployeeIds, null);
    expect(result.map(e => e.id)).toContain('1'); // active + shifts
    expect(result.map(e => e.id)).toContain('2'); // active + no shifts
  });

  it('includes inactive employees only if they have shifts', () => {
    const result = filterEmployeesForScheduleView(allEmployees as any, shiftEmployeeIds, null);
    expect(result.map(e => e.id)).toContain('3'); // inactive + shifts
    expect(result.map(e => e.id)).not.toContain('4'); // inactive + no shifts
  });

  it('applies position filter when provided', () => {
    const result = filterEmployeesForScheduleView(allEmployees as any, shiftEmployeeIds, 'Server');
    expect(result.map(e => e.id)).toEqual(['1', '3']); // only Servers
  });

  it('returns all matching when position filter is "all"', () => {
    const result = filterEmployeesForScheduleView(allEmployees as any, shiftEmployeeIds, 'all');
    expect(result.map(e => e.id)).toEqual(['1', '2', '3']); // no Dave
  });

  it('returns empty array when no employees match', () => {
    const result = filterEmployeesForScheduleView([], new Set(), null);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedulingHelpers.test.ts`
Expected: FAIL — `filterEmployeesForScheduleView` is not exported from `@/pages/Scheduling`

- [ ] **Step 3: Extract and implement the filter function**

In `src/pages/Scheduling.tsx`, add this exported function (above the component):

```typescript
/** Filter employees for the weekly schedule grid:
 *  - Active employees always shown (so managers can schedule them)
 *  - Inactive employees shown only if they have shifts this week */
export function filterEmployeesForScheduleView(
  allEmployees: Employee[],
  shiftEmployeeIds: Set<string>,
  positionFilter: string | null,
): Employee[] {
  const filtered = allEmployees.filter(emp =>
    emp.is_active || shiftEmployeeIds.has(emp.id)
  );
  if (positionFilter && positionFilter !== 'all') {
    return filtered.filter(emp => emp.position === positionFilter);
  }
  return filtered;
}
```

Then update the `useMemo` at lines 340-348 to use it:

```typescript
const filteredEmployeesWithShifts = useMemo(() => {
  const shiftEmployeeIds = new Set(shifts.map(s => s.employee_id));
  return filterEmployeesForScheduleView(allEmployees, shiftEmployeeIds, positionFilter);
}, [allEmployees, shifts, positionFilter]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schedulingHelpers.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/Scheduling.tsx tests/unit/schedulingHelpers.test.ts
git commit -m "feat: hide inactive employees from scheduling view unless they have shifts"
```

---

### Task 2: Fix `emp.status` → `emp.is_active` bug in EmployeeSelector

**Files:**
- Modify: `src/components/scheduling/EmployeeSelector.tsx:23`

- [ ] **Step 1: Fix the filter**

Change line 23 from:
```typescript
const activeEmployees = employees.filter(emp => emp.status === 'active');
```
To:
```typescript
const activeEmployees = employees.filter(emp => emp.is_active);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/scheduling/EmployeeSelector.tsx
git commit -m "fix: use is_active instead of status for employee filtering in EmployeeSelector"
```

---

### Task 3: Fix `emp.status` → `emp.is_active` bug in ShiftDialog

**Files:**
- Modify: `src/components/ShiftDialog.tsx:252`

- [ ] **Step 1: Fix the filter**

Change line 252 from:
```typescript
const activeEmployees = employees.filter((emp) => emp.status === 'active');
```
To:
```typescript
const activeEmployees = employees.filter((emp) => emp.is_active);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ShiftDialog.tsx
git commit -m "fix: use is_active instead of status for employee filtering in ShiftDialog"
```

---

### Task 4: Remove redundant `emp.status` check in TradeRequestDialog

**Files:**
- Modify: `src/components/schedule/TradeRequestDialog.tsx:57`

- [ ] **Step 1: Fix the filter**

Change line 57 from:
```typescript
(emp) => emp.id !== currentEmployeeId && emp.is_active && emp.status === 'active'
```
To:
```typescript
(emp) => emp.id !== currentEmployeeId && emp.is_active
```

- [ ] **Step 2: Commit**

```bash
git add src/components/schedule/TradeRequestDialog.tsx
git commit -m "fix: remove redundant status check in TradeRequestDialog employee filter"
```
