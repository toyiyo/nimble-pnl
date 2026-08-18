# Design: payroll schedule-vs-clock audit

Date: 2026-08-18
Branch: `feature/payroll-clock-audit`
Status: user approved the UI in the browser. The code exists in the worktree. This doc records the design.

## Problem

Payroll pays only from `time_punches` (src/hooks/usePayroll.tsx:205). A scheduled
employee who forgets to clock in gets no pay. Managers have no view that compares
the schedule with the clock data. Managers also have no fast way to enter the
missed clock data from a scheduled shift.

## Goals

1. Show a comparison of scheduled shifts and clock sessions for the pay period.
2. Flag shifts with no clock data, open clocks, and large time deltas.
3. Flag clock sessions with no scheduled shift.
4. Let a manager record clock punches from a scheduled shift in two clicks.
5. Cover the full journey with a Playwright E2E test (user requirement).

## Non-goals

- No schema change. The `time_punches` table already has `shift_id`.
- No edge function. All reads go through existing RLS-scoped queries.
- No auto-fix. The manager confirms each entry in a dialog.
- The dev demo route stays out of the PR (preview scaffolding only).

## Design

### 1. Pure audit logic — `src/utils/scheduleClockAudit.ts` (new)

- `buildWorkSessions(punches)` (src/utils/scheduleClockAudit.ts:110) folds raw
  punches into work sessions. A session is `{employeeId, clockIn, clockOut|null,
  breakMinutes, punchIds}`.
- `auditScheduleAgainstClocks(shifts, punches, rangeStart, rangeEnd, opts)`
  (src/utils/scheduleClockAudit.ts:183) pairs each shift with the nearest
  session for the same employee. It returns rows with one of five statuses:
  `missing_clock`, `open_clock`, `time_mismatch`, `matched`, `unscheduled_clock`.
- `DEFAULT_TOLERANCE_MINUTES = 10` (src/utils/scheduleClockAudit.ts:88). A delta
  above the tolerance makes the row a `time_mismatch`.
- Rules: only shifts that overlap the range count. A shift that ends in the
  future, with no session, does not count as `missing_clock` (the employee did
  not work yet). Cancelled shifts are excluded
  (src/utils/scheduleClockAudit.ts:206).
- Gap to close in the build phase: the audit must also exclude draft shifts
  (`is_published === false`). The audit compares the schedule the employees
  saw. A draft shift must not flag `missing_clock`. Add the filter and a unit
  test.
- Formatters: `formatDeltaMinutes` (:319), `formatMinutesAsHours` (:333).

### 2. Data hook — `src/hooks/useScheduleClockAudit.ts` (new)

- Shifts query key: `['shifts', 'clock-audit', restaurantId, start, end]`
  (src/hooks/useScheduleClockAudit.ts:30) with a direct `.from('shifts')`
  select (:33). This mirrors the pattern in src/hooks/useShifts.tsx:84.
- Punches come from the existing `useTimePunches` hook (:58) with a widened
  fetch window from `bufferPunchFetchRange` (src/utils/punchWindow.ts:17) so an
  overnight session near the range edge is not cut.
- The hook memoizes `auditScheduleAgainstClocks` (:62) and returns
  `{rows, summary, loading, error}`.

### 3. Panel — `src/components/payroll/ScheduleClockAudit.tsx` (new)

- `ScheduleClockAudit` is the container. It holds the tolerance state and calls
  `useScheduleClockAudit`. It renders `ScheduleClockAuditView`.
- `ScheduleClockAuditView` is presentational. It takes rows, summary, loading,
  error, tolerance, and `onToleranceChange` as props. The split lets a dev
  demo and unit tests drive the view with sample data, with no session.
- UI: Apple underline tabs with `role="tab"` per the CLAUDE.md tab pattern.
  Tabs: Needs attention, Mismatched, Unscheduled, Matched. A tolerance
  `Select` (5/10/15/30 min). Status dot + badge per row with semantic tokens.
- One `RecordShiftClockDialog` renders at list level (single dialog pattern).
- States: skeleton on loading, error message, all-clear message when the
  summary has no problems.

### 4. Entry dialog — `src/components/payroll/RecordShiftClockDialog.tsx` (new)

- Prefills clock-in and clock-out from the shift times through
  `toWallClockInput` (src/hooks/useRestaurantClock.ts:22) in the restaurant
  timezone.
- `outOnly` mode for `open_clock` rows: the dialog writes only the missing
  clock-out.
- An optional break switch inserts a break pair at the shift midpoint.
- Save builds `TimePunchInsert[]` and calls `useBulkCreateTimePunches`
  (src/hooks/useTimePunches.tsx:410). Each punch carries `shift_id`
  (src/components/payroll/RecordShiftClockDialog.tsx:97), the note
  `Manager entry from the scheduled shift`, and `device_info: 'manager-entry'`.
  The audit trail stays queryable.
