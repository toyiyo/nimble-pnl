# Availability Local Time, PR 2 (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every frontend reader and writer of recurring availability use the local columns, with no timezone conversion.

**Architecture:** `computeEffectiveAvailability` gets the timezone and returns only local slots. Exception slots convert at that one place. All consumers then read one frame and do no conversion.

**Tech Stack:** React, TypeScript, React Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-availability-local-time-design.md`

**First plan:** `docs/superpowers/plans/2026-11-05-availability-local-time-plan.md`. This plan starts after that run gives a PR with green CI.

## Global Constraints

- Branch: `fix/availability-local-time-frontend`, made from the tip of `fix/availability-local-time`. Use a separate worktree.
- Open the PR with base `main`. `unit-tests.yml` runs only for a base of `main` or `develop`, so a stacked base gets no CI. The diff shows the PR 1 commits until PR 1 merges.
- **A merge of this PR before PR 1 sends the migration and the frontend together.** Run `gh pr ready --undo` as soon as the PR is open. The PR stays a draft until the deploy of PR 1 is complete.
- **Merge this PR only after the deploy of PR 1 is complete.** Before that, the columns do not exist on production. The owner merges.
- After PR 1 merges, run `git rebase --onto origin/main fix/availability-local-time` on this branch, then run `git push --force-with-lease`. A squash merge of PR 1 otherwise leaves the old commits in this branch.
- The UI stays the same. No visual change.
- `availability_exceptions` keep UTC values. Exception times convert only in `computeEffectiveAvailability` and in the exception branches of the screens in spec section 7.8.
- `sourceRecord` stays raw.
- Slot times keep the `HH:MM:SS` shape of the columns.
- Writing standard: `docs/STE100_STYLE.md`, for comments, commits, and the PR body.
- Stage explicit paths only. Never commit `progress.md`, and never commit `package-lock.json` from `npm install`.
- Use `new Date(year, month, day)` for DST fixtures. Do not use noon-UTC ISO strings.
- Pin the timezone in E2E tests.

## Review Focus

1. **An all-day exception with null times.** The slot stays null after the conversion, and the label stays "Available". Task 2 tests it.
2. **A browser in a different timezone from the restaurant.** A recurring window shows the restaurant wall-clock time. Task 2 tests it with a run under `TZ=Asia/Tokyo`.
3. **A window that ends at midnight.** `00:00:00` shows as the 12-hour midnight label, and `pushWindow` gives an end of 24:00. Task 2 and Task 4 test it.
4. **A row with null local values.** It counts as no window. The screen does not show "Invalid" or `null`. Task 2 tests it.
5. **A closed-day row in the dialog.** The form opens with the local placeholder values. Saving keeps `is_available = false`. Task 3 tests it.

---

### Task 1: Generated types and shared types

**Files:**
- Modify: `src/types/supabase.ts`, `src/integrations/supabase/types.ts` (generated)
- Modify: `src/types/scheduling.ts:181-192,212-218`

**Interfaces:**
- Produces:
  - `EmployeeAvailability.start_time_local: string | null`, `end_time_local: string | null`. `start_time` and `end_time` become `string | null`, the same as the generated `Row`.
  - `ConflictCheck.available_start_local?: string | null`, `available_end_local?: string | null`.

- [ ] **Step 1: Make the generated types**

Run the `sync-types` skill with local Supabase running.
Expected: `git diff --stat` shows both generated files. The diff holds the two new columns and the new RPC return fields.

- [ ] **Step 2: Change `src/types/scheduling.ts`**

Add the fields above. Change the comment at `:215-216`. It must say that `available_start` is the legacy UTC value, and that `available_start_local` is the local value.

- [ ] **Step 3: Run the type check**

Run: `npm run typecheck`
Expected: errors only in files that later tasks change. Write the list in the commit body. Fix any error in a file that no later task lists.

- [ ] **Step 4: Commit**

```bash
git add src/types/supabase.ts src/integrations/supabase/types.ts src/types/scheduling.ts
git commit -m "chore(types): add the local availability fields"
```

### Task 2: Every `EffectiveSlot` is local

**Files:**
- Modify: `src/lib/effectiveAvailability.ts:30,78-84,96-101,225-251,314-324`
- Modify: `src/lib/conflictFormatUtils.ts:18` (add `formatLocalTime`)
- Modify: `src/components/scheduling/TeamAvailabilityGrid.tsx:227,402`, `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:250`, `src/pages/Scheduling.tsx:534`, `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx:83`
- Test: `tests/unit/effectiveAvailability.test.ts`, `tests/unit/EmployeeMiniWeek.test.tsx`, `tests/unit/shiftPlannerTab.availabilityWiring.test.tsx`, `tests/unit/timelineBarLiveAvailability.test.tsx`, `tests/unit/scheduleAvailabilityChip.test.ts`, `tests/unit/TeamAvailabilityGrid.colorHelper.test.tsx`, `tests/unit/TeamAvailabilityGrid.deleteButton.test.tsx`

**Interfaces:**
- Consumes: the Task 1 types.
- Produces:
  - `computeEffectiveAvailability(availability, exceptions, weekStart, employeeIds, timezone: string)`. The new parameter is last, so the other arguments stay in place.
  - `availabilityLabel(effective: EffectiveAvailability): string`.
  - `formatLocalTime(time: string): string` in `src/lib/conflictFormatUtils.ts`, next to `formatUTCTimeToLocal`, with the same output format and no conversion.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/effectiveAvailability.test.ts`:

