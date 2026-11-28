# Availability Local Time — PR 2 (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frontend read and write `employee_availability.start_time_local` and `end_time_local`, so that availability shows the time that the manager entered on every date.

**Architecture:** PR 1 (merged, PR 874) added the local columns, a sync trigger, the RPC changes and the edge-function changes. This PR moves every frontend writer to the local columns and every reader to the local values. `computeEffectiveAvailability` becomes the single point that turns raw rows into local-time slots. Recurring slots copy the local columns. Exception slots convert their UTC times with the exception date as the anchor. All downstream readers then stop the conversion.

**Tech Stack:** React 18, TypeScript, React Query, Supabase JS, date-fns-tz, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-availability-local-time-design.md`, sections 7.8, 9 and 10.

## Global Constraints

- Write STE-aligned English in comments, commits and the PR body.
- `employee_availability.start_time_local` and `end_time_local` are restaurant-local wall-clock `TIME` values. Do not convert them.
- `availability_exceptions.start_time` and `end_time` stay UTC. Convert them with the exception date as the anchor.
- Parse a `YYYY-MM-DD` anchor with `new Date(year, month - 1, day)`. Do not use `new Date('YYYY-MM-DD')`.
- DST test fixtures use `new Date(year, month, day)`, not noon-UTC ISO strings.
- A null `start_time_local` or `end_time_local` on an available row counts as no window.
- Do not write the legacy `start_time` and `end_time` columns from the frontend. The trigger derives them.
- Do not change `AvailabilityExceptionDialog`, `useAvailability` or the other "no change" files in spec 7.8.
- Use semantic color tokens only. Do not use manual caching.
- The legacy columns stay in the DB. The contract PR deletes them later (before 2027-03-07).

## Review Focus

1. A window that ends at midnight (local `00:00:00`, entered as 24:00 or 00:00). The grid shows "6:00 PM – 12:00 AM". The window is not an overnight spill into the next day. A shift of 18:00 to 23:59 gives no conflict. → Task 2 and Task 3 tests.
2. An exception slot on a time-change day (2026-03-08 and 2026-11-01 in America/Chicago). It shows the time that the manager entered on that date. → Task 2 test.
3. A stale row with `is_available = true` and null local columns. No reader throws, and the grid shows the row as available with no time range. → Task 2 test.
4. The process time zone differs from the restaurant time zone (CI runs in UTC). Run the full suite under `TZ=UTC` and `TZ=Asia/Tokyo`. → Task 7.
5. A bulk save of an incomplete pair. The RPC raises `not_null_violation`, and the user sees a clear message. → Task 4 test.

---

### Task 1: Types and generated types

**Files:**
- Modify: `src/types/scheduling.ts:181-192,215-216`
- Regenerate: `src/types/supabase.ts`, `src/integrations/supabase/types.ts` (use the `sync-types` skill against the local DB with all migrations applied)
- Fix: any type error that the nullable legacy Row fields cause

**Interfaces:**
- Produces: `EmployeeAvailability.start_time_local: string | null`, `EmployeeAvailability.end_time_local: string | null`. `ConflictCheck.available_start_local?: string | null`, `ConflictCheck.available_end_local?: string | null`. Change the comments on `available_start`/`available_end` to "legacy UTC; use the `_local` fields".

- [ ] **Step 1:** Run `npm run db:reset`, then the `sync-types` skill. Confirm that `employee_availability.Row` has `start_time_local` and that `check_availability_conflict` Returns has `available_start_local`.
- [ ] **Step 2:** Edit `src/types/scheduling.ts` as the Interfaces block says.
- [ ] **Step 3:** Run `npm run typecheck`. Fix each error with the smallest change. Do not change behavior in this task.
- [ ] **Step 4:** Commit: `chore(types): add availability local-time columns to the types`.

### Task 2: `computeEffectiveAvailability` and the slot readers

**Files:**
- Modify: `src/lib/effectiveAvailability.ts:30-110,225-251,314-327`
- Modify: `src/lib/conflictFormatUtils.ts` (add `formatLocalTimeOfDay`)
- Modify callers: `src/components/scheduling/TeamAvailabilityGrid.tsx:228,403`, `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:257`, `src/pages/Scheduling.tsx:550`, `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx:83`
- Test: `tests/unit/effectiveAvailability.test.ts`, `tests/unit/EmployeeMiniWeek.test.tsx`, `tests/unit/TeamAvailabilityGrid.week.test.tsx`, `tests/unit/timelineBarLiveAvailability.test.tsx`, `tests/unit/shiftPlannerTab.availabilityWiring.test.tsx`, `tests/unit/scheduleAvailabilityChip.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `computeEffectiveAvailability(availability, exceptions, weekStart, employeeIds, timezone: string)`. Every `EffectiveSlot.startTime`/`endTime` is now local `HH:MM` or `HH:MM:SS`. `sourceRecord` stays the raw row.
  - `formatLocalTimeOfDay(localTime: string): string` in `conflictFormatUtils.ts`. `"17:30:00"` gives `"5:30 PM"`. `"00:00:00"` gives `"12:00 AM"`.
  - `availabilityLabel(effective: EffectiveAvailability): string`. No timezone or date params.
  - `shiftOutsideAvailability` keeps its signature. It uses `timezone` only for the shift instants.

