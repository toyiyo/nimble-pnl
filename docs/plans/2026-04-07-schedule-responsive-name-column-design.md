# Design: Responsive Schedule Name Column

**Date:** 2026-04-07
**Status:** Approved

## Problem

In the schedule planner view (`Scheduling.tsx`), the employee name column has `min-w-[180px]` with no max-width constraint. Each name cell contains an avatar, full name, role, hours badge, and edit button — none truncated. On tablet/mobile devices, this column expands to 250-300px, pushing the 7 day columns (each `min-w-[130px]`) off-screen. The `overflow-x-auto` wrapper just enables horizontal scrolling, making the planner unusable for its primary purpose: managers viewing and planning the entire week at a glance.

The same issue exists in `TemplateGrid.tsx` (`grid-cols-[200px_repeat(7,1fr)]`) and `StaffingOverlay.tsx`.

## Solution: Responsive Compact Mode

Introduce a CSS breakpoint at `md` (768px). Below this breakpoint, the name column collapses to show only the avatar initials and weekly hours. Full name and role appear in a tooltip on hover/tap.

### Desktop (>768px) — No Change

Current layout preserved: avatar + full name + role + hours badge + edit button.

### Tablet/Mobile (<=768px) — Compact Mode

- Name column width: ~56px (avatar + hours text)
- Content: avatar initials circle + hours below
- Full name: accessible via tooltip on hover/tap
- Day columns: `min-w` reduced from 130px to ~80px
- Table `min-w` reduced from 900px to fit within viewport
- All 7 days visible without horizontal scrolling on screens >=375px

### Components Affected

1. **`src/pages/Scheduling.tsx`** (lines 1130-1310) — Main schedule table
   - Header `<th>` for name column: add responsive width classes
   - Employee name `<td>`: conditionally render compact vs full layout
   - Day column `<th>` and `<td>`: reduce min-width on mobile

2. **`src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`** — Template planner grid
   - Change `grid-cols-[200px_repeat(7,1fr)]` to responsive variant

3. **`src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx`** — Staffing overlay grid
   - Same grid-cols fix as TemplateGrid

### Tooltip Implementation

Use the existing shadcn `Tooltip` component (already in the project) wrapping the compact avatar. On touch devices, tooltip shows on tap. No custom tooltip needed.

### Accessibility

- Avatar has `aria-label` with full employee name
- Tooltip content includes name and role for screen readers
- Keyboard focus on avatar triggers tooltip

## Out of Scope

- Day-by-day swipe navigation (separate mobile redesign)
- Drag-and-drop adjustments for mobile (existing behavior unchanged)
- EmployeeSidebar responsive changes (separate concern)
