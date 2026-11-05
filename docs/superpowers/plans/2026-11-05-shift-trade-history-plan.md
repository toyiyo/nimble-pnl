# Shift trade history plan

Design: `docs/superpowers/specs/2026-11-05-shift-trade-history-design.md`

No migration. No RLS change. Follow TDD for each task. Commit each task.

## Task 1: Outcome and party helpers

- Write `tests/unit/shiftTradeHistory.test.ts`.
- Create `src/lib/shiftTradeHistory.ts` with `CLOSED_TRADE_STATUSES`,
  `TradeHistoryFilter`, `getTradeHistoryOutcome`, and `getTradeHistoryParties`.

## Task 2: History hook

- Write `tests/unit/useShiftTradeHistory.test.ts`.
- Export `hasValidJoins` from `src/hooks/useShiftTrades.ts`.
- Create `src/hooks/useShiftTradeHistory.ts`.
- The Supabase mock must implement every chain method that the hook calls.

## Task 3: History section

- Write `tests/unit/TradeHistorySection.test.tsx`.
- Create `src/components/schedule/TradeHistorySection.tsx`.

## Task 4: Page wiring

- Render `TradeHistorySection` under `TradeApprovalQueue` in
  `src/pages/Scheduling.tsx`, with `restaurantId` and `restaurantTimezone`.
- Check `tests/unit/scheduling-trades-gate.test.tsx`. Mock the new section
  there if the test does not provide a `QueryClient`.

## Task 5: Full check

- Run `npm run typecheck`, `npm run lint`, and `npm run test`.