- [ ] **Step 1: Write the failing tests** in `tests/unit/effectiveAvailability.test.ts`:
  - `recurring slot uses the local columns`: a row with `start_time: '15:00:00'`, `end_time: '03:00:00'`, `start_time_local: '10:00:00'`, `end_time_local: '22:00:00'` gives a slot `startTime '10:00:00'`, `endTime '22:00:00'` for weeks of 2026-07-13 and 2026-12-14.
  - `available recurring row with null local columns has no window`: slot `isAvailable true`, `startTime null`, `endTime null`. `availabilityLabel` gives `'Available'`.
  - `exception slot converts with the exception date as anchor`: America/Chicago, exception `date '2026-03-08'`, `start_time '15:00:00'` gives `'10:00'`. Exception `date '2026-03-07'`, `start_time '16:00:00'` gives `'10:00'`.
  - `midnight end is not an overnight spill`: Monday local `18:00:00`–`00:00:00`. `shiftOutsideAvailability` for Tuesday 00:30–02:00 gives `true`. Monday 18:00–23:59 gives `false`.
  - `10:00–22:00 window gives no conflict in July and December`: shift 10:00–22:00 Chicago on 2026-07-15 and on 2026-12-16 gives `false` for both.
  - `availabilityLabel` with local slots `10:00:00`/`22:00:00` gives `'Available 10:00 AM – 10:00 PM'`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/effectiveAvailability.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Recurring slots read `avail.start_time_local ?? null` and `avail.end_time_local ?? null`.
  - Exception slots: if the time is set, use `utcTimeToLocalTime(t, timezone, anchor)`. `anchor` is `new Date(y, m - 1, d)` from `exc.date`.
  - `overnightPrevSlots(slots)`: keep slots where `end <= start` and `end` is not `00:00`. Do no conversion.
  - `pushWindow(slots, offsetMin)`: parse the slot times with no conversion. Keep `if (we <= ws) we += 1440`.
  - `availabilityLabel` uses `formatLocalTimeOfDay`.
  - `TeamAvailabilityGrid` deletes `localizeTime` and passes the timezone to `computeEffectiveAvailability`.
  - `ShiftPlannerTab` and `Scheduling.tsx` pass `restaurantTimezone`.
  - `EmployeeMiniWeek` calls `availabilityLabel(eff)`.
