# Schedule Group by Area — Design

## Problem
Restaurants with 20+ employees find the flat schedule view hard to navigate and print. They need to group employees by area (Back of House, Front of House, Bar, etc.) for both viewing and printing.

## Solution
Add an `area` field to employees and a "Group by" toggle in the schedule view that renders collapsible section headers. PDF export respects grouping.

## Changes

### Database
- Add nullable `area TEXT` column to `employees` table
- No new tables needed — area is a simple field like position

### Employee Management
- Add area dropdown in EmployeeDialog (AreaCombobox, same pattern as PositionCombobox)
- Predefined: Back of House, Front of House, Bar, Management
- Allow custom areas (free-text like positions)

### Schedule View
- Add "Group by" toggle: None / Area / Position
- When grouped: collapsible section headers with area name + employee count
- Position filter works alongside grouping (filters within groups)
- Persists selection in localStorage

### PDF Export
- Grouped PDF: section headers between groups
- Area filter option in export dialog
- Existing position filter still works

## Files
- 1 migration
- `src/types/scheduling.ts`
- `src/components/EmployeeDialog.tsx`
- `src/components/AreaCombobox.tsx` (new)
- `src/hooks/useEmployeeAreas.tsx` (new)
- `src/pages/Scheduling.tsx`
- `src/utils/scheduleExport.ts`
- `src/components/scheduling/ScheduleExportDialog.tsx`
- Tests
