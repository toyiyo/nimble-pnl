# Schedule Print Employee Selection — Plan

## Tasks

1. **Add selectedEmployeeIds filter to scheduleExport.ts** (~2 min)
   - Add `selectedEmployeeIds?: Set<string>` to `ScheduleExportOptions`
   - Filter `employeesWithShifts` by selection when provided
   - Write unit test

2. **Add employee selection UI to ScheduleExportDialog.tsx** (~5 min)
   - Add `selectedEmployeeIds` state initialized from employees with shifts
   - Add Select All / Deselect All controls + count
   - Add 2-column checkbox grid of employees
   - Filter preview and export by selected employees
   - Re-sync selection when position filter or employees change

## Dependencies
Task 2 depends on Task 1 (uses the new option).