```typescript
const julyWeek = new Date(2026, 6, 13);
const decWeek = new Date(2026, 11, 14);
const tz = 'America/Chicago';

it('gives the same recurring slot in July and December', () => {
  for (const week of [julyWeek, decWeek]) {
    const slot = computeEffectiveAvailability([recurring('10:00:00', '22:00:00')], [], week, ['e1'], tz)
      .get('e1')!.get(5)!.slots[0];
    expect(slot).toMatchObject({ startTime: '10:00:00', endTime: '22:00:00' });
  }
});

it('converts an exception slot with its own date', () => {
  const slot = effectiveFor(exception('2026-12-18', '15:00:00', '23:00:00')).slots[0];
  expect(slot).toMatchObject({ startTime: '09:00:00', endTime: '17:00:00' });
  expect(slot.sourceRecord.start_time).toBe('15:00:00');
});

it('converts an exception on the fall day with that day offset', () => {
  // 2026-11-01 is CST at noon. 16:00 UTC reads 10:00.
  const slot = effectiveFor(exception('2026-11-01', '16:00:00', '23:00:00')).slots[0];
  expect(slot.startTime).toBe('10:00:00');
});

it('keeps null times on an all-day exception', () => {
  const eff = effectiveFor(exception('2026-12-18', null, null));
  expect(eff.slots[0]).toMatchObject({ startTime: null, endTime: null });
  expect(availabilityLabel(eff)).toBe('Available');
});

it('counts null local times as no window', () => {
  const eff = effectiveForRecurring(recurring(null, null));
  expect(availabilityLabel(eff)).toBe('Available');
});

it('does not spill a window of 18:00 to 00:00 into the next day', () => {
  expect(shiftOutsideAvailability(/* Sat 09:00-10:00, Fri 18:00-00:00, no Sat row */)).toBe(false);
});

it('accepts a shift inside a window of 18:00 to 00:00 on its own day', () => {
  expect(shiftOutsideAvailability(/* Fri 19:00-23:00, Fri 18:00-00:00 */)).toBe(false);
});

it('does not spill 10:00 to 22:00 into the next day', () => {
  expect(shiftOutsideAvailability(/* Sat 01:00-02:00, Fri 10:00-22:00, Sat closed */)).toBe(true);
});
```

The `recurring`, `exception`, `effectiveFor`, and `effectiveForRecurring` helpers go in the test file. Pass the real arguments of `shiftOutsideAvailability` at the commented places. Read its signature at `:269`.

Add the same "July and December" case for a browser in another timezone (Review Focus 2). Run the file a second time with `TZ=Asia/Tokyo`.

`TeamAvailabilityGrid`: a cell shows the local window for a July week and a December week. A slot with null times shows no time text, and the page has no "Invalid" text.

- [ ] **Step 2: Run the test to check that it fails**

