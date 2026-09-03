# Design: include past draft shifts in the payroll clock audit

Date: 2026-09-01
Branch: `fix/clock-audit-draft-shifts` (from `origin/main` @ ef6b0615)
Status: Draft for review

## Problem

The payroll clock audit excludes draft shifts
([scheduleClockAudit.ts:235](../../../src/utils/scheduleClockAudit.ts)).
The filter drops every shift with `is_published === false`:

```typescript
.filter((shift) => shift.is_published !== false)
```

Some restaurants do not use the publish feature, or use it in some weeks
only. At such a restaurant, every worked session loses its shift. The audit
then reports the session as `unscheduled_clock`, and the detail row shows
"Not scheduled"
([EmployeeAuditDetail.tsx:23](../../../src/components/payroll/EmployeeAuditDetail.tsx)).

Production evidence (restaurant `7c0c76e3-e770-401b-a2a9-c1edd407efed`,
"Wetzel's - Cold Stone - Alamo Ranch"):

- Employee Danika Warren has shift `15195d23-29ab-4c24-9d0a-72f59feecf4a`
  on 2026-08-30, 15:00 to 21:30 UTC, with `status = 'scheduled'` and
  `is_published = false`.
- Her punches on that day are clock_in 15:00 and clock_out 21:50 UTC.
- The audit shows the day as "Not scheduled".
- All 46 non-cancelled shifts in the week of Aug 24 are drafts. The
  `schedule_publications` table has no row for that week. The restaurant
  never published it.

Precedent: PR #747 removed the `is_published` gate on shift trades
([memory/lessons.md:2704](../../../memory/lessons.md)). The product
decision is: a draft shift is tentative, not invisible. The employee page
already models a restaurant that never publishes
([ShiftRow.tsx:103](../../../src/components/employee/ShiftRow.tsx)).

## Goal

1. Include a draft shift in the match step when its end time is in the
   past.
2. Label the row "Draft". Do not flag it. A draft must not add to the
   "to fix" count.
3. Keep the pairing data on the row: scheduled times, clocked sessions,
   worked minutes, deltas.

## Non-goals

- Do not change the publish flow or the `shifts` schema.
- Do not change how published shifts classify.
- Do not add a repair action for draft rows.

## Approaches

### Approach A: new row status `draft` (recommended)

Add a `draft` value to `AuditRowStatus`
([scheduleClockAudit.ts:50-56](../../../src/utils/scheduleClockAudit.ts)).

1. **Filter** ([scheduleClockAudit.ts:227-243](../../../src/utils/scheduleClockAudit.ts)):
   keep a shift when it is published, or when its `end_time` is at or
   before `now`. A draft that did not end yet stays excluded. It can still
   change or disappear before the shift ends.

2. **Match** ([scheduleClockAudit.ts:318-345](../../../src/utils/scheduleClockAudit.ts)):
   no change. The included drafts enter `assignSessionsToShifts` and
   receive sessions through the same overlap and delta rules. A repair
   punch with a `shift_id` link to a draft also resolves now.

3. **Classify** ([scheduleClockAudit.ts:347-413](../../../src/utils/scheduleClockAudit.ts)):
   in `buildShiftRow`, branch on `shift.is_published === false` **once**,
   not at each return point. The filter and `buildShiftRow` share the
   same `now`, so every draft that reaches `buildShiftRow` has
   `shiftEnded === true`. Two branches cover all cases:
   - Draft with no sessions: return `null` before the `missing_clock`
     return. No row. Today the draft produces no row, and a "missed
     draft shift" flag would flood the panel at a restaurant that
     drafts speculative schedules.
   - Draft with sessions: return status `draft` after the
     `ordered`/`firstSession`/`lastSession` computation and before the
     `!lastSession.clockOut` check, so the later branches never see a
     draft. Compute `sessions`, `workedMinutes`, `gapMinutes`,
     `inDeltaMinutes`, `outDeltaMinutes` as for a closed row, so the
     detail line shows the full pairing. An open last session leaves
     `workedMinutes` and `outDeltaMinutes` absent, as the open-session
     rules already do.
   - A draft row never gets `missing_clock`, `time_mismatch`,
     `open_clock`, `matched`, or `in_progress`.

4. **Summary** ([scheduleClockAudit.ts:80-87,442-462](../../../src/utils/scheduleClockAudit.ts)):
   add `draft: number` to `AuditSummary` and to `SUMMARY_KEY`.

5. **Rollup** ([scheduleClockAudit.ts:477-495](../../../src/utils/scheduleClockAudit.ts)):
   count `draft` rows in `info`. The doc comment on `info` changes to
   "unscheduled_clock + in_progress + draft count". Warning: the rollup
   is a plain `if` chain, and the compiler does not force a new branch
   for a new status. Test plan item 7 is the only guard. Write that
   test first.

