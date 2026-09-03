# Plan: include past draft shifts in the payroll clock audit

Design: `docs/superpowers/specs/2026-09-01-clock-audit-draft-shifts-design.md`
Branch: `fix/clock-audit-draft-shifts`

## Step 1: tests first (audit logic)

File: `tests/unit/scheduleClockAudit.test.ts`. Add the eight cases from
the design's test plan, plus the Danika Warren regression fixture
(draft shift 15:00–21:30 UTC, punches 15:00 / 21:50, `is_published:
false` → one `draft` row, zero `unscheduled_clock` rows). Update every
fixture that asserts the full `AuditSummary` object: add `draft: 0` (or
the correct count). Run `npx vitest run tests/unit/scheduleClockAudit.test.ts`.
The new tests must fail.

## Step 2: audit logic

File: `src/utils/scheduleClockAudit.ts`.

1. Add `'draft'` to `AuditRowStatus`.
2. Add `draft: number` to `AuditSummary`, `SUMMARY_KEY`, and the
   `summarizeRows` initial object.
3. `filterAuditableShifts`: replace the `is_published !== false` filter
   with: keep the shift when `is_published !== false` or
   `end_time <= now`.
4. `buildShiftRow`: one draft branch, per the design. Sessionless draft
   → `null`. Draft with sessions → status `draft` with the pairing
   fields, placed after the `ordered`/`firstSession`/`lastSession`
   computation and before the `!lastSession.clockOut` check.
5. `rollupAuditRowsByEmployee`: count `draft` in `info`. Update the
   `info` doc comment.

Run the Step 1 tests. They must pass.

## Step 3: UI

1. `src/components/payroll/ClockAuditBar.tsx:52`: add `summary.draft`
   to the `info` chip count.
2. `src/components/payroll/EmployeeAuditDetail.tsx`: add
   `draft: 'Draft'` to `STATUS_LABEL`, `draft: 'bg-muted-foreground'`
   to `STATUS_DOT`. No `ACTION_LABEL` entry.
3. Tests: `tests/unit/ClockAuditBar.test.tsx` (info chip includes
   `summary.draft`; add `draft` to the `summary`/`zeroSummary`
   literals), `tests/unit/EmployeeAuditDetail.test.tsx` (a `draft` row
   shows "Draft" and no button).

## Step 4: verify

- `npm run typecheck`
- `npm run lint`
- `npx vitest run tests/unit/scheduleClockAudit.test.ts tests/unit/useScheduleClockAudit.test.ts tests/unit/ClockAuditBar.test.tsx tests/unit/EmployeeAuditDetail.test.tsx`
- `npm run test` (full unit suite)

## Out of scope

- Publish flow, `shifts` schema, edge functions, migrations.
- E2E: `tests/e2e/schedule-clock-audit.spec.ts` stays as-is unless it
  asserts draft exclusion; check and adjust only on failure.

## Commits

1. `test(payroll): cover draft shifts in the clock audit` (Step 1)
2. `fix(payroll): match past draft shifts in the clock audit` (Steps 2–3)
   (or one commit if the TDD loop lands them together; keep tests and
   code consistent at every commit)
