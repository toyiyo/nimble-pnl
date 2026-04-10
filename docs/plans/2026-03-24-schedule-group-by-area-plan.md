# Schedule Group by Area — Implementation Plan

## Task 1: DB Migration + Types
- Add `area TEXT` column to `employees` table (nullable, no default)
- Update `Employee` interface in `src/types/scheduling.ts` to include `area?: string`
- **Test**: pgTAP test verifying column exists and accepts values

## Task 2: useEmployeeAreas Hook
- New hook `src/hooks/useEmployeeAreas.tsx` — fetches distinct areas from employees table
- Same pattern as `useEmployeePositions.tsx`
- **Test**: Unit test for hook

## Task 3: AreaCombobox Component
- New component `src/components/AreaCombobox.tsx`
- Predefined suggestions: Back of House, Front of House, Bar, Management
- Allows custom input (same pattern as PositionCombobox)
- **Test**: Unit test for rendering and selection

## Task 4: Employee Dialog — Add Area Field
- Add AreaCombobox to `src/components/EmployeeDialog.tsx`
- Load area from existing employee on edit
- Include area in form submission data
- **Test**: Verify area field appears and submits

## Task 5: Schedule View — Group By Toggle + Grouped Rendering
- Add "Group by" state (none/area/position) to `src/pages/Scheduling.tsx`
- Add toggle UI in the toolbar alongside position filter
- Implement grouping logic: group `filteredEmployeesWithShifts` by area or position
- Render collapsible group headers with name + count
- Employees without area → "Unassigned" group (sorted last)
- Persist group-by choice in localStorage
- **Test**: Unit test for grouping utility function

## Task 6: PDF Export — Grouped Output
- Update `src/utils/scheduleExport.ts` to accept groupBy option
- Render group headers in PDF between sections
- Update `ScheduleExportDialog.tsx` to pass groupBy + area filter
- **Test**: Unit test for grouped PDF data preparation

## Dependencies
- Task 1 → Tasks 2, 3, 4 (need column + type)
- Tasks 2, 3 → Task 4 (need hook + component)
- Task 4 independent of Tasks 5, 6
- Task 5 independent of Task 6
- Tasks 5, 6 can run in parallel after Task 1
