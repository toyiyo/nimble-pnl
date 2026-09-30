# Dashboard cash runway: use a 30-day burn — design

Status: draft for review. Base: `main` at `5168b061`.
Source: item M1 in `docs/superpowers/specs/2026-09-30-dashboard-briefing-design.md`
section 10 (on branch `feature/dashboard-briefing`, PR #834).

## 1. Problem

The dashboard shows two different runway values for the same restaurant.
The runway tile showed 168 days. The cash-runway alert showed 22 days.

The two values come from two different calculations. Neither uses the
approved formula.

### 1.1 The tile uses one day of data

- `src/pages/Index.tsx:162-163` sets `todayStart` and `todayEnd` to the
  start and the end of today.
- `src/pages/Index.tsx:265-269` passes that range to
  `useLiquidityMetrics(todayStart, todayEnd, 'all')`.
- `src/hooks/useLiquidityMetrics.tsx:83` sets
  `periodDays = differenceInDays(endDate, startDate) + 1`. For today only,
  `periodDays` is 1.
- `src/hooks/useLiquidityMetrics.tsx:109-126` sums the posted outflows and
  inflows in the range. It divides the net by `periodDays`.
- `src/hooks/useLiquidityMetrics.tsx:128-139` sets
  `daysOfCash = bookBalance / netDailyBurn`.
- `src/pages/Index.tsx:316` sets `cashRunway = liquidityMetrics?.daysOfCash || 0`.
  `src/pages/Index.tsx:711` passes it to `OwnerSnapshotWidget`.

Thus the tile uses the posted rows of one calendar day. A day with a large
deposit gives a very long runway. A day with a large payroll debit gives a
very short runway. Early in the day, before the bank posts rows, the net
burn is 0 and the tile shows the "365+" value.

The hook math is correct. The date range from `Index.tsx` is the defect.

### 1.2 The alert uses a separate calculation

- `src/pages/Index.tsx:86-88` loads all bank transactions with
  `useBankTransactions(undefined, { autoLoadAll: true, pageSize: 200, ... })`.
- `src/pages/Index.tsx:319-354` (`dailyAvgSpending`) keeps rows with
  `amount < 0` from the last 30 days. It adds `totalPendingOutflows`. It
  divides by the number of distinct days that have a debit.
- `src/pages/Index.tsx:367-377` sets
  `runway = availableCash / dailyAvgSpending`. It shows the alert when
  `0 < runway < 30`. It is critical when `runway < 14`.
- `src/pages/Index.tsx:418`: the `criticalAlerts` memo does not list
  `dailyAvgSpending` in its dependencies.

This calculation has three more defects (M2, M3 and M4 in the briefing
design):

- M2: it counts pending rows as spend in the burn. The hook subtracts them
  from the balance.
- M3: it ignores deposits. It divides gross spend, not net burn.
- M4: the memo can show a stale alert, because a dependency is missing.

### 1.3 Other callers of the hook

- `src/components/BankSnapshotSection.tsx:15-26` already uses a 30-day
  range (`subDays(today, 30)` to `endOfDay(today)`).
- `src/components/banking/LiquidityTab.tsx:18` uses the period and the bank
  account that the user selects.

This PR does not change these two callers.

## 2. Approved fix

The user approved this rule for M1:

> runway = book cash ÷ (30-day posted outflows − inflows) ÷ 30. One hook
> feeds the tile and the alert. When the net burn is 0 or less, show
> "Cash growing".

Book cash is `bookBalance` from the hook
(`src/hooks/useLiquidityMetrics.tsx:80`): the bank balance minus open
pending outflows.

## 3. Approaches

**A. Pass a 30-day range to the hook, and feed the tile and the alert from
it (recommended).** This is a change in `Index.tsx` and in the tile. The
hook does not change. One number drives both places.

B. Add a new hook or an RPC for the runway. This adds a second source for
the same number, and the Banking page keeps the old hook. It does not
follow "one hook".

C. Keep the separate alert math and change only the range. The tile and
the alert then still disagree. This does not fix the reported mismatch.

We use A.

## 4. Design

### 4.1 New module `src/lib/cashRunway.ts`

Pure functions. No React. Unit tests in `tests/unit/cashRunway.test.ts`.

```ts
export const RUNWAY_WINDOW_DAYS = 30;

// The last 30 calendar days, today included.
// differenceInDays(end, start) + 1 === 30, so the hook divides by 30.
export function getRunwayWindow(now: Date): { start: Date; end: Date } {
  return {
    start: startOfDay(subDays(now, RUNWAY_WINDOW_DAYS - 1)),
    end: endOfDay(now),
  };
}

// null = the value is not known yet (no data, or the query loads).
// Infinity = the net burn is 0 or less.
export function formatRunwayValue(daysOfCash: number | null): string;
//   null      -> "—"
//   Infinity  -> "Cash growing"
//   > 365     -> "365+d"
//   otherwise -> `${Math.floor(days)}d`

export function buildCashRunwayAlert(daysOfCash: number | null): CashRunwayAlert | null;
//   Returns null when daysOfCash is null, not finite, 0 or less, or 30 or more.
//   Otherwise: id "cash-runway", type "cash",
//   severity "critical" below 14 days, else "warning",
//   title `${Math.floor(days)} days of cash runway`,
//   description "Monitor cash flow closely",
//   action { label: "View Banking", path: "/banking" }.
```

The alert keeps the current thresholds, text and action
(`src/pages/Index.tsx:369-376`). Only the input changes.

The alert keeps the `> 0` guard. A restaurant with no connected bank has a
balance of 0. The hook then returns `daysOfCash = 0`
(`src/hooks/useLiquidityMetrics.tsx:130-132`). Without the guard, that
restaurant gets a false "0 days" alert.

### 4.2 `src/pages/Index.tsx`

1. Compute the window once per day:
   `const runwayWindow = useMemo(() => getRunwayWindow(new Date()), [todayKey])`,
   where `todayKey = format(new Date(), 'yyyy-MM-dd')`. The hook query key
   uses `yyyy-MM-dd` strings (`src/hooks/useLiquidityMetrics.tsx:34`), so
   the key is stable during the day.
2. Call `useLiquidityMetrics(runwayWindow.start, runwayWindow.end, 'all')`.
   Read `isLoading` from the hook too.
3. Set `cashRunway = liquidityLoading || !liquidityMetrics ? null : liquidityMetrics.daysOfCash`.
   Today `|| 0` changes `Infinity` to `Infinity` but changes a load state to
   `0`. The tile then shows a red "0d" while the query loads.
4. In `criticalAlerts`, replace lines 367-377 with
   `const runwayAlert = buildCashRunwayAlert(cashRunway); if (runwayAlert) alerts.push(runwayAlert);`.
   Put `cashRunway` in the memo dependencies. Delete `availableCash` from the
   dependencies if no other alert uses it.
5. Delete the `dailyAvgSpending` memo (lines 318-354).
6. Delete the `allTransactions` query (lines 86-88). Only
   `dailyAvgSpending` reads it (`grep -n allTransactions src/pages/Index.tsx`:
   lines 87, 320, 332, 354). This deletes an `autoLoadAll` fetch of every
   bank row on each dashboard load.
7. Delete `usePendingOutflowsSummary` (line 90) and its import (line 18)
   if nothing else reads `totalPendingOutflows`. Delete the
   `isTransferCategoryType` import (line 49) if nothing else uses it.
   Check each with `grep` before the delete.

`availableCash` (`src/pages/Index.tsx:300-308`) does not change. The tile
still shows the bank balance.

### 4.3 `src/components/dashboard/OwnerSnapshotWidget.tsx`

1. Change the prop to `cashRunway: number | null` (line 36).
2. Replace the local `formatRunway` (lines 75-78) with
   `formatRunwayValue` from `src/lib/cashRunway.ts`.
3. Change `getRunwayColor` (lines 69-73):
   - `null` gives `text-muted-foreground`.
   - `Infinity` gives the healthy color, as today.
   - The other thresholds do not change.
4. The value line (line 171) shows `formatRunwayValue(cashRunway)`. The
   helper adds the `d` suffix, so the JSX does not.
5. Change the tooltip text (line 166) to
   "Days of cash at the average net burn of the last 30 days. Target: 60+ days".

"Cash growing" is longer than "168d". The tile cell uses
`text-[20px] font-semibold`. Check the cell at 375 px and at 1024 px. If the
text wraps, use `text-[17px]` for the text value only.

### 4.4 What does not change

- `useLiquidityMetrics` does not change. Its tests do not change.
- `LiquidityTab` and `BankSnapshotSection` do not change.
- No SQL, RPC, RLS or migration change.

## 5. Effect on M2, M3 and M4

The approved rule says "one hook feeds the tile and the alert". Step 4.2
deletes the separate alert math. Thus:

- M2 (pending rows as spend): the separate math is deleted. The hook
  subtracts pending rows from the balance, and it does not count them as
  burn.
- M3 (deposits ignored): the hook uses net burn, so deposits count.
- M4 (missing dependency): the memo depends on `cashRunway`.

This PR does not make a separate change for M2, M3 or M4. They stop being
defects as a result of the approved M1 rule. The PR body states this, so
the reviewer can see it.

## 6. Known limits (follow-up, not in this PR)

1. **Stale pending outflows.** The hook subtracts rows with status
   `stale_30`, `stale_60` and `stale_90` from the balance
   (`src/hooks/useLiquidityMetrics.tsx:75`). An old check that never
   clears lowers book cash forever.
2. **Transfers.** The hook does not filter transfers. This is correct for a
   cash measure, and it is different from the P&L rule in
   `memory/lessons.md` ("Two transfer mechanisms must both be filtered out
   of P&L"). A transfer between two connected accounts gives one outflow
   and one inflow of the same amount, so the net is 0. A transfer to an
   account that is not connected (a loan payment, an owner draw, a card
   payment) is real cash that leaves. The runway must count it.
3. **Excluded rows.** The hook does not filter `excluded_reason`. An
   excluded duplicate row counts twice in the burn.
4. **Truncation.** The hook reads at most 20 pages of 1000 rows
   (`truncated`). 30 days of rows is well under that limit. The tile does
   not show the `truncated` flag.
5. **No bank balance.** A negative book balance gives `daysOfCash = 0`.
   The `> 0` guard hides the alert for this case, as today.

## 7. Merge with PR #834

PR #834 deletes `OwnerSnapshotWidget.tsx`. It moves the runway text to
`DashboardTodayCard.tsx` and `src/lib/formatRunway.ts`
(`formatRunwayDays(Infinity)` returns "365+ days").

Merge this PR first. It is small. Then rebase #834 on `main` and do these
steps:

- Use `cashRunway: number | null` and `formatRunwayValue` in
  `DashboardTodayCard`, or change `formatRunwayDays` so `Infinity` gives
  "Cash growing".
- Keep `buildCashRunwayAlert` for the attention list.
- Keep the `runwayLoading` skeleton from #834.

## 8. Tests

Unit (`tests/unit/cashRunway.test.ts`):

- `getRunwayWindow`: the start is 29 days before `now` at 00:00. The end is
  `now` at 23:59:59.999. `differenceInDays(end, start) + 1` is 30. Check a
  month edge and a DST edge (2026-03-08, 2026-11-01).
- `formatRunwayValue`: `null`, `Infinity`, 0, 0.9, 29.9, 365, 366.
- `buildCashRunwayAlert`: `null`, `Infinity`, `NaN`, 0, -5, 13.9
  (critical), 14 (warning), 29.9 (warning), 30 (null).

Hook (`tests/unit/useLiquidityMetrics.test.tsx`): add one case. Give a
30-day range with outflows of 3000 and inflows of 1500, and a balance of
1000. Expect `daysOfCash` of 20 (1000 ÷ (1500 ÷ 30)). Add one case with
inflows larger than outflows. Expect `Infinity`.

Source test (`tests/unit/indexCashRunway.test.ts`), with the pattern from
`tests/unit/indexLaborCostSection.test.ts`:

- `Index.tsx` calls `getRunwayWindow`.
- `Index.tsx` does not call `useLiquidityMetrics(todayStart, todayEnd`.
- `Index.tsx` calls `buildCashRunwayAlert`.
- `Index.tsx` does not contain `dailyAvgSpending` or `autoLoadAll`.

E2E: justified exception. A useful E2E needs connected banks, balances and
30 days of posted rows in the local database. No seed helper for that
exists in `tests/helpers/e2e-supabase.ts`. The logic sits in pure functions
with unit tests, and the hook math has hook tests. The existing dashboard
specs (`tests/e2e/dashboard-basis-labels.spec.ts`,
`tests/e2e/labor-cost-alignment.spec.ts`) must still pass. QA checks the
tile and the alert on the preview with real data.

## 9. Rollout

A frontend change only. No flag. After the deploy, the tile and the alert
show the same number for each restaurant. The number can change a lot for
a restaurant, because it now uses 30 days, not one day.
