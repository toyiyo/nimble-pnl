# Plan: payroll schedule-vs-clock audit

Date: 2026-08-18
Design: docs/superpowers/specs/2026-08-18-payroll-clock-audit-design.md
Branch: `feature/payroll-clock-audit`
Worktree: `.claude/worktrees/payroll-clock-audit`

## Context

The feature code exists in the worktree, uncommitted. The user approved the UI
in the browser. The tasks below commit the code in reviewable slices, close the
gaps from the design review, and add the E2E test the user requires.

## Tasks

### Task 1 — commit the pure audit logic with its tests

Files:
- `src/utils/scheduleClockAudit.ts`
- `tests/unit/scheduleClockAudit.test.ts`

Steps:
1. Run `npx vitest run tests/unit/scheduleClockAudit.test.ts`. All 17 tests pass.
2. Commit both files: `feat(payroll): add the schedule-vs-clock audit logic`.

### Task 2 — exclude draft shifts from the audit (TDD)

Files:
- `tests/unit/scheduleClockAudit.test.ts`
- `src/utils/scheduleClockAudit.ts`

Steps:
1. Add a failing test: a shift with `is_published: false` and no punches
   produces no `missing_clock` row.
2. Add a second test: a shift with `is_published: null` (legacy row) still
   counts. Treat only the explicit `false` as a draft.
3. Add the filter next to the `cancelled` filter
   (src/utils/scheduleClockAudit.ts:206).
4. Run the unit file. All tests pass.
5. Commit: `feat(payroll): exclude draft shifts from the clock audit`.

### Task 3 — commit the type change and the data hook

Files:
- `src/utils/timePunchImport.ts` (adds `shift_id?: string | null` to
  `TimePunchInsert`, line 114)
- `src/hooks/useScheduleClockAudit.ts`

Steps:
1. Run `npm run typecheck`.
2. Commit: `feat(payroll): add the schedule-vs-clock audit data hook`.

### Task 4 — fix the review findings in the panel and the dialog

Files:
- `src/components/payroll/ScheduleClockAudit.tsx`
- `src/components/payroll/RecordShiftClockDialog.tsx`
- `src/pages/Payroll.tsx`
- `tests/unit/ScheduleClockAudit.test.tsx`

Steps (from the Phase 2.5 review, see the design doc):
1. Employees (CRITICAL): change the `ScheduleClockAudit` container to call
   `useEmployees(restaurantId, { status: 'all' })`. Delete the `employees`
   prop from `ScheduleClockAuditProps`. Keep `employees` on the view props.
   Delete the `employees` prop from the call in src/pages/Payroll.tsx:727.
2. Colors (MAJOR): change `STATUS_DOT`, `STATUS_BADGE`, `renderTimes`, and the
   dialog delta text to the semantic tokens `warning`, `info`, `success`
   (tailwind.config.ts:43-53). Delete the amber/blue/emerald classes and the
   manual `dark:` overrides.
3. Break switch (MINOR): change the switch text to a `Label htmlFor` wired to
   the `Switch` id in RecordShiftClockDialog.tsx.
4. Update `tests/unit/ScheduleClockAudit.test.tsx` for the prop change. Run
   the file. All tests pass.
5. Run `npm run typecheck` and `npm run lint`.
6. Commit: `feat(payroll): add the schedule-vs-clock audit panel`.

### Task 5 — virtualize the audit row list (MAJOR review finding)

File: `src/components/payroll/ScheduleClockAudit.tsx`

Steps:
1. Wrap the row list in a max-height scroll container.
2. Use `useVirtualizer` from `@tanstack/react-virtual` with the CLAUDE.md
   pattern: stable row `key` (`row.key`), `data-index`,
   `ref={virtualizer.measureElement}`, `overscan: 10`.
3. Keep the empty and all-clear states outside the virtualizer.
4. Add or update a unit test that renders 150 rows and checks the container
   renders a subset.
5. Run the unit file, `npm run typecheck`, `npm run lint`.
6. Commit: `perf(payroll): virtualize the audit row list`.

### Task 6 — E2E test (user requirement)

File: `tests/e2e/schedule-clock-audit.spec.ts` (new)

Follow tests/e2e/payroll-complete-journey.spec.ts:1-120.

Steps:
1. `beforeEach`: clear cookies, `generateTestUser()`,
   `signUpAndCreateRestaurant(page, testUser)`
   (tests/helpers/e2e-supabase.ts:1152, :1171).
2. Create one hourly employee through the `/scheduling` UI with the selectors
   from the payroll journey spec.
3. Seed one published shift for yesterday (restaurant timezone) through the
   injected browser Supabase client (`exposeSupabaseHelpers`,
   tests/helpers/e2e-supabase.ts:60). Insert into `shifts` with
   `status: 'scheduled'`, `is_published: true`.
4. Open `/payroll`. Set the period so it contains yesterday if the default
   period does not.
5. Assert the audit panel shows the employee with the `No clock data` status.
6. Click `Enter clock data`. Assert the clock-in input has the shift start
   time. Save.
7. Assert the row moves to the Matched tab. Assert the payroll table shows
   hours above zero for the employee.
8. Escape the dynamic employee name before use in a RegExp:
   `name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.
9. Run the spec with the dev server + local Supabase up, in the foreground,
   bounded by the Bash tool timeout.
10. Commit: `test(payroll): E2E for the schedule-vs-clock audit`.

### Task 7 — full verification

1. `npm run test` (full unit suite).
2. `npm run typecheck`, `npm run lint`, `npm run build`.
3. The E2E spec from Task 6 passes locally.

## Out of scope

- The dev demo route (`src/pages/dev/`) stays out of the PR.
- No migration, no edge function, no RLS change.
