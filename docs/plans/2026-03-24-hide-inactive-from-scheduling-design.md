# Hide Inactive Employees from Scheduling View

**Date:** 2026-03-24
**Status:** Approved

## Problem

Inactive employees appear in the scheduling grid, making it confusing — especially in restaurants with high churn. Managers see former employees cluttering the view.

## Design

**Rule:** Show an employee in the scheduling view if they are **active** OR if they have **shifts in the currently displayed week**. This handles the 2-week notice scenario — employees show up for weeks where they were still scheduled, then disappear once those weeks pass.

### Approach: Filter at display level

The current code in `Scheduling.tsx` loads all employees (`status: 'all'`) and filters to those with shifts via `filteredEmployeesWithShifts`. We adjust this filter to:

1. Include all **active** employees (even without shifts — they should appear so managers can schedule them)
2. Include **inactive** employees **only** if they have shifts in the current week

**Filter pseudocode:**
```typescript
const filteredEmployeesWithShifts = allEmployees.filter(emp =>
  emp.is_active || shiftEmployeeIds.has(emp.id)
);
```

The existing inactive badge styling (muted avatar + "Inactive" badge) already visually distinguishes these employees.

**Downstream usage:** `totalScheduledHours` (line 361) sums hours over shifts filtered by this employee list. Since hours come from shifts (not employees), adding active employees without shifts does not change the sum.

### Bug fixes

`EmployeeSelector.tsx`, `ShiftDialog.tsx`, and `TradeRequestDialog.tsx` filter by `emp.status === 'active'` instead of (or redundantly with) `emp.is_active`. These should use only the boolean flag for consistency with the DB constraint.

### Files to modify

| File | Change |
|------|--------|
| `src/pages/Scheduling.tsx` | Update `filteredEmployeesWithShifts` filter logic |
| `src/components/scheduling/EmployeeSelector.tsx` | `emp.status === 'active'` → `emp.is_active` |
| `src/components/ShiftDialog.tsx` | `emp.status === 'active'` → `emp.is_active` |
| `src/components/schedule/TradeRequestDialog.tsx` | Remove redundant `emp.status === 'active'` check (already has `emp.is_active`) |

### No changes needed

- `useShiftPlanner.ts` — already loads only active employees
- `ShiftPlannerTab` — uses `useShiftPlanner` which only loads active employees. Inactive employees with shifts won't appear in the planner tab (out of scope — the planner is template-based, not shift-based)
- Database schema — no changes
- Inactive badge styling — already exists
