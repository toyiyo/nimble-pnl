# Editable Week Templates — Plan

Design: `docs/superpowers/specs/2026-10-06-editable-week-templates-design.md`
Branch: `feature/editable-week-templates`

Each task follows TDD: write the failing test, write the code, run the test,
commit with explicit paths. Do the tasks in order.

## Task 1 — Migration and pgTAP tests

Files:

- `supabase/migrations/20261006120000_editable_week_templates.sql` (new)
- `supabase/tests/schedule_plan_templates_edit.test.sql` (new)
- `supabase/tests/schedule_plan_templates.test.sql` (limit 5 → 20)

Steps:

1. Write the pgTAP file first (design sections 10 and 11.1). Include a
   direct insert and a direct delete that fail after the policy change.
   Rewrite the payloads in the existing pgTAP file to the snapshot shape.
   Run `npm run test:db`. Confirm the new file fails.
2. Write the migration: shape validator, `update_schedule_plan_template`,
   `CREATE OR REPLACE` of save, apply and delete, and delete the INSERT and
   DELETE policies (design sections 7 and 11.1).
3. Run `npx supabase db reset` and `npm run test:db`. All files pass.
4. Run `npm run sync-types` or edit `src/integrations/supabase/types.ts` by
   hand for the new RPC, if the repo keeps RPC types there.

## Task 2 — Draft helpers

Files:

- `src/lib/weekTemplateDraft.ts` (new)
- `src/types/scheduling.ts` (add `TemplateDraft`, `DraftShift`, `DraftShiftInput`)
- `tests/unit/weekTemplateDraft.test.ts` (new)

Steps: write tests for every helper in design 6.1. Include the overnight
overlap, the Sunday overnight case, break hours, the dirty compare, and empty
rows. Add `dayOffsetToJsDay` with a test. Change `buildTemplateSnapshot` to
drop offsets outside 0–6, with a test (design 11.1 item 7).

## Task 3 — Hook mutations

Files:

- `src/hooks/useSchedulePlanTemplates.ts`
- `tests/unit/useSchedulePlanTemplates.test.ts` (new or extend)

Steps: add `createTemplate`, `updateTemplate` and
`MAX_SCHEDULE_PLAN_TEMPLATES = 20`. Test the RPC names and arguments, the
query invalidation, and the error toast. Test that `updateTemplate` sends the
raw `updated_at` string (design 11.1 item 4). Select explicit columns. Keep
`saveTemplate` for Copy Week.

## Task 4 — Shift dialog

Files:

- `src/components/scheduling/WeekTemplates/TemplateShiftDialog.tsx` (new)
- `tests/unit/TemplateShiftDialog.test.tsx` (new)

Steps: use `TimeInput` for Start and End. Add and edit modes, Days toggle group in add mode, Delete in edit mode,
inline overlap error from `findOverlap`, Start = End error. Test the submit
payload and the disabled state.

## Task 5 — Editor grid

Files:

- `src/components/scheduling/WeekTemplates/WeekTemplateEditor.tsx` (new)
- `tests/unit/WeekTemplateEditor.test.tsx` (new)

Steps: header with name input, dirty badge, Discard, Save, Apply, `⋯` menu.
Grid with sticky employee column, chips, `+` buttons, row totals, day totals,
Add employee select, Remove row with confirm, Inactive badge. Memoized rows. Server refetch rules and the "changed in another session"
notice (design 11.3 item 1). `+` always visible below `lg`.
Test add shift, edit shift, remove row, Save disabled with zero shifts.

## Task 6 — List, tab shell, apply dialog

Files:

- `src/components/scheduling/WeekTemplates/WeekTemplateList.tsx` (new)
- `src/components/scheduling/WeekTemplates/ApplyWeekTemplateDialog.tsx` (new)
- `src/components/scheduling/WeekTemplates/WeekTemplatesTab.tsx` (new)
- `src/components/scheduling/MergeModeField.tsx` (new, moved from Copy Week)
- `tests/unit/WeekTemplatesTab.test.tsx` (new)

Steps: loading, error and empty states; selection; New; Duplicate; Delete;
unsaved-changes confirm; `onDirtyChange`; `beforeunload`; mobile list/editor
switch; apply dialog with week picker, `MergeModeField`, result counts and
**View week**; Apply disabled while dirty.

## Task 7 — Page wiring and Copy Week link

Files:

- `src/pages/Scheduling.tsx`
- `src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx`

Steps: add the Week Templates tab trigger (`aria-label="Week Templates"`) and
content, gated by `canManageSchedule`. Add a fallback effect that runs only
when `isResolved` is true. Keep the dirty flag and guard `onValueChange` with
an `AlertDialog`. Wire `onViewWeek`. Pass `canManageTemplates` and
`onEditTemplates` to the Copy Week dialog. Use `MergeModeField` and the shared
limit constant in Copy Week.

## Task 8 — E2E

Files:

- `tests/e2e/week-templates.spec.ts` (new)

Steps: follow design section 10. Use `generateTestUser()` and the helpers in
`tests/helpers/e2e-supabase`. Use role and label selectors.

## Verify

`npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:db`,
`npm run build`, and `npx playwright test tests/e2e/week-templates.spec.ts`.
