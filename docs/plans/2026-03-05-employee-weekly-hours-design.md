# Per-Employee Weekly Hours in Shift Planner Sidebar

## Problem
The shift planner's employee sidebar shows shift count per employee but not total scheduled hours. Managers need to see at a glance how many hours each person is scheduled for the week.

## Solution
Add weekly hours display to each employee card in the EmployeeSidebar, alongside the existing shift count badge.

### Display Format
`{shiftCount} · {hours}h` in the badge area. Example: `3 · 24h`. If no shifts, nothing displays (unchanged).

### Calculation
- Filter shifts by employee_id, exclude cancelled
- For each shift: `(end_time - start_time) - break_duration`
- Sum net hours per employee, round to nearest integer
- Reuse existing `computeTotalHours` pattern from `useShiftPlanner.ts`

### Files Changed
- `src/hooks/useShiftPlanner.ts` — export `computeHoursPerEmployee(shifts)` utility
- `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx` — compute and display hours per employee

### No Changes Needed
- No database changes
- No new hooks or dependencies
- No grid/template changes
