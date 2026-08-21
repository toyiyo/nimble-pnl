# Design: show the selected period in the "Net Cash Flow" tile

Date: 2026-08-21
Branch: `fix/pulse-period-net`

## Problem

The Financial Pulse hero card shows a 7-day net in its headline tile.
The user selects a period, for example "This Quarter". Every other
figure on the page covers the selected period. The 7-day tile does not.
The user reported the mismatch as confusing. Decision: the tile must
match the selection.

Live example (2026-08-21, "This Quarter"): the tile showed $7,041 for
the last 7 days. The section below showed $6,919 for the 52-day period.

## Current behavior (citations)

- The tile renders `metrics.netCashFlow7d`
  (`src/components/banking/FinancialPulseHero.tsx:91`,
  `:97`, `:105`, `:107`).
- The tile label renders `({periodDays <= 7 ? periodDays : 7} days)`
  (`src/components/banking/FinancialPulseHero.tsx:95`).
- `deriveCashFlowMetrics` computes `netCashFlow7d` from the last 7
  calendar days of the period (`src/lib/cashFlowMetrics.ts:46-53`).
- The fields named `*30d` hold full-period totals, not 30-day totals
  (`src/lib/cashFlowMetrics.ts:42-44`). The suffix is a misnomer.
- `FinancialPulseHero` also reads `netCashFlow30d` and `netInflows30d`
  (`src/components/banking/FinancialPulseHero.tsx:144`, `:198`).
- `BankSnapshotSection` reads `netCashFlow30d`
  (`src/components/BankSnapshotSection.tsx:44`).
- No other file reads the `7d` fields (repo grep, 2026-08-21). After
  the tile change, the `7d` fields have zero consumers.

## Change

1. `src/lib/cashFlowMetrics.ts`
   - Rename `netInflows30d` to `totalInflows`.
   - Rename `netOutflows30d` to `totalOutflows`.
   - Rename `netCashFlow30d` to `netCashFlow`.
   - Delete `netInflows7d`, `netOutflows7d`, `netCashFlow7d`.
   - Keep `avgDailyCashFlow`, `volatility`, `trend`,
     `trailingTrendPercentage` unchanged.
2. `src/components/banking/FinancialPulseHero.tsx`
   - Show `metrics.netCashFlow` in the "Net Cash Flow" tile.
   - Show `{selectedPeriod.label}` as the tile subtext. This matches
     the "Avg Daily Flow" tile subtext
     (`src/components/banking/FinancialPulseHero.tsx:132`).
   - Change the two `*30d` reads to the new names.
3. `src/components/BankSnapshotSection.tsx`
   - Change `netCashFlow30d` to `netCashFlow`. The value does not
     change.
4. Tests
   - Change `tests/unit/cashFlowMetrics.test.ts` and
     `tests/unit/useCashFlowMetrics.test.tsx` to the new names.
   - Delete the 7-day assertions and retitle the first case in
     `tests/unit/cashFlowMetrics.test.ts:11-28`. Keep the assertion
     that the period fields sum the full `daily` array.
   - Add a case to `tests/unit/FinancialPulseHero.test.tsx`: the tile
     shows the period net and the period label for a period longer
     than 7 days.
5. Icon condition (design-review finding)
   - `FinancialPulseHero.tsx:97` uses `> 0` for the trend icon. The
     prefix at `:107` uses `>= 0`. Align the icon condition to `>= 0`
     so a $0 net shows the up icon with the `$` prefix.

## Decided trade-offs

- `totalInflows`/`totalOutflows` also exist in other banking hooks
  with different scopes (`src/hooks/useSpendingAnalysis.tsx:34`,
  `src/hooks/useOutflowByCategory.tsx:18`,
  `src/hooks/useRevenueHealth.tsx:172`). The interfaces are separate.
  Accept the reuse; the names state the period scope correctly.

## Alternatives not taken

- Keep the 7-day tile and add a period tile: the user asked for a
  match, not a second tile.
- Keep the `7d` fields as dead exports: dead code invites reuse of a
  misleading metric.

## Out of scope

- The RPC `get_cash_flow_metrics` does not change.
- The volatility and trend math does not change.
