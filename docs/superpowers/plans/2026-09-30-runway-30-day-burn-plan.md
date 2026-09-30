# Dashboard cash runway: use a 30-day burn — plan

Design: `docs/superpowers/specs/2026-09-30-runway-30-day-burn-design.md`

Rules for every task:

- Do not change `useLiquidityMetrics`. Do not change SQL, RPC or RLS.
- Do not change `LiquidityTab` or `BankSnapshotSection`.
- Use semantic tokens only. Use the type scale in CLAUDE.md.
- Write the test first. Run it and see it fail. Then write the code.
- Stage explicit paths. Commit after each task.

## Tasks

1. **Runway helpers.** Write `tests/unit/cashRunway.test.ts` (fails).
   - `getRunwayWindow`: the start is 29 days before `now` at 00:00. The end
     is `now` at 23:59:59.999. `differenceInDays(end, start) + 1` is 30.
     Check a month edge and the DST edges 2026-03-08 and 2026-11-01.
   - `formatRunwayValue`: `null` → "—", `Infinity` → "Cash growing", 0 →
     "0d", 0.9 → "0d", 29.9 → "29d", 365 → "365d", 366 → "365+d".
   - `buildCashRunwayAlert`: `null`, `Infinity`, `NaN`, 0 and -5 give
     `null`. 13.9 gives "critical". 14 and 29.9 give "warning". 30 gives
     `null`. Check the id, type, title, description and action.

   Add `src/lib/cashRunway.ts` with `RUNWAY_WINDOW_DAYS`,
   `getRunwayWindow`, `formatRunwayValue` and `buildCashRunwayAlert`
   (design 4.1). Use the `CriticalAlert` type that `Index.tsx` uses now.
   Commit.

2. **Hook cases.** Add 3 cases to `tests/unit/useLiquidityMetrics.test.tsx`
   with the existing mock builders:
   - A 30-day range, outflows of 3000, inflows of 1500, a balance of 1000.
     Expect `daysOfCash` of 20.
   - Inflows larger than outflows. Expect `Infinity`.
   - Zero connected banks. Expect no error and `daysOfCash` of 0.

   These tests pin the current hook math. They must pass with no hook
   change. If one fails, stop and report. Commit.

3. **Widget states.** Write
   `tests/unit/OwnerSnapshotWidget.runway.test.tsx` (fails).
   - `cashRunwayLoading` true shows a skeleton and no "0d".
   - `null` shows "—" with `text-muted-foreground`, not `text-destructive`.
     The value has the `aria-label` "Runway not available".
   - `Infinity` shows "Cash growing" with `text-[17px]` and
     `whitespace-nowrap`.
   - 20 shows "20d" with `text-destructive`. 45 shows "45d" with
     `text-orange-500`.
   - The tooltip text is "Days of cash at the average net burn of the last
     30 days. Target: 60+ days".

   Change `src/components/dashboard/OwnerSnapshotWidget.tsx` (design 4.3):
   `cashRunway: number | null`, the new `cashRunwayLoading` prop, the null
   guard first in `getRunwayColor`, `formatRunwayValue`, the skeleton, the
   font size rule and the tooltip. Delete the local `formatRunway`.
   Commit.

4. **Wire the page.** Write `tests/unit/indexCashRunway.test.ts` (fails),
   with the pattern from `tests/unit/indexLaborCostSection.test.ts`.
   Check that `src/pages/Index.tsx`:
   - calls `getRunwayWindow` and `buildCashRunwayAlert`;
   - does not call `useLiquidityMetrics(todayStart, todayEnd`;
   - does not contain `dailyAvgSpending` or `autoLoadAll`;
   - sets `cashRunway` to `null` while `liquidityLoading` is true;
   - passes `cashRunwayLoading` to `OwnerSnapshotWidget`.

   Change `src/pages/Index.tsx` (design 4.2):
   - Memo the window with `todayKey`. Read `isLoading` as
     `liquidityLoading`.
   - Set `cashRunway` with the null rule. Pass `cashRunwayLoading`.
   - Use `buildCashRunwayAlert` in `criticalAlerts`. Put `cashRunway` in
     the deps. Delete `availableCash` from the deps if no other alert
     reads it.
   - Delete the `dailyAvgSpending` memo and the `allTransactions` query.
   - Run `grep` for `totalPendingOutflows`, `usePendingOutflowsSummary`,
     `isTransferCategoryType` and `useBankTransactions`. Delete each one
     that has no other reader.

   Commit.

5. **Checks.** Run `npm run typecheck`, `npm run build` and the unit tests.
   Run `npx eslint` on the changed files only. Compare with `main`. Run
   `npx playwright test tests/e2e/dashboard-basis-labels.spec.ts
   tests/e2e/labor-cost-alignment.spec.ts --project=e2e --reporter=line`.
   Fix a failure that this branch causes. Commit if a fix is necessary.

6. **UI check.** Start the dev server from this worktree. Check the tile at
   375 px and 1024 px, light and dark. Check the skeleton on a slow
   network. Check that the tile and the alert show the same number of
   days. Kill the dev server before the task ends.

## E2E

Justified exception (design section 8). No seed helper exists for
connected banks, balances and 30 days of posted rows. The pure functions,
the hook cases, the widget test and the source test cover the logic. The
two dashboard specs in task 5 must pass. QA checks the net-positive case
at 375 px on the preview.

## PR body notes

- State that M2, M3 and M4 stop being defects as a result of the M1 rule
  (design section 5). No separate change for them.
- State the merge order: this PR first, then rebase #834 (design
  section 7).
- List the known limits in design section 6 as follow-ups.

## Not in this plan

- Local-day edges for the hook (design 6.6).
- Filters for stale pending outflows, excluded rows or the `truncated`
  flag (design 6.1, 6.3, 6.4).
- Any change to PR #834.