Run: `npx vitest run tests/unit/effectiveAvailability.test.ts`
Expected: FAIL, slots hold UTC values.

- [ ] **Step 3: Implement the change**

Apply the "Readers" section of spec 7.8 for these sites:

- Recurring slots read `avail.start_time_local ?? null`.
- Exception slots call `utcTimeToLocalTime` with the exception date, parsed as `new Date(y, m - 1, d)`. Keep `HH:MM:SS`.
- `availabilityLabel` calls `formatLocalTime`.
- `overnightPrevSlots` loses its `timezone` and `date` parameters. Its filter adds `end <> 00:00`.
- `pushWindow` keeps `if (we <= ws) we += 1440;` and does no conversion.
- `shiftOutsideAvailability` keeps its timezone for the shift times only.
- The three callers pass the safe timezone they hold: `timezone`, `restaurantTimezone`, `restaurantTimezone`.
- `EmployeeMiniWeek.tsx:83` calls `availabilityLabel(effective)`.
- `TeamAvailabilityGrid.tsx:227` deletes `localizeTime`. Its call sites read the slot times. This must happen in this task. If not, the grid converts a local value a second time.

`usePlannerShiftConflicts` puts local slot values in the legacy fields until Task 5. Its tests can fail between these two tasks.

- [ ] **Step 4: Run the tests to check that they pass**

Run: `npx vitest run tests/unit/effectiveAvailability.test.ts tests/unit/EmployeeMiniWeek.test.tsx tests/unit/shiftPlannerTab.availabilityWiring.test.tsx tests/unit/timelineBarLiveAvailability.test.tsx tests/unit/scheduleAvailabilityChip.test.ts tests/unit/TeamAvailabilityGrid.colorHelper.test.tsx tests/unit/TeamAvailabilityGrid.deleteButton.test.tsx`
Expected: PASS. Change fixtures to local columns where a test fails on the old frame.

Run: `TZ=Asia/Tokyo npx vitest run tests/unit/effectiveAvailability.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/effectiveAvailability.ts src/lib/conflictFormatUtils.ts src/components/scheduling/TeamAvailabilityGrid.tsx src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx src/pages/Scheduling.tsx src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx tests/unit/effectiveAvailability.test.ts tests/unit/EmployeeMiniWeek.test.tsx tests/unit/shiftPlannerTab.availabilityWiring.test.tsx tests/unit/timelineBarLiveAvailability.test.tsx tests/unit/scheduleAvailabilityChip.test.ts tests/unit/TeamAvailabilityGrid.colorHelper.test.tsx tests/unit/TeamAvailabilityGrid.deleteButton.test.tsx
git commit -m "fix(availability): make every effective slot local"
```

### Task 3: Writers send local time

**Files:**
- Modify: `src/components/AvailabilityDialog.tsx:67-68,89-90`
- Modify: `src/components/EmployeeDialog.tsx:489`
- Modify: `src/components/scheduling/availability/BulkSetAvailabilitySheet.tsx:26-30,88`
- Modify: `src/hooks/useBulkSetAvailability.ts:24-30,48`
- Modify: `src/lib/availabilityTimeUtils.ts:66-88` (delete `convertAvailabilityWindowsToUtc` and its "lossy by design" note)
- Test: `tests/unit/AvailabilityDialog.test.tsx`, `tests/unit/EmployeeDialog.availabilitySection.test.tsx`, `tests/unit/BulkSetAvailabilitySheet.test.tsx`, `tests/unit/useBulkSetAvailability.test.tsx`, `tests/unit/availabilityTimeUtils.test.ts`, `tests/unit/availabilityDefaults.test.ts`

**Interfaces:**
- Consumes: the local keys of `bulk_set_employee_availability` (PR 1).
- Produces: no `src/` file calls `convertAvailabilityWindowsToUtc`.

- [ ] **Step 1: Write the failing tests**

