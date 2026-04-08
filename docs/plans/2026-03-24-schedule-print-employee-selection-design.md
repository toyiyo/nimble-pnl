# Schedule Print Employee Selection

## Problem
When printing/exporting the schedule PDF, all employees with shifts are included. Users need to select specific individuals to include in the export.

## Solution
Add a checkbox-based employee selection section to `ScheduleExportDialog`. All employees checked by default. Both preview table and PDF export respect the selection.

## Changes

### 1. ScheduleExportDialog.tsx
- Add `selectedEmployeeIds` state (Set<string>), initialized to all employees with shifts
- Add "Select Employees" section with 2-column checkbox grid
- Add Select All / Deselect All buttons + count label
- Filter preview table and export by selected employees
- Re-initialize selection when dialog opens or position filter changes

### 2. scheduleExport.ts
- Add optional `selectedEmployeeIds?: Set<string>` to `ScheduleExportOptions`
- Filter employees by selection before building PDF table

## Non-goals
- No new components or hooks
- No database changes
- No changes to publish flow (only print/export)