- [ ] **Step 4:** Update the listed component tests. Their fixtures now set the `_local` fields. Their expected strings show the local time. Run `npx vitest run` on all files in the Test list. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(scheduling): read availability local columns in the grid and planner`.

### Task 3: Conflict display

**Files:**
- Modify: `src/lib/conflictFormatUtils.ts:6-27,62-97`, `src/hooks/useConflictDetection.tsx:24-25,79-80`, `src/hooks/usePlannerShiftConflicts.ts:104-105`
- Test: `tests/unit/conflictFormatUtils.test.ts`, `tests/unit/useConflictDetection.test.ts`, `tests/unit/usePlannerShiftConflicts.test.ts`

**Interfaces:**
- Consumes: `formatLocalTimeOfDay` (Task 2), `ConflictCheck` `_local` fields (Task 1).
- Produces: `formatConflictLine(conflict, timezone, referenceDate?)` keeps its signature. It formats `available_start_local`/`available_end_local` with no conversion. If the `_local` fields are null, it uses the generic message path. Delete `extractDateAnchor` and `formatUTCTimeToLocal` if nothing else imports them after Task 2 and Task 5.

- [ ] **Step 1: Write the failing tests:**
  - `formatConflictLine` with `available_start_local '10:00:00'`, `available_end_local '22:00:00'`, message `'Shift on 2026-12-16 ...'` gives `'Shift on Wed, Dec 16 is outside availability (available 10:00 AM – 10:00 PM)'`.
  - The same conflict with `available_start '16:00:00'` (legacy) and no `_local` fields does not show `10:00 AM`.
  - `useConflictDetection` maps the RPC `available_start_local` to the returned conflict.
  - `usePlannerShiftConflicts` sets `available_start_local` and `available_end_local` from the first local window.
- [ ] **Step 2:** Run the three test files. Expected: FAIL.
- [ ] **Step 3:** Implement as the Interfaces block says. Change the old-contract comments.
- [ ] **Step 4:** Run the three test files. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(scheduling): show local availability in conflict messages`.

### Task 4: Writers

**Files:**
- Modify: `src/components/AvailabilityDialog.tsx:3,67-68,89-90`, `src/components/EmployeeDialog.tsx:45,489`, `src/components/scheduling/availability/BulkSetAvailabilitySheet.tsx:13,26-30,88`, `src/hooks/useBulkSetAvailability.ts:5-10,24-30,48`, `src/lib/availabilityTimeUtils.ts:66-100`
- Test: `tests/unit/AvailabilityDialog.test.tsx`, `tests/unit/EmployeeDialog.availabilitySection.test.tsx`, `tests/unit/BulkSetAvailabilitySheet.test.tsx`, `tests/unit/useBulkSetAvailability.test.tsx`, `tests/unit/availabilityTimeUtils.test.ts`

**Interfaces:**
- Produces:
  - `AvailabilityDialog` saves `{ start_time_local, end_time_local }` with the values that the user entered. It loads the form from the same fields.
  - `AvailabilityWindow` in `useBulkSetAvailability.ts` becomes `{ day_of_week; start_time_local; end_time_local; is_available }`. The RPC call sends these keys.
  - `ERROR_MESSAGES.not_null_violation = 'Each available day needs a start time and an end time.'`
  - `EmployeeDialog` and `BulkSetAvailabilitySheet` map their local grid to `AvailabilityWindow` with no conversion. Closed-day rows pass through with their local placeholder times.
  - Delete `convertAvailabilityWindowsToUtc` and `AvailabilityWindowLocal` if nothing else imports them.

- [ ] **Step 1: Write the failing tests:**
  - `AvailabilityDialog` with a row `start_time_local '10:00:00'`, `start_time '15:00:00'`, restaurant America/Chicago shows `10:00` in the start input. A save sends `start_time_local '10:00'` and no `start_time` key.
  - `useBulkSetAvailability` sends `p_availability[0]` with `start_time_local` and with no `start_time` key.
  - `useBulkSetAvailability` maps the error `'null value in column "start_time_local" violates not-null constraint'` (with the code `not_null_violation` in the message) to the new text.
  - `BulkSetAvailabilitySheet` and `EmployeeDialog`: a 10:00–22:00 grid submits `start_time_local '10:00'`, `end_time_local '22:00'` in July and in December (fake the system time to `new Date(2026, 6, 15)` and `new Date(2026, 11, 16)`).
  - Delete the `convertAvailabilityWindowsToUtc` tests in `availabilityTimeUtils.test.ts`.