```typescript
// AvailabilityDialog: a save in a Chicago restaurant
expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
  start_time_local: '10:00:00', end_time_local: '22:00:00',
}));
expect(onSave.mock.calls[0][0]).not.toHaveProperty('start_time');

// AvailabilityDialog: the form reads local columns
// Row: start_time_local '10:00:00', start_time '15:00:00'. The input shows 10:00.

// AvailabilityDialog: closed day (Review Focus 5)
// Row: is_available false, local placeholders. The form opens, and the save keeps is_available false.

// useBulkSetAvailability: the RPC payload
expect(rpc.mock.calls[0][1].p_availability[0]).toMatchObject({
  start_time_local: '10:00:00', end_time_local: '22:00:00', is_available: true,
});

// useBulkSetAvailability: the error map has a user message for not_null_violation
```

`BulkSetAvailabilitySheet` and `EmployeeDialog.availabilitySection`: the payload holds the form values with no conversion, and closed-day rows hold local placeholders. Delete the `convertAvailabilityWindowsToUtc` cases from `availabilityTimeUtils.test.ts`.

- [ ] **Step 2: Run the tests to check that they fail**

Run: `npx vitest run tests/unit/AvailabilityDialog.test.tsx tests/unit/useBulkSetAvailability.test.tsx tests/unit/BulkSetAvailabilitySheet.test.tsx tests/unit/EmployeeDialog.availabilitySection.test.tsx`
Expected: FAIL, the payload holds UTC values with legacy keys.

- [ ] **Step 3: Implement the change**

Apply the "Writers" section of spec 7.8. Change the `useBulkSetAvailability` types and key map to `*_local`. Add the `not_null_violation` entry to `ERROR_MESSAGES`. Delete the imports that become unused.

- [ ] **Step 4: Run the tests to check that they pass**

Run: `npx vitest run tests/unit/AvailabilityDialog.test.tsx tests/unit/useBulkSetAvailability.test.tsx tests/unit/BulkSetAvailabilitySheet.test.tsx tests/unit/EmployeeDialog.availabilitySection.test.tsx tests/unit/availabilityTimeUtils.test.ts tests/unit/availabilityDefaults.test.ts`
Expected: PASS.

Run: `grep -rn convertAvailabilityWindowsToUtc src`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/AvailabilityDialog.tsx src/components/EmployeeDialog.tsx src/components/scheduling/availability/BulkSetAvailabilitySheet.tsx src/hooks/useBulkSetAvailability.ts src/lib/availabilityTimeUtils.ts tests/unit/AvailabilityDialog.test.tsx tests/unit/EmployeeDialog.availabilitySection.test.tsx tests/unit/BulkSetAvailabilitySheet.test.tsx tests/unit/useBulkSetAvailability.test.tsx tests/unit/availabilityTimeUtils.test.ts tests/unit/availabilityDefaults.test.ts
git commit -m "fix(availability): write local time from every form"
```

### Task 4: Screens show local time

**Files:**
- Modify: `src/pages/EmployeePortal.tsx:151-154,291`
- Modify: `src/components/scheduling/DeleteAvailabilityDialog.tsx:58-93`
- Test: `tests/unit/DeleteAvailabilityDialog.test.tsx`

**Interfaces:**
- Consumes: `formatLocalTime` and local slots from Task 2.

- [ ] **Step 1: Write the failing tests**

- `DeleteAvailabilityDialog`: a recurring row with `start_time_local: '10:00:00'`, `end_time_local: '00:00:00'` shows the same text as `formatLocalTime` gives for both values. An exception row still converts from UTC.

- [ ] **Step 2: Run the tests to check that they fail**

Run: `npx vitest run tests/unit/DeleteAvailabilityDialog.test.tsx`
Expected: FAIL, the recurring row shows a converted value.

- [ ] **Step 3: Implement the change**

Each site calls `formatLocalTime`. `EmployeePortal.tsx:361` stays UTC for exceptions. `EmployeePortal` has no slot, so it reads `start_time_local` with a null guard.

- [ ] **Step 4: Run the tests to check that they pass**

Run: the Step 2 command.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/EmployeePortal.tsx src/components/scheduling/DeleteAvailabilityDialog.tsx tests/unit/DeleteAvailabilityDialog.test.tsx
git commit -m "fix(availability): show local time on the screens"
```

### Task 5: Conflict messages and schedule warnings

