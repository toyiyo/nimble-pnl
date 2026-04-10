# Design: Allow Deleting Published Shifts with Warning

**Date:** 2026-04-08
**Status:** Approved

## Problem

Currently, published (locked) shifts cannot be deleted. The system blocks deletion with "Cannot modify a locked shift" errors. Managers need the ability to delete published shifts when schedules change, with a clear warning that employees may have already seen the shift.

## Solution

Replace the hard block with a warning confirmation dialog. The `locked` flag remains for tracking purposes but no longer prevents deletion.

## Changes

### 1. Warning Dialog (UI Layer)

When deleting one or more published shifts, show an `AlertDialog`:
- **Title:** "Delete published shift?" / "Delete published shifts?"
- **Body:** "This shift has been published and employees may have already seen it. This action cannot be undone."
- **Actions:** Cancel (secondary) / Delete (destructive)

The dialog appears in three contexts:
- Single shift delete (X button on chip)
- Recurring shift delete (RecurringShiftActionDialog)
- Bulk delete (multi-select toolbar)

### 2. Single Shift Delete — `useShifts.tsx`

- Remove `assertShiftNotLocked()` call from `useDeleteShift()` mutation
- The `assertShiftNotLocked()` function can be removed entirely (no other callers need it for delete; update operations still use it if applicable)
- Warning responsibility moves to the UI — the hook just deletes

### 3. Recurring Shift Delete — `RecurringShiftActionDialog.tsx`

- Current: shows "X shift(s) are part of a published schedule and will not be deleted"
- New: shows the warning message instead, and proceeds with deletion on confirm
- Passes `includePublished: true` to the delete RPC when user confirms

### 4. Recurring Shift Delete RPC — `delete_shift_series()` SQL

- Add parameter: `p_include_locked BOOLEAN DEFAULT false`
- When `p_include_locked = true`: remove the `WHERE locked = false` filter
- When `p_include_locked = false` (default): existing behavior preserved for backward compatibility
- Return value unchanged: `deleted_count` and `locked_count`

### 5. Bulk Delete — `useBulkShiftActions.ts`

- Remove `partitionByLocked()` logic that separates locked/unlocked shifts
- If any selected shifts are locked, trigger the warning dialog before proceeding
- On confirm, delete all selected shifts (locked and unlocked)

### 6. Scheduling Page — `Scheduling.tsx`

- Add state for the published-shift warning dialog
- Wire the dialog into `handleDeleteShift()` flow: check if shift is published → show warning → on confirm, proceed with delete

## What Does NOT Change

- `locked` and `is_published` columns remain on the shifts table
- Publish schedule flow unchanged
- `useUpdateShift` still checks locked status (editing published shifts still blocked)
- No employee notifications added (future enhancement)

## Testing

- Unit tests for `useDeleteShift` hook (locked shift deletion succeeds)
- Unit test for `delete_shift_series()` RPC with `p_include_locked = true`
- pgTAP test for the SQL function parameter
