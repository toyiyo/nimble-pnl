# Schedule Multi-Select: Design Spec

**Date:** 2026-04-07
**Status:** Approved

## Overview

Add multi-select functionality to the schedule view, enabling bulk delete and bulk edit of shifts. Users activate selection mode via a toolbar toggle, select shifts by clicking cards/rows/columns, then act on them through a floating action bar.

## Activation

- **"Select" toggle button** in the schedule toolbar (next to week navigation)
- When active: shift clicks toggle selection instead of opening edit dialog
- When active: drag-to-copy (DnD) is disabled
- Exiting selection mode clears all selections

## Selection Interactions

### Individual Selection
- Click a shift card to toggle its selection (blue highlight + checkmark)
- Selected shifts show a distinct visual state: blue border, blue background tint, checkmark icon

### Row Selection
- Click an employee's name (left column) to select/deselect all their shifts for the visible week
- If all shifts in the row are already selected, clicking deselects all

### Column Selection
- Click a day header (Mon, Tue, etc.) to select/deselect all shifts for that day
- If all shifts in the column are already selected, clicking deselects all

## Selection State

- Managed as `Set<string>` of shift IDs in component state
- Cleared when exiting selection mode or after a bulk action completes
- No persistence — selection is ephemeral within the current view

## Bulk Action Bar

- Uses existing `BulkActionBar` component from `src/components/bulk-edit/`
- Slides up from bottom when >= 1 shift is selected
- Shows: "X shifts selected" count + close (X) button + Edit button + Delete button
- Close button clears selection (does not exit selection mode)

## Bulk Edit Dialog

- Single dialog with optional fields: Start Time, End Time, Position, Area
- All fields default to "— No change —" placeholder state
- Only fields the user explicitly changes are applied to selected shifts
- Changed fields highlighted visually (blue accent)
- Submit button: "Apply to N Shifts"
- Each field uses the same input components as the existing ShiftDialog

### Field Application Logic
- For each selected (non-locked) shift, apply only the changed fields via individual `updateShift` mutations
- Use `Promise.allSettled` to handle partial failures gracefully
- Show toast with results: "N shifts updated. M locked shifts skipped."

## Bulk Delete

- Uses existing `BulkDeleteConfirmDialog` component pattern
- Shows count of shifts to delete
- If any selected shifts are locked (published), shows warning: "N locked shifts will be skipped"
- Delete button text reflects actual deletable count: "Delete N Shifts"
- Executes individual `deleteShift` mutations via `Promise.allSettled`
- Shows toast with results: "N shifts deleted. M locked shifts skipped."

## Recurring Shifts

- Bulk operations always apply to "this shift only" — no series cascading
- This is the safest default for bulk operations
- Users who need series-wide changes use the existing single-shift recurring dialog

## Locked Shifts

- Published shifts have `locked: true`
- Locked shifts CAN be selected (for visual clarity of what's in scope)
- Locked shifts are SKIPPED during bulk edit/delete with a warning count
- The action bar could optionally show "N of M are locked" when locked shifts are in selection

## Interaction with Existing Features

| Feature | In Selection Mode | Normal Mode |
|---------|------------------|-------------|
| Click shift | Toggle selection | Open edit dialog |
| Drag shift | Disabled | Copy to day |
| Click employee name | Select row | No action (existing) |
| Click day header | Select column | No action (existing) |
| Publish/Unpublish | Available | Available |
| Add shift (+) | Available | Available |

## Components to Create/Modify

### New Components
- `BulkEditShiftsDialog` — combined edit dialog with optional fields
- `SelectableShiftCard` — wrapper or variant of ShiftCard with selection visual state

### Modified Components
- `Scheduling.tsx` — selection mode state, toolbar toggle, selection handlers
- `ShiftCard` — accept `isSelected` and `onSelect` props for visual state
- Day headers and employee name cells — click handlers for column/row select

### Reused Components
- `BulkActionBar` (existing)
- `BulkDeleteConfirmDialog` (existing)

## New Hook
- `useBulkShiftActions(restaurantId)` — wraps bulk delete and bulk edit logic
  - `bulkDelete(shiftIds: string[])` — filters locked, calls deleteShift for each, returns results
  - `bulkEdit(shiftIds: string[], changes: Partial<ShiftChanges>)` — filters locked, calls updateShift for each, returns results
  - Invalidates shifts query on completion