**Files:**
- Modify: `src/hooks/useConflictDetection.tsx:24-25,79-80`
- Modify: `src/hooks/usePlannerShiftConflicts.ts:99-105`
- Modify: `src/lib/conflictFormatUtils.ts:6-27,62-97`
- Modify: `src/lib/scheduleWarnings.ts:104`
- Test: `tests/unit/useConflictDetection.test.ts`, `tests/unit/usePlannerShiftConflicts.test.ts`, `tests/unit/conflictFormatUtils.test.ts`, `tests/unit/scheduleWarnings.test.ts`

**Interfaces:**
- Consumes: `available_start_local` and `available_end_local` from the RPC (PR 1) and the Task 1 types. Local slots from Task 2.

- [ ] **Step 1: Write the failing tests**

- `conflictFormatUtils`: a conflict with `available_start_local: '10:00:00'`, `available_end_local: '22:00:00'`, and a legacy `available_start: '15:00:00'` gives a message with the 10:00 and 22:00 labels on a July date and a December date.
- `conflictFormatUtils`: null local fields give a message with no time range.
- `conflictFormatUtils`: `available_end_local: '00:00:00'` shows the 12-hour midnight label.
- `useConflictDetection`: the RPC row maps to `available_start_local` and `available_end_local`.
- `usePlannerShiftConflicts`: a slot with `startTime: '10:00:00'` gives `available_start_local: '10:00:00'`.
- `scheduleWarnings`: template 10:00-14:00, availability `start_time_local: '09:00:00'`, `end_time_local: '15:00:00'`, legacy `14:00:00`, `20:00:00`. No `no_time_overlap` warning.
- `scheduleWarnings`: template 16:00-18:00 with the same row gives `no_time_overlap`.
- `scheduleWarnings`: a row with null local values gives no crash.
- `scheduleWarnings`: template 19:00-23:00, availability 18:00-00:00, gives no `no_time_overlap`.

- [ ] **Step 2: Run the tests to check that they fail**

Run: `npx vitest run tests/unit/useConflictDetection.test.ts tests/unit/usePlannerShiftConflicts.test.ts tests/unit/conflictFormatUtils.test.ts tests/unit/scheduleWarnings.test.ts`
Expected: FAIL, the code reads legacy fields.

- [ ] **Step 3: Implement the change**

Apply the matching lines of spec 7.8. Delete `extractDateAnchor` if nothing uses it. Change the comments at `conflictFormatUtils.ts:6-17,80-88`.

- [ ] **Step 4: Run the tests to check that they pass**

Run: the Step 2 command.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useConflictDetection.tsx src/hooks/usePlannerShiftConflicts.ts src/lib/conflictFormatUtils.ts src/lib/scheduleWarnings.ts tests/unit/useConflictDetection.test.ts tests/unit/usePlannerShiftConflicts.test.ts tests/unit/conflictFormatUtils.test.ts tests/unit/scheduleWarnings.test.ts
git commit -m "fix(availability): use local time in conflict messages and warnings"
```

### Task 6: E2E fixtures and the full check

**Files:**
- Modify: `tests/helpers/e2e-supabase.ts:235`
- Modify: `tests/e2e/impact-aware-deletion.spec.ts:244`
- Modify: `tests/e2e/scheduling-conflicts.spec.ts:79`

**Interfaces:**
- Consumes: all earlier tasks.

- [ ] **Step 1: Change the fixtures**

The three sites write `start_time_local` and `end_time_local`. Each test pins the restaurant timezone. Keep the wall-clock values that the assertions expect.

- [ ] **Step 2: Run the E2E specs**

Run: `npx playwright test tests/e2e/scheduling-conflicts.spec.ts tests/e2e/impact-aware-deletion.spec.ts --reporter=line`
Expected: PASS. Keep this run in the foreground, with the Bash `timeout` at 600000.

- [ ] **Step 3: Run the full check**

Run: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`
Expected: all pass.

Run: `grep -rn "utcTimeToLocalTime\|formatUTCTimeToLocal" src`
Expected: only exception paths and `availabilityTimeUtils.ts`. Read each hit. A recurring read here is a bug.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/e2e-supabase.ts tests/e2e/impact-aware-deletion.spec.ts tests/e2e/scheduling-conflicts.spec.ts
git commit -m "test(availability): write local time in E2E fixtures"
```
