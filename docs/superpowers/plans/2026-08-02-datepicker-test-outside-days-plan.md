# Plan: make the BulkInventoryDeductionDialog date-picker test clock-independent

Design: `docs/superpowers/specs/2026-08-02-datepicker-test-outside-days-design.md`

## Tasks

- [ ] **T1 — Reproduce (RED).** Run
      `npx vitest run tests/unit/BulkInventoryDeductionDialog.datePicker.test.tsx`
      on the unmodified file and capture the "found multiple elements" failure
      at `:120`. *(Done before planning; re-confirmed in the commit message.)*

- [ ] **T2 — Add the `getDayCell` helper.** Insert it above the `describe`
      block in `tests/unit/BulkInventoryDeductionDialog.datePicker.test.tsx`.
      Filters `getAllByRole('gridcell', { name })` down to cells without the
      `day-outside` class and asserts exactly one survivor.

- [ ] **T3 — Route all four day lookups through the helper.**
      `'10'` (start-date close-on-select), `'20'` (end-date close-on-select),
      `'5'` and `'20'` (end-date disabled guard). No other changes to the
      assertions.

- [ ] **T4 — GREEN with the real clock.** Re-run the file. All 5 tests pass with
      the host clock untouched (today is 2026-08-02, i.e. the month that
      reproduces the bug).

- [ ] **T5 — Hostile-month cross-check (throwaway, not committed).** Temporarily
      add `vi.useFakeTimers({ shouldAdvanceTime: true })` +
      `vi.setSystemTime(new Date('2027-02-10T12:00:00'))` to a scratch copy of
      the file and run it. Feb 2027 starts on a Monday, so its grid runs
      Jan 31 – Mar 6 and the outside Mar 5 collides with Feb 5. If the suite
      passes there too, the fix is month-independent rather than month-lucky.
      Revert the scratch edit afterwards; the committed file keeps no fake
      timers (`memory/lessons.md:42`).

- [ ] **T6 — Commit.** `fix(tests): scope date-picker day lookups to in-month
      cells`.

- [ ] **T7 — CodeRabbit local review** (`coderabbit review --plain --type
      committed`), fix any actionable findings.

- [ ] **T8 — Verify (Phase 8).** Full `npm run test`, `npm run typecheck`,
      `npm run lint`, `npm run build`.
      **E2E gate:** justified exception — this is a test-only change with no
      user-facing behaviour change and no cross-layer seam touched. No
      `tests/e2e/` spec is applicable.

- [ ] **T9 — Ship (Phase 9).** Push, open PR, watch CI, triage every review
      comment, then report.

## Dependencies

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 (strictly sequential; the change is
a single file).

## Out of scope

- Any change to `DatePicker`, `Calendar`, or `BulkInventoryDeductionDialog`.
- Auditing other test files for the same outside-day hazard. Worth a follow-up
  sweep, but it is not what is turning CI red today.