- [ ] **Step 2:** Run the five test files. Expected: FAIL.
- [ ] **Step 3:** Implement as the Interfaces block says. Change the comment at `BulkSetAvailabilitySheet.tsx:26-30`. Before you delete the error-key match, confirm the real Postgres error text for `not_null_violation` through the RPC on the local DB, and match on the text that comes back.
- [ ] **Step 4:** Run the five test files. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(scheduling): write availability as local time`.

### Task 5: Other readers

**Files:**
- Modify: `src/pages/EmployeePortal.tsx:151-154,291`, `src/components/scheduling/DeleteAvailabilityDialog.tsx:57-93`, `src/lib/scheduleWarnings.ts:104`
- Test: `tests/unit/DeleteAvailabilityDialog.test.tsx`, `tests/unit/scheduleWarnings.test.ts`, plus a new `tests/unit/EmployeePortal.availabilityLocal.test.tsx` only if no current test renders the portal availability list

**Interfaces:**
- Produces:
  - `EmployeePortal` shows recurring rows from `avail.start_time_local`/`end_time_local` with `formatLocalTimeOfDay`. The exception list at `:361` keeps the UTC conversion with the exception date.
  - `DeleteAvailabilityDialog` formats recurring rows from the `_local` fields with no conversion. Exception rows keep the conversion with the exception date.
  - `scheduleWarnings` compares `avail.start_time_local`/`end_time_local` with the template times. It skips a row with null local values.

- [ ] **Step 1: Write the failing tests:**
  - `DeleteAvailabilityDialog` for a recurring row `start_time_local '10:00:00'`, `end_time_local '22:00:00'`, `start_time '16:00:00'` shows `'10:00 AM – 10:00 PM'`.
  - `scheduleWarnings`: a row `start_time_local '10:00:00'`–`'22:00:00'` (legacy `15:00:00`–`03:00:00`) and a template 11:00–15:00 on the same day gives no `no_time_overlap` warning.
  - Portal: a recurring row with `start_time_local '10:00:00'` shows `10:00` (or the portal's current format) and not `09:00`.
- [ ] **Step 2:** Run the test files. Expected: FAIL.
- [ ] **Step 3:** Implement as the Interfaces block says.
- [ ] **Step 4:** Run the test files. Expected: PASS. Run `git grep -n -E 'utcTimeToLocalTime|formatUTCTimeToLocal' src`. Expected: only exception readers and the exception dialog remain.
- [ ] **Step 5:** Commit: `fix(scheduling): show local availability in the portal, delete dialog and warnings`.

### Task 6: E2E

**Files:**
- Modify: `tests/helpers/e2e-supabase.ts` (the availability seed helper), `tests/e2e/impact-aware-deletion.spec.ts`, `tests/e2e/scheduling-conflicts.spec.ts:79`

**Interfaces:**
- Produces: the seed helper writes `start_time_local`/`end_time_local` and does not write the legacy columns.

- [ ] **Step 1:** Change the helper and the two specs. Pin the restaurant time zone in each spec, as lesson 2026-07-21 says.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/impact-aware-deletion.spec.ts tests/e2e/scheduling-conflicts.spec.ts --reporter=line` with the local stack up. Expected: PASS.
- [ ] **Step 3:** Commit: `test(e2e): seed availability as local time`.

### Task 7: Verification

- [ ] **Step 1:** Run `npm run typecheck`, `npm run lint`, `npm run test`. Expected: all PASS.
- [ ] **Step 2:** Run `TZ=UTC npx vitest run` and `TZ=Asia/Tokyo npx vitest run`. Expected: all PASS.
- [ ] **Step 3:** Run `npm run test:db`. Expected: PASS (no SQL change, so this is a guard).
- [ ] **Step 4:** In the local app (not the Netlify preview), make a 10:00–22:00 Monday window for an America/Chicago restaurant. Check the dialog, the grid, the planner and the portal in a July week and in a December week. Make a 10:00–22:00 Monday shift in both weeks and confirm no conflict. This is success criterion 10 of the spec.
