# Scheduling Conflict Enhancements

## Problem

1. **Generic conflict messages**: The schedule view shows "Shift on 2026-03-18 is outside employee availability" without showing the actual availability hours, making it hard for managers to understand the constraint and adjust.
2. **No planner warnings**: The shift planner (drag-and-drop) view has no availability or time-off conflict checking — managers discover conflicts only after opening the shift dialog.
3. **Overlap blocks assignment**: The shift validator treats overlapping shifts as errors, blocking creation. Owner/managers who work all day need overlapping shifts for visibility.

## Solution

### 1. Structured Availability Data from SQL

Update `check_availability_conflict()` to return the employee's actual availability window times alongside the conflict message.

**Important**: Changing the `RETURNS TABLE` signature requires `DROP FUNCTION` first — PostgreSQL cannot alter the return type of an existing function with `CREATE OR REPLACE`.

**Return table changes:**
```sql
RETURNS TABLE (
  has_conflict BOOLEAN,
  conflict_type TEXT,
  message TEXT,
  available_start TIME,  -- NEW
  available_end TIME     -- NEW
)
```

**Population by return path:**
1. Exception `is_available = false` (whole day unavailable): `available_start = NULL`, `available_end = NULL`
2. Exception with specific window: `available_start = v_exception.start_time`, `available_end = v_exception.end_time`
3. Recurring `is_available = false` (whole day unavailable): `available_start = NULL`, `available_end = NULL`
4. Recurring outside window (most common case): Must store the best-matching window in a variable (e.g., `v_last_checked_window RECORD`) during the `FOR` loop before it exits, then return `available_start = v_last_checked_window.start_time`, `available_end = v_last_checked_window.end_time`

Times remain in UTC; frontend handles timezone conversion.

### 2. Enhanced Conflict Display in ShiftDialog

Update `useConflictDetection.tsx` to pass `available_start`/`available_end` through the `ConflictCheck` type.

**Timezone handling**: `ShiftDialog` receives `restaurantId` as a prop but not the timezone. Add a `timezone` prop passed from the parent (the Scheduling page already has the restaurant object). Fallback: if timezone is undefined, display times in UTC with a "(UTC)" suffix.

Update the ShiftDialog alert to format availability hours in local time:
- With window: "Shift on Wed, Mar 18 is outside availability (available 8:00 AM - 5:00 PM)"
- Without window: "Employee is unavailable on Wed, Mar 18"
- Time-off: unchanged ("Employee has pending time-off from 2026-03-18 to 2026-03-20")

### 3. Availability Warnings in Shift Planner

Add availability/time-off checking to the planner's drag-and-drop assignment flow.

**Architecture**: Reuse the existing `useCheckConflicts` hook from `useConflictDetection.tsx` rather than adding direct `supabase.rpc` calls to `useShiftPlanner`. The planner tab component will call a new imperative conflict-check function that wraps the same RPCs.

**New hook: `useCheckConflictsImperative()`** in `useConflictDetection.tsx`:
- Same RPC calls as `useCheckConflicts` but returns a callable function instead of a reactive query
- Returns `(params: ConflictCheckParams) => Promise<{ conflicts: ConflictCheck[], hasConflicts: boolean }>`
- Used by the planner for on-demand checking (not reactive)

**Interface changes to `useShiftPlanner`:**
- `validateAndCreate` return type changes from `Promise<boolean>` to `Promise<{ created: boolean; pendingConflicts?: ConflictCheck[]; pendingInput?: CreateInput }>`
- When conflicts are found: returns `{ created: false, pendingConflicts: [...], pendingInput: {...} }` — the component uses this to show the dialog
- New method: `forceCreate(input: CreateInput): Promise<boolean>` — creates shift without conflict checks (called from dialog's "Assign Anyway")
- `ShiftPlannerTab` manages dialog state: `pendingConflicts` and `pendingInput` in component state

**Single-assignment flow:**
1. Manager drops employee onto shift slot
2. `validateShift()` runs client-side (overlap → warning, rest gap → warning)
3. Call availability/time-off RPCs via `useCheckConflictsImperative()`
4. Merge all warnings (client-side + server-side)
5. If any warnings → return pending state → component shows `AvailabilityConflictDialog`
6. If no warnings → create shift immediately

**"Assign All" flow (multi-day):**
1. Manager clicks "Assign All" for a template
2. For each active day: run client-side validation + RPC checks
3. Collect all days with conflicts into a single summary
4. If any conflicts → show dialog listing all conflicted days with details
5. "Assign Anyway" → creates all shifts (including conflicted ones)
6. "Cancel" → creates none
7. If no conflicts on any day → create all immediately

**AvailabilityConflictDialog component:**
- Amber/warning styling (not destructive red)
- Lists all conflicts with formatted hours in local time
- Groups by day when multiple days have conflicts (Assign All case)
- "Cancel" and "Assign Anyway" buttons
- On "Assign Anyway" → calls `forceCreate` for pending input(s)
- On "Cancel" → clears pending state

### 4. Relax Overlap Validation to Warnings

Update `shiftValidator.ts`:
- Move `OVERLAP` from `errors[]` to `warnings[]`
- Move `TIME_OFF` from `errors[]` to `warnings[]` (server-side RPCs are the authoritative check)
- `valid` remains `true` since all checks are now warnings
- `CLOPEN` (rest gap) is already a warning — no change

Note: 21 existing tests assert `valid === false` for OVERLAP and TIME_OFF. These all need updating to assert `valid === true` with the issues in `warnings[]` instead of `errors[]`.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/NEW.sql` | `DROP FUNCTION` then recreate with `available_start`/`available_end` columns, store last-checked window in variable for path 4 |
| `src/types/scheduling.ts` | Add `available_start?`/`available_end?` to `ConflictCheck` type |
| `src/hooks/useConflictDetection.tsx` | Update `AvailabilityConflictResponse` interface; add `useCheckConflictsImperative()` hook |
| `src/components/ShiftDialog.tsx` | Add `timezone` prop; format conflict messages with local-time availability hours |
| `src/lib/shiftValidator.ts` | Move OVERLAP and TIME_OFF to warnings |
| `src/hooks/useShiftPlanner.ts` | Change `validateAndCreate` return type; add `forceCreate` method; integrate imperative conflict check |
| `src/components/scheduling/ShiftPlanner/AvailabilityConflictDialog.tsx` | NEW: confirmation dialog with amber warning styling |
| `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` | Manage `pendingConflicts`/`pendingInput` state; wire up dialog; update `handleAssignDay` and `handleAssignAll` |
| Parent of ShiftDialog (Scheduling page) | Pass `timezone` prop to ShiftDialog |

## Files to Test

| File | Tests |
|------|-------|
| `supabase/tests/availability_conflict_structured.sql` | pgTAP: verify `available_start`/`available_end` populated correctly for all 4 return paths (recurring window, recurring unavailable, exception window, exception unavailable) |
| `tests/unit/shiftValidator.test.ts` | Update 21 tests: overlaps and time-off now produce warnings not errors, `valid` is always true |

## Out of Scope

- Pre-computing availability for the whole week (visual indicators on the grid)
- Changes to the AvailabilityDialog or availability data model
