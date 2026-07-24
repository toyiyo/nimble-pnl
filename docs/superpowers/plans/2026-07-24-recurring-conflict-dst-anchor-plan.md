# Plan: Shift-date DST anchor for recurring availability conflicts

Spec: `docs/superpowers/specs/2026-07-24-recurring-conflict-dst-anchor-design.md`

## Tasks

### Task 1 — RED: failing recurring cross-DST anchor tests
- Add a `describe('formatConflictLine – recurring conflict uses shift-date anchor')`
  block to `tests/unit/conflictFormatUtils.test.ts`, mirroring the existing
  exception-anchor block.
- Case A: `conflict_type: 'recurring'`, message `Shift on 2026-01-15 is outside
  employee availability`, `available_start '04:00:00'` / `available_end
  '04:30:00'`, `referenceDate` = June 23 2026 (summer). Assert output contains
  `10:00 PM – 10:30 PM` (fails on current code → renders `11:00 PM`).
- Case B: symmetric — message `Shift on 2026-06-23 …`, `available_start
  '03:00:00'` / `'03:30:00'`, `referenceDate` = Jan 15 2026 (winter). Assert
  `10:00 PM – 10:30 PM` (fails on current code → renders `9:00 PM`).
- Run the file; confirm the two new assertions FAIL (RED).

### Task 2 — GREEN: unconditional shift-date anchor
- In `src/lib/conflictFormatUtils.ts`, replace the exception-only ternary in
  `formatConflictLine` with `const anchor = extractDateAnchor(conflict.message)
  ?? referenceDate;` and an explanatory comment (SQL comparison-frame rationale).
- Update the preceding comment that still says the extraction is exception-only.
- Run the file; confirm all tests pass (GREEN), including the pre-existing
  exception + same-DST recurring tests.

### Task 3 — Verify full suite locally
- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` — all green.

## Dependencies
- Task 2 depends on Task 1 (RED before GREEN). Task 3 depends on Task 2.

## Skip notes
- Phase 2.5 design review: skipped — no DB/edge-function/UI surface (logic-only
  util change).
- Phase 5 UI review: skipped — no component/style files touched.
