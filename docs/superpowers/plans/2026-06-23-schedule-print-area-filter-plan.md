# Plan: Area filter in schedule print/PDF

Design: `docs/superpowers/specs/2026-06-23-schedule-print-area-filter-design.md`

TDD throughout. Mirror the existing `positionFilter` flow exactly; AND semantics
across area + position; `'all'`/undefined = no filter.

## Task 1 — `scheduleExport.ts`: areaFilter in PDF generation (RED→GREEN→COMMIT)
**File:** `src/utils/scheduleExport.ts`, `tests/unit/scheduleExport.test.ts`
1. RED — extend `makeEmployee` in the test to accept an optional `area`; add cases:
   - area-only filter narrows body rows to that area's employees;
   - area + position together apply AND semantics (only employees matching both);
   - `areaFilter: 'all'` (and omitted) is a no-op (all rows);
   - PDF subtitle emits combined `Filtered: <area> · <position>` (assert via `mockText`).
2. GREEN —
   - add `areaFilter?: string` to `ScheduleExportOptions`;
   - keep a shift when its employee matches active position **and** active area
     (guard each with `f && f !== 'all'`);
   - build subtitle from `[areaFilter, positionFilter].filter(f => f && f !== 'all')`,
     render one line `Filtered: <parts joined by " · ">` when non-empty.
3. Run `npm test -- scheduleExport`; COMMIT.

## Task 2 — `ScheduleExportDialog.tsx`: accept + apply areaFilter (depends on Task 1)
**File:** `src/components/scheduling/ScheduleExportDialog.tsx`
1. Add `areaFilter?: string` to props and destructure.
2. Rename `positionFilteredShifts` → `filteredShifts`; apply area + position in the
   memo; add `areaFilter` to deps; update consumers (`allEmployeesWithShifts`,
   `getShiftDisplay`).
3. Preview header: render the combined "Filtered:" label (area first), replacing the
   position-only line.
4. Pass `areaFilter` into `generateSchedulePDF` in `handleExport`.
5. `npm run typecheck`; COMMIT. (Behavior covered by Task 4 E2E; component is
   Sonar-excluded.)

## Task 3 — `Scheduling.tsx`: forward areaFilter (depends on Task 2)
**File:** `src/pages/Scheduling.tsx`
1. Add `areaFilter={areaFilter}` to the `<ScheduleExportDialog>` props (~line 2109).
2. `npm run typecheck`; COMMIT.

## Task 4 — E2E: area filter narrows print dialog (depends on Tasks 2–3)
**File:** `tests/e2e/schedule-print-export.spec.ts`
1. Seed employees across two distinct `area` values (so `#area-filter` renders —
   it only shows when `areas.length > 1`); give each a shift this week.
2. Set the grid `#area-filter` to one area, open Print, assert the dialog employee
   list contains only that area's employees and excludes the other area's.
3. Run the spec; COMMIT.

## Verify (Phase 8)
`npm test` (unit), `npm run typecheck`, `npm run lint`, `npm run build`, and the new
E2E spec. SonarCloud new-code coverage ≥80% comes from Task 1 unit tests on
`scheduleExport.ts` (the only measured file).
