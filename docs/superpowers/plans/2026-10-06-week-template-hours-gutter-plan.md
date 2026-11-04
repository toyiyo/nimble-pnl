# Plan: Week Template Editor HOURS Column Gutter

Design: docs/superpowers/specs/2026-10-06-week-template-hours-gutter-design.md

## Task 1: Add the HOURS gutter (TDD)

1. RED: In `tests/unit/WeekTemplateEditor.test.tsx`, add a test. Render a
   draft with one shift. Check that the `Hours` column header, the row
   hours cell (`8h`) and the TOTAL hours cell have the class `pr-12`.
2. Run `npx vitest run tests/unit/WeekTemplateEditor.test.tsx`. The new
   test fails.
3. GREEN: In `src/components/scheduling/WeekTemplates/WeekTemplateEditor.tsx`,
   add `const HOURS_CELL_GUTTER = 'pr-12';` with a short comment about the
   right-edge overlays. Use it in the three HOURS cells (lines 144, 440,
   480) in place of the right side of `px-3` (use `pl-3`).
4. Run the test file again. All tests pass.
5. Commit `fix(scheduling): keep template hours clear of edge overlays`.

## Dependencies

None. One task.
