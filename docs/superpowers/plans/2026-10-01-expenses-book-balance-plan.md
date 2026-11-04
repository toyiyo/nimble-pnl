# Expenses page book balance: the 60-day rule — plan

Design: `docs/superpowers/specs/2026-10-01-expenses-book-balance-design.md`

Rules for every task:

- Do not change a query, a migration or RLS. This is a UI-only change.
- Do not change `PendingOutflowsList` or `usePendingOutflows`.
- Write the test first. Run it and see it fail. Then write the code.
- Stage explicit paths. Commit after each task.

## Tasks

1. **Helper test (fails).** Write `tests/unit/openOutflows.test.ts`
   (design 4.1). Pass a fixed `now` to each call. No fake timers.
   - `OPEN_OUTFLOW_WINDOW_DAYS` is 60.
   - `OPEN_OUTFLOW_STATUSES` equals `['pending','stale_30','stale_60','stale_90']`.
   - `getOpenOutflowCutoff(new Date(2026, 8, 30, 12))` is `'2026-08-02'`.
     `new Date(2026, 0, 15, 12)` gives `'2025-11-17'`.
   - `summarizeOpenOutflows` cases: cutoff day is in window, one day before
     is older, a future date is in window, stale statuses count by date,
     `cleared` and `voided` count in neither, an empty array gives zeros, a
     string amount `'12.50'` sums as 12.5.

   Commit the failing test.

2. **Helper.** Write `src/lib/openOutflows.ts` (design 3.2). Run the test
   file. All cases pass. Commit.

3. **Hook uses the helper.** In `src/hooks/useLiquidityMetrics.tsx`
   (design 3.3):
   - Import `OPEN_OUTFLOW_STATUSES` and `getOpenOutflowCutoff` from
     `@/lib/openOutflows`.
   - Change `export const OPEN_OUTFLOW_WINDOW_DAYS = 60;` to a re-export
     from `@/lib/openOutflows`.
   - Use `getOpenOutflowCutoff()` for `outflowCutoff`. Use
     `[...OPEN_OUTFLOW_STATUSES]` in `.in('status', ...)`.
   - Keep the WHY comment above the cutoff.

   Run `tests/unit/useLiquidityMetrics.test.tsx` with no change to it. All
   11 tests pass. Commit.

4. **Page test (fails).** Write `tests/unit/expensesBookBalance.test.tsx`
   (design 4.2). Copy the mock block from
   `tests/unit/expensesPrintChecksHeaderGate.test.tsx:13-72`. Make
   `usePendingOutflows` and `totalBalance` configurable per test. Use
   `vi.useFakeTimers({ toFake: ['Date'] })` and
   `vi.setSystemTime(new Date(2026, 8, 30, 12))`. Restore real timers in
   `afterEach`.
   - Bank 10,000. Rows: 500 `pending` on 2026-09-20, 2,000 `stale_90` on
     2026-05-01, 300 `cleared` on 2026-09-25. Expect `$500.00`,
     `$9,500.00` and `+$2,000.00 older than 60 days, not counted`.
   - Only the 500 row: the note text is absent.

   Commit the failing test.

5. **Page change.** In `src/pages/Expenses.tsx` (design 3.4):
   - Replace the sum at `:44-46` with a `useMemo` call to
     `summarizeOpenOutflows(expenses ?? [])`.
   - `bookBalance = totalBalance - inWindow`. The Uncommitted card shows
     `inWindow`.
   - Under the "Uncommitted Expenses" label, when `older > 0`, add
     `<span className="block text-xs text-muted-foreground">`. The text is
     `+$X older than {OPEN_OUTFLOW_WINDOW_DAYS} days, not counted`. Use the
     same `toLocaleString` format as the cards.

   Run both page test files and the helper test. All pass. Commit.

6. **Checks.** Run `npm run typecheck`, `npm run build`, and `npx eslint` on
   the changed files. `npm run typecheck` does not check the tests, so run
   the four test files with vitest. Run `npm run test` if the machine load
   allows it. Otherwise CI runs the full suite. Fix a failure that this
   branch causes.

## E2E

Justified exception (design 4.4). No seed helper exists for connected banks
and balances. The page test renders the real page and the real helper.

## PR body notes

- State the user-visible change: on the Expenses page, Uncommitted Expenses
  and Book Balance count only open outflows from the last 60 days. A note
  shows the older amount.
- State that the runway result does not change. The hook change is a
  refactor.
- State that the list below the cards still shows all open rows.
- List design section 6 as follow-ups.
