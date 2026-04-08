# Planner UX Enhancements + CSV Import Timezone Fix

## 1. Employee Sidebar UX

### Problem
The employee list can get long, making it hard to find, select, and drag someone to a shift. The sidebar also scrolls with the grid, losing context.

### Design

The sidebar becomes a sticky, independently-scrollable panel with search and role filter:

- **Search input**: Filters employees by name (case-insensitive substring). No debounce library needed.
- **Role filter**: `<Select>` dropdown populated from unique employee positions. "All" is default.
- **Sticky header**: "EMPLOYEES" label, search, and filter stay pinned at top. Employee list scrolls independently via `flex-1 overflow-y-auto`.
- **Count badge**: Each employee chip shows the number of shifts assigned in the current week. Computed from the `shifts` array.

```
┌──────────────┐
│  EMPLOYEES   │
│  [Search...] │  ← sticky
│  All ▾       │  ← role filter
├──────────────┤
│ ● Alice      │  ← independent scroll
│   Server (3) │     badge = shifts this week
│ ● Bob        │
│   Cook (5)   │
└──────────────┘
```

### Changes
- Modify: `EmployeeSidebar.tsx` — add search, filter, sticky layout, count badge
- Modify: `ShiftPlannerTab.tsx` — pass `shifts` to sidebar for badge computation

## 2. Drop Feedback

### Problem
When an employee is dropped into a shift cell, there's no visual confirmation. The chip appears via React Query refetch, but there's no animation or acknowledgment.

### Design

Three feedback mechanisms on successful drop:

1. **Cell highlight**: Brief green pulse (`bg-green-500/10` → fade out 600ms) on the target cell. Triggered by a `lastDrop` state in `ShiftPlannerTab` that stores `{ cellId, timestamp }`. `ShiftCell` checks if its ID matches and renders the highlight. Auto-clears after 600ms via `useEffect`.

2. **Success toast**: "Alice assigned to Morning — Mon" via existing `useToast` hook. Only on success — validation errors use the existing alert bar.

3. **Count badge update**: The sidebar chip for the employee increments immediately (driven by React Query cache invalidation after shift creation).

### Changes
- Modify: `ShiftPlannerTab.tsx` — add `lastDrop` state, set on success, pass to grid, show toast
- Modify: `ShiftCell.tsx` — accept `highlightCellId`, render green pulse when matched
- Modify: `TemplateGrid.tsx` — pass `highlightCellId` through to cells

## 3. CSV Import Timezone Fix

### Problem
`buildLocalISO` (Sling parser) and `parseDateAndTime` (generic parser) produce timestamps without timezone info. PostgreSQL treats them as UTC. So "10:00 AM" from a CSV in `America/Chicago` becomes `10:00 UTC` = `4:00 AM Central`.

### Design

1. **Pass restaurant timezone** to `ShiftImportSheet` from the Scheduling page (`selectedRestaurant?.restaurant?.timezone`).

2. **New utility: `localToUTC(dateStr, timeHHMM, timezone)`** — uses `Intl.DateTimeFormat` to compute the UTC offset for the given timezone and date (handles DST), then builds a proper UTC ISO string. No extra library.

   Example: `localToUTC('2026-02-28', '10:00', 'America/Chicago')` → `'2026-02-28T16:00:00.000Z'`

3. **Update both parsers** to use `localToUTC`:
   - `slingCsvParser.ts`: `buildLocalISO` takes an optional `timezone` param
   - `ShiftImportSheet.tsx`: `parseDateAndTime` takes a `timezone` param

### Changes
- Create: `src/utils/timezoneUtils.ts` — `localToUTC` function
- Modify: `src/utils/slingCsvParser.ts` — pass timezone through to `buildLocalISO`
- Modify: `src/components/scheduling/ShiftImportSheet.tsx` — accept timezone prop, pass to parsers
- Modify: `src/pages/Scheduling.tsx` — pass `timezone` to `ShiftImportSheet`

## YAGNI — Not building

- Drag-from-cell-to-cell (move employee between shifts)
- Employee availability display in sidebar
- Multi-select employees for batch assignment
- Timezone selector in the import dialog (use restaurant timezone always)
