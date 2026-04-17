# Planner Shift-to-Template Bucketing Fix

## Problem

When two shift templates across different areas share the same `(start_time, end_time, position, days)` — e.g., "Open-weekend-csc" (Cold Stone) and "Open-weekend-wtz" (Wetzel's) both at 10a-4:30p Server — shifts display in the wrong template row.

**Root cause:** The `shifts` table has no foreign key to `shift_templates`. The planner's `buildTemplateGridData` function uses `findMatchingTemplate` which matches by time/position/day only, ignoring area. `.find()` returns the first match (alphabetical by area), so all ambiguous shifts bucket into one row.

**User impact:** After assigning an employee to a template via drag-and-drop, the shift appears in the wrong template row. The toast message shows the correct template, but the grid shows it under a different area's template. This creates confusion about which area the employee is actually assigned to.

## Solution

Add a nullable `shift_template_id` foreign key to the `shifts` table. Store the template ID when creating shifts from the planner. Use it for deterministic bucketing in `buildTemplateGridData`.

### Database

- Add `shift_template_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL` to `shifts` table (nullable for backward compatibility with legacy/imported shifts)

### Backend (shift creation)

- Update `buildShiftPayload` in `useShiftPlanner.ts` to accept and pass through `shift_template_id`
- Update `ShiftCreateInput` interface to include optional `shiftTemplateId`
- Thread the template ID from `handleAssignDay`/`handleAssignAll` in `ShiftPlannerTab.tsx` through to `validateAndCreate`/`forceCreate`

### Display logic

- Update `buildTemplateGridData` to check `shift.shift_template_id` first. If present, bucket directly by template ID. Fall back to `findMatchingTemplate` only for shifts without a template ID (legacy data).

### TypeScript types

- Add `shift_template_id?: string | null` to the `Shift` interface
- Regenerate Supabase types

## Scope

- Migration: 1 new column, 1 foreign key
- TypeScript: `Shift` interface, `ShiftCreateInput`, `buildShiftPayload`, `buildTemplateGridData`, `findMatchingTemplate` (kept as fallback)
- Components: `ShiftPlannerTab.tsx` (thread template ID through creation flow)
- Tests: Unit tests for `buildTemplateGridData` with template ID bucketing
- No UI changes needed

## Out of scope

- Backfilling `shift_template_id` for existing shifts (they continue using the fallback matching)
- Changing the drag-and-drop collision detection (rows are correctly rendered; the display bug was what made drops appear wrong)
