# Design: Area filter in schedule print/PDF

**Date:** 2026-06-23
**Branch:** `feature/schedule-print-area-filter`
**Status:** Approved

## Problem

The schedule grid (`src/pages/Scheduling.tsx`) already exposes **Area** and
**Position** filter dropdowns in the toolbar next to the **Print** button. When the
user prints, `positionFilter` and `groupBy` are forwarded into
`ScheduleExportDialog` and `generateSchedulePDF` — but **`areaFilter` is never
passed through**. Filtering the grid to an area (e.g. "Wetzel's") therefore has no
effect on the printed PDF.

This is effectively a bug: Position is respected on the printout, Area is silently
dropped. The user wants to print, e.g., **Wetzel's + backroom** employees only.

## Decision

Thread the existing `areaFilter` grid state through the print pipeline and apply it
**exactly like `positionFilter`** — single-select, `'all'` = no filter, **AND**
semantics across the two dimensions. This mirrors the canonical grid helper
`filterEmployeesForScheduleView` (`Scheduling.tsx:142`), which already does
`area === areaFilter` **and** `position === positionFilter`.

No new dialog controls (user chose "just respect grid filters" over adding
selectors inside the print dialog). The PDF/print becomes WYSIWYG with the grid's
current Area + Position filters.

## Changes

### 1. `src/utils/scheduleExport.ts` (measured by SonarCloud)
- Add `areaFilter?: string` to `ScheduleExportOptions`.
- Extend the shift-filtering predicate: a shift is kept when the owning employee
  matches **both** the active position filter **and** the active area filter.
  Guard each dimension with `filter && filter !== 'all'`.
- Extend the PDF "Filtered:" subtitle to list all active filters on one line, area
  first: `Filtered: Wetzel's · backroom`. Replaces the current position-only line.

### 2. `src/components/scheduling/ScheduleExportDialog.tsx` (Sonar-excluded; E2E-covered)
- Add `areaFilter?: string` prop.
- Apply the area filter alongside the position filter in the shift-filtering memo;
  rename `positionFilteredShifts` → `filteredShifts` for accuracy and update its two
  consumers (`allEmployeesWithShifts`, `getShiftDisplay`).
- Show the same combined "Filtered:" label in the preview header.
- Pass `areaFilter` into `generateSchedulePDF` in `handleExport`.

### 3. `src/pages/Scheduling.tsx` (Sonar-excluded)
- Pass `areaFilter={areaFilter}` to `<ScheduleExportDialog>` (one line).

### 4. Tests
- **Unit** (`tests/unit/scheduleExport.test.ts`): extend `makeEmployee` to accept an
  `area`; add cases — (a) area-only filter narrows rows; (b) area + position together
  apply AND semantics; (c) `areaFilter: 'all'`/undefined is a no-op; (d) combined
  "Filtered:" subtitle text is emitted.
- **E2E** (`tests/e2e/schedule-print-export.spec.ts`): seed employees across two
  distinct areas (so the `#area-filter` Select renders — it only shows when
  `areas.length > 1`), set the grid area filter, open Print, assert the dialog list
  narrows to that area.

## Edge cases
- Employees with **no `area`** are excluded when an area filter is active
  (`undefined !== 'Wetzel's'`) — matches grid behavior, correct.
- Over-filtering to zero employees → empty PDF table / Download disabled at 0
  selected. Pre-existing behavior for position over-filtering, unchanged.
- `Scheduling.tsx:441` already resets `areaFilter` to `'all'` when the selected area
  disappears, so the value forwarded to the dialog is always valid.

## Coverage strategy
`scheduleExport.ts` lives under `src/utils/**`, which is **not** in
`sonar.coverage.exclusions`, so its new branches must reach ≥80% new-code coverage
via the unit tests above. `ScheduleExportDialog.tsx` (`src/components/**/*.tsx`) and
`Scheduling.tsx` (`src/pages/**/*.tsx`) are Sonar-excluded and covered by E2E.

## Rejected alternative
Dedicated Area/Position selectors inside the print dialog (pre-filled from grid,
overridable). More flexible but more UI surface and diverges from the single-select
grid filters; the user opted for the simpler grid-respecting behavior.

## Design review (Phase 2.5) — folded feedback
Frontend reviewer: no critical issues; approach (mirror `positionFilter`) endorsed.

- **Shift-level vs employee-level filtering (clarification).** The export path filters
  at the **shift** level (`shifts.filter(s => emp?.area === areaFilter && …)`), then
  derives the employee list from the surviving shifts. The grid helper
  `filterEmployeesForScheduleView` filters at the **employee** level. The print dialog
  only ever lists employees who have a shift this week, so the two converge; the area
  predicate (`emp.area === areaFilter`) is identical in both. We deliberately keep the
  existing shift-level approach to stay symmetric with the current `positionFilter`
  path — `areaFilter` is added as a parallel clause in the same predicate.
- **`area: undefined` test case (accepted).** Add an explicit unit case asserting an
  employee with no `area` is excluded when an area filter is active.
- **Rename `positionFilteredShifts` → `filteredShifts` (accepted).** Update BOTH
  consumers — the `allEmployeesWithShifts` memo AND `getShiftDisplay` (line ~106).

### Decided trade-offs (deferred, with rationale)
- **Dialog restyle to the CLAUDE.md icon-box / `p-0 gap-0` pattern — DEFERRED.** The
  reviewer noted `ScheduleExportDialog`'s `DialogContent` predates the current dialog
  styling guide. Restyling the whole dialog is unrelated to area filtering and out of
  scope for this fast, minimal change; tracked as separate polish.
- **Long area-name overflow in the centered preview label — DEFERRED.** Pre-existing
  for `positionFilter` too; cosmetic, not a regression.
- **`colSpan={8}` hard-coded in the preview empty/overflow rows — NO ACTION.**
  Pre-existing, static, untouched by this change.
