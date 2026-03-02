# Shift Planner UI Enhancements Design

**Date:** 2026-03-01
**Status:** Approved

## Overview

Five independent UI enhancements to the Shift Planner and Schedule views, improving drag-and-drop visibility, day indicators, assignment flexibility, export options, and form pre-population.

## Enhancement 1: DragOverlay for Visible Drag Ghost

**Problem:** When dragging employees from the sidebar onto shift cells, the dragged element renders behind shift views because `@dnd-kit` applies inline transforms with no z-index, while other UI elements have higher stacking contexts.

**Solution:** Add `@dnd-kit`'s `DragOverlay` component to `ShiftPlannerTab.tsx`. DragOverlay renders via a portal at a high z-index, ensuring the ghost is always visible.

**Implementation:**
- Track `activeDragId` via `onDragStart` / `onDragEnd` state
- Render a name-only employee chip inside `<DragOverlay>`
- Hide the original sidebar element with opacity during drag
- DragOverlay automatically handles z-index via portal rendering

**Files:** `ShiftPlannerTab.tsx`, `EmployeeSidebar.tsx`

## Enhancement 2: Always-Visible Day Indicators on Shift Rows

**Problem:** When a shift template applies to only certain days (e.g., Mon-Fri but not weekends), the current dimming only appears during drag. Managers cannot glance at the planner and understand which days each shift covers.

**Solution:** Show visual state at all times (not just during drag):
- **Active days:** Normal background with subtle left-border accent (`border-l-2 border-primary`)
- **Inactive days:** Diagonal CSS stripe/hatched pattern via `repeating-linear-gradient`, reduced opacity, no drop zone functionality

**Files:** `ShiftCell.tsx`, possibly `TemplateGrid.tsx`

## Enhancement 3: Day-vs-Shift Assignment Popover

**Problem:** Dropping an employee onto a shift auto-assigns for that single day only. Managers often want to assign an employee to the entire shift (all applicable days for the week).

**Solution:** On `handleDragEnd`, instead of immediately creating the shift, show a small popover anchored near the drop cell:
- Title: "Assign {employee name} to {shift name}"
- Button 1: "This day only" — creates a single shift (current behavior)
- Button 2: "All {N} days this week" — loops through the template's active days for the current week, creating a shift for each

The popover auto-dismisses on selection or click-outside (cancels the assignment).

**Files:** `ShiftPlannerTab.tsx` (new `AssignmentPopover` component or inline), `useShiftPlanner.ts` (bulk assignment helper)

## Enhancement 4: PDF + CSV Export in Planner View

**Problem:** The Planner view has no export functionality. The Schedule view has PDF export but no CSV.

**Solution:** Add export capability to the Planner view toolbar:
- Export button next to week navigation controls
- Dialog offering both PDF and CSV download
- PDF: Reuse existing `jspdf` + `jspdf-autotable` pattern from `scheduleExport.ts`
- CSV: New `generatePlannerCSV()` utility

**CSV Format:**
```
Employee,Shift,Day,Date,Start,End,Position,Break
Sarah,Morning,Mon,2026-03-02,9:00,17:00,Server,30
John,Morning,Mon,2026-03-02,9:00,17:00,Cook,30
```

**Files:** New `src/utils/plannerExport.ts`, new `PlannerExportDialog.tsx`, `ShiftPlannerTab.tsx` (toolbar button)

## Enhancement 5: Auto-Select Employee/Position on Add in Schedule View

**Problem:** When clicking the "Add" button in an employee's schedule row, the ShiftDialog opens with only the date pre-filled. The employee and position fields are blank, requiring redundant selection.

**Solution:** Modify `handleAddShift` in `Scheduling.tsx` to accept an employee object. When invoked from an employee's row, pass the employee context to `ShiftDialog`:
- Pre-select the employee (disable the field since it's contextual)
- Pre-fill position from the employee's profile `position` field
- Keep date pre-fill as-is

**Files:** `Scheduling.tsx` (handler + props), `ShiftDialog.tsx` (accept and use pre-filled employee/position)

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Drag overlay content | Name only | Clean, matches sidebar appearance |
| Day indicator visibility | Always visible | Managers need to glance, not just drag |
| Assignment dialog | Simple 2-button popover | Fast, minimal friction |
| Export location | Planner view (PDF + CSV) | Schedule already has PDF |
| Position auto-fill source | Employee profile | Stable, doesn't depend on shift history |

## Dependencies

- `@dnd-kit/core` already installed (v6.3.1)
- `jspdf` and `jspdf-autotable` already installed
- No new packages required