6. **UI**:
   - [ClockAuditBar.tsx:52](../../../src/components/payroll/ClockAuditBar.tsx):
     `info` chip count becomes `unscheduledClock + inProgress + draft`.
   - [EmployeeAuditDetail.tsx:19-35](../../../src/components/payroll/EmployeeAuditDetail.tsx):
     add `draft: 'Draft'` to `STATUS_LABEL` and
     `draft: 'bg-muted-foreground'` to `STATUS_DOT`. No entry in
     `ACTION_LABEL`, so the row shows no button.
   - [Payroll.tsx:83-118](../../../src/pages/Payroll.tsx): no change.
     `employeeMatchesAuditFilter` and `auditChipForRollup` read the
     rollup counters, and `info` already includes drafts after step 5.

### Approach B: keep computed statuses, add an `isDraft` flag

Compute the normal status for a draft, add `isDraft: true` to the row,
and downgrade `missing_clock`/`time_mismatch` in the rollup and the UI.

Rejected. Two sources of truth for one row class. Every consumer of
`status` must also read `isDraft`, or it flags a draft by accident. The
summary, the rollup, the chips, and the tests all grow a second branch.

### Approach C: relabel unscheduled rows when a draft exists that day

Keep drafts out of the match pool. When an `unscheduled_clock` session
lands on a day with a draft shift, relabel the row "Draft day".

Rejected. The row keeps no pairing: no scheduled times, no deltas. The
user asked for the pairing data. The day-level join also breaks for
overnight shifts.

## Decisions and edge cases (Approach A)

- **Published shift priority**: `findBestShiftForSession`
  ([scheduleClockAudit.ts:299-316](../../../src/utils/scheduleClockAudit.ts))
  treats drafts and published shifts as equal candidates. A week is
  published or not as a unit (`publish_schedule` sets the full week), so
  a mixed overlap is rare. The overlap rule already picks the correct
  shift by time.
- **Legacy null**: `is_published` can be `null` on old rows. `null`
  counts as published today (`is_published !== false`), and this design
  keeps that rule. Only `is_published === false` marks a draft.
- **Ended-draft bound**: the gate is `end_time <= now`, the same
  comparison `buildShiftRow` uses for `shiftEnded`
  ([scheduleClockAudit.ts:356](../../../src/utils/scheduleClockAudit.ts)).
- **`AuditSummary` shape change**: `summarizeRows` and the test
  fixtures that assert the full summary object gain the `draft` field.
- **No new fetch**: `useScheduleClockAudit` already selects
  `is_published` ([useScheduleClockAudit.ts:83](../../../src/hooks/useScheduleClockAudit.ts)).
- **Per-employee chip**: a draft-only employee shows the generic
  "N info" chip ([Payroll.tsx:107-119](../../../src/pages/Payroll.tsx)).
  This fold-in is intended. It matches the existing fold-in of
  `unscheduled_clock` and `in_progress`, and the expanded detail row
  shows the distinct "Draft" label.
- **No repair dialog for drafts**: `onEnterClock` fires only from a
  button gated by `ACTION_LABEL[row.status]`
  ([EmployeeAuditDetail.tsx:38-41](../../../src/components/payroll/EmployeeAuditDetail.tsx)).
  `draft` gets no entry, so `RecordShiftClockDialog` cannot open for a
  draft row.

## Test plan

Unit tests in `tests/unit/scheduleClockAudit.test.ts`:

1. A draft shift with a past end time and a matched closed session
   produces a `draft` row with `workedMinutes`, `inDeltaMinutes`, and
   `outDeltaMinutes`. The session does not produce an
   `unscheduled_clock` row.
2. A draft shift with a past end time and no sessions produces no row.
3. A draft shift with a future end time stays excluded. Its session, if
   any, stays `unscheduled_clock` or `in_progress` per the current rules.
4. A draft row with large deltas stays `draft`. It never becomes
   `time_mismatch`.
5. A draft shift with an open matched session produces a `draft` row
   without `workedMinutes`.
6. `summarizeRows` counts `draft` rows in `summary.draft`.
7. `rollupAuditRowsByEmployee` counts a `draft` row in `info`, not in
   `toFix`.
8. A session with a `shift_id` link to a past-ended draft attaches to
   that draft.

Component tests:

- `tests/unit/ClockAuditBar.test.tsx`: the info chip count includes
  `summary.draft`. Also add `draft: <n>` to the existing `summary` and
  `zeroSummary` literals (lines 44-59). They are typed `AuditSummary`
  and fail to compile without the new field.
- `tests/unit/EmployeeAuditDetail.test.tsx`: a `draft` row shows the
  label "Draft" and no action button.

Regression: the Danika Warren case as a fixture — shift 15:00–21:30,
punches 15:00/21:50, `is_published: false` — asserts one `draft` row and
zero `unscheduled_clock` rows.