- On success the dialog invalidates `['payroll', restaurantId]` (:123) so the
  payroll table refreshes with the new hours.

### 5. Type change — `src/utils/timePunchImport.ts`

- `TimePunchInsert` gains `shift_id?: string | null`
  (src/utils/timePunchImport.ts:114). The `time_punches` table already has the
  column; the insert type did not expose it.

### 6. Page integration — `src/pages/Payroll.tsx`

- The panel renders between the incomplete-punches alert and the payroll table
  (src/pages/Payroll.tsx:722-729). It receives the same `start` and `end` that
  the payroll table uses, so both views cover one period.
- Employee names: the container fetches its own list with
  `useEmployees(restaurantId, { status: 'all' })`. The payroll table also uses
  `status: 'all'` (src/hooks/usePayroll.tsx:152-154) so a deactivated employee
  keeps a real name in both views. The page-level `employees` variable
  (src/pages/Payroll.tsx:178) is active-only and must not feed the panel.

## Design review findings (Phase 2.5, folded in)

Both reviewers confirmed the premises: payroll pays only from `time_punches`,
and `time_punches` has `shift_id`
(supabase/migrations/20251114100100_create_time_tracking_tables.sql:8). RLS,
the write path, query keys, dialog structure, states, and timezone handling
passed. The build phase must close these findings:

1. CRITICAL (both reviewers): exclude draft shifts
   (`is_published === false`) in `auditScheduleAgainstClocks`
   (src/utils/scheduleClockAudit.ts:205-208). Without the filter a manager can
   write real punches for a shift the employee never saw. Add unit tests.
2. CRITICAL (frontend): the container must fetch employees with
   `{ status: 'all' }`. The active-only list shows `Unknown employee` for a
   deactivated employee with period activity.
3. MAJOR (frontend): use the semantic tokens `warning`, `info`, `success`
   (tailwind.config.ts:43-53, src/index.css:32-39) in `STATUS_DOT`,
   `STATUS_BADGE`, `renderTimes`, and the dialog delta text. Delete the
   hardcoded amber/blue/emerald classes and the manual `dark:` overrides.
4. MAJOR (frontend): virtualize the row list with `@tanstack/react-virtual`
   inside a max-height scroll container. A two-week period at a large
   restaurant can pass 100 rows, the CLAUDE.md threshold.
5. MINOR (frontend): make the break-switch text a `Label htmlFor` wired to the
   `Switch` in RecordShiftClockDialog.tsx:207-222.
6. MINOR (frontend, accepted as-is): the tab list matches the CLAUDE.md
   Apple-tabs convention, which omits `aria-controls`. No change.

## Security

- All reads go through the authenticated Supabase client. RLS scopes `shifts`
  and `time_punches` by `restaurant_id`.
- Writes use the existing `useBulkCreateTimePunches` path. No new privilege.
- No service-role key in client code. No new edge function.

## Tests

### Unit (exist)

- `tests/unit/scheduleClockAudit.test.ts` — 17 tests on the pure logic:
  session building, pairing, all five statuses, tolerance edges, overnight
  shifts, future shifts, formatters.
- `tests/unit/ScheduleClockAudit.test.tsx` — 4 tests on the view + dialog:
  prefill value, bulk insert payload with `shift_id`, all-clear state, tab
  switch.

### E2E (to write) — `tests/e2e/schedule-clock-audit.spec.ts`

User requirement: "Ensure e2e testing." The spec follows
tests/e2e/payroll-complete-journey.spec.ts:1-120:

1. `beforeEach`: `generateTestUser()` + `signUpAndCreateRestaurant(page, testUser)`
   (tests/helpers/e2e-supabase.ts:1152, :1171).
2. Create an hourly employee through the `/scheduling` UI (same selectors as
   the payroll journey spec).
3. Seed a published shift for yesterday in the restaurant timezone through the
   injected browser Supabase client (`exposeSupabaseHelpers`,
   tests/helpers/e2e-supabase.ts:60). Yesterday guarantees the shift is in the
   past, so the row is `missing_clock`.
4. Open `/payroll`. Assert the audit panel shows the employee under
   Needs attention with the `No clock data` status.
5. Click `Enter clock data`. Assert the dialog prefills the shift times. Save.
6. Assert the row moves to Matched and the payroll table shows the hours.
7. Escape dynamic employee names before use in a name RegExp
   (memory/lessons.md: escape with `replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`).

## Risks

- Timezone: all wall-clock conversions go through `useRestaurantClock` /
  `restaurantClock.ts` helpers. Unit tests pin a fixed timezone.
- Pay-period edge: `bufferPunchFetchRange` widens the punch fetch, and the
  audit clamps rows to the visible range, so edge sessions pair correctly.
- Draft shifts: the build phase adds the `is_published === false` exclusion,
  so a manager sees only the schedule the employees saw.
