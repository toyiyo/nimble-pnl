# Drag-to-Copy Shifts in Schedule View

**Date:** 2026-03-24
**Status:** Draft

## Problem

Managers want to quickly duplicate shifts by dragging an existing entry to another day. Currently the schedule view has no drag-and-drop — shifts can only be created via the "Add" button or the shift dialog.

## Solution

Add drag-to-copy to the schedule grid using `@dnd-kit/core` (already in the bundle, proven pattern in ShiftPlannerTab). Dragging a ShiftCard to a different day cell in the same employee row creates a copy with identical times, position, and break duration on the target day.

## UX Flow

1. User grabs a ShiftCard in the schedule grid
2. Drag ghost appears (DragOverlay showing time + position)
3. Original card dims to `opacity-40`
4. Valid drop targets highlight with `bg-primary/5 ring-1 ring-primary/30`
5. User drops on a different day cell in the same employee row
6. System runs conflict validation (`validateAndCreate`)
7. If valid: shift created, toast "Shift copied to {day}", cell highlights green (600ms fade)
8. If conflicts: `AvailabilityConflictDialog` appears, user can override or cancel

## Constraints

- **Same employee row only** — drop target IDs encode `employeeId:dayStr`; mismatched employee = no-op
- **Same day = no-op** — dropping back on the source day does nothing
- **One day per drag** — simple and predictable
- **Published shifts can be dragged** — the copy is a new draft shift, original is unchanged
- **Overlap detection** — validation catches if the target day already has conflicting times
- **Recurring shifts** — dragging a recurring shift always creates a standalone one-off copy (no recurrence_pattern, no recurrence_parent_id). This intentionally skips the RecurringActionDialog since the original is never modified — only a copy is created. The series remains intact.

## Technical Design

### DnD Context

Wrap the schedule table body in `<DndContext>` with:
- `PointerSensor` with `activationConstraint: { distance: 8 }` (matches planner)
- `handleDragStart`: store active shift in state for DragOverlay
- `handleDragEnd`: extract employeeId + day from `over.id`, validate, create copy
- `handleDragCancel`: clear active shift state

### Draggable ShiftCards

Each ShiftCard gets `useDraggable`:
```typescript
useDraggable({
  id: shift.id,
  data: { shift, employeeId, day }
})
```

Apply `cursor-grab` / `cursor-grabbing` styles. When dragging, original renders with `opacity-40`.

### Droppable Day Cells

Each day cell (td) in each employee row gets `useDroppable`:
```typescript
useDroppable({
  id: `${employeeId}:${format(day, 'yyyy-MM-dd')}`
})
```

Visual feedback on `isOver`: `bg-primary/5 ring-1 ring-primary/30 rounded-lg`.

### DragOverlay

Floating ghost rendered in `<DragOverlay>`:
- Shows shift time range + position
- Styled with `shadow-lg ring-2 ring-foreground/20 rounded-lg`
- Matches DragOverlayChip pattern from planner

### Copy Logic (handleDragEnd)

```
1. Extract shift from active.data.current
2. Parse employeeId and targetDay from over.id
3. Guard: if targetDay === sourceDay → return (no-op)
4. Guard: if employeeId !== shift.employee_id → return (no-op)
5. Extract local times from shift (timezone-aware):
   - Parse shift.start_time and shift.end_time as Date objects
   - Use getHours()/getMinutes() (local timezone) — NOT string slicing UTC ISO
   - This correctly handles overnight shifts (e.g., 10PM-2AM)
6. Build ShiftCreateInput:
   - employeeId: shift.employee_id
   - date: targetDay
   - startTime: extracted local HH:MM from step 5
   - endTime: extracted local HH:MM from step 5
   - position: shift.position
   - breakDuration: shift.break_duration
   - notes: shift.notes
   - (no recurrence_pattern, no recurrence_parent_id — always a one-off)
7. Call useCreateShift with client-side validation (see Validation section)
8. If valid → shift created, show toast, highlight cell
9. If conflicts → show AvailabilityConflictDialog with employeeName from
   shift.employee?.name and restaurantTimezone from component scope
```

### Component Changes

| File | Change |
|------|--------|
| `src/pages/Scheduling.tsx` | Wrap schedule table in DndContext, add DragOverlay, handleDragStart/End/Cancel |
| `src/pages/Scheduling.tsx` (ShiftCard) | Add useDraggable hook, cursor styles, opacity when dragging |
| `src/pages/Scheduling.tsx` (day cell td) | Extract to DroppableDayCell component with useDroppable, visual feedback |

### New Components

| Component | Purpose |
|-----------|---------|
| `DroppableDayCell` | Wraps each td with useDroppable + visual feedback |
| `ShiftDragOverlay` | Floating ghost card for DragOverlay |

Both should be extracted to `src/components/scheduling/` given Scheduling.tsx is already 17k+ lines.

### Z-Index / Stacking Context

The schedule table has a sticky employee name column with `z-10`. During drag, `@dnd-kit` applies `transform` styles that can create new stacking contexts. Mitigations:
- `DragOverlay` renders in a portal (dnd-kit default) — the ghost floats above everything
- The original card dims in place (`opacity-40`) with no transform — avoids stacking issues
- The 8px activation distance means the DragOverlay takes over before any visual overlap with the sticky column

## Validation

**Important:** The schedule view does NOT use `useShiftPlanner` (that hook is only in ShiftPlannerTab). Instead, create a lightweight `useShiftCopy` hook or inline the validation:

1. **Client-side overlap check** — filter existing shifts for the employee on the target day, check for time overlap using `shiftInterval.ts`
2. **Server-side conflict check** — call `checkShiftConflicts` RPC (from `useConflictDetection`) to verify availability + time-off
3. **Create** — call `useCreateShift().mutateAsync()` directly (already used by the schedule view)

This avoids instantiating `useShiftPlanner` (which carries its own week-navigation state and duplicate React Query subscriptions).

Checks:
- Overlap with existing shifts on target day
- Employee availability for target day-of-week
- Availability exceptions for target date
- Time-off requests covering target date

The `AvailabilityConflictDialog` requires `employeeName` and `timezone` props. Source these from:
- `employeeName`: `shift.employee?.name` (the shifts query joins employee data) — fall back to "Employee" if the join is missing
- `timezone`: `restaurantTimezone` from the Scheduling component's existing scope

## Accessibility

- Shift cards retain click-to-edit (drag requires 8px movement to activate)
- Keyboard users can still use existing "Add" button workflow
- `aria-label` on draggable cards: "Drag to copy shift"
- `role="button"` preserved on ShiftCard for click interaction

## Testing

| Test | Type |
|------|------|
| Copy shift to valid empty day | Unit |
| Same-day drop is no-op | Unit |
| Cross-employee drop is no-op | Unit |
| Conflict detected on target day | Unit |
| Conflict override creates shift | Unit |
| DragOverlay renders shift info | Unit |
| Droppable cell visual feedback | Unit |
| Recurring shift copies as one-off (no recurrence) | Unit |
| Overnight shift times extracted correctly | Unit |
| Time extraction uses local timezone, not UTC | Unit |
