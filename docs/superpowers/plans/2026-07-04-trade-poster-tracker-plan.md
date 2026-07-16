# Plan: Trade poster status-tracker + shift-email timezone fix

Design: `docs/superpowers/specs/2026-07-04-trade-poster-tracker-design.md`
Branch: `feature/trade-poster-tracker`

RED → GREEN → REFACTOR → COMMIT per task. No migration.

## Task 1 — Pure progress helper
- **RED:** `tests/unit/tradeStatusProgress.test.ts` — all four status mappings
  (steps + states + labels + summary), ghost `accepted_by` → "a teammate",
  rejected step-state handling.
- **GREEN:** `src/lib/tradeStatusProgress.ts` (`getPosterTradeProgress`,
  `TradeStep`, `PosterTradeProgress`).
- **Commit:** `feat(scheduling): getPosterTradeProgress helper`

## Task 2 — `useMyTradeActivity` hook + shared invalidation helper
- **RED:** `tests/unit/useMyTradeActivity.test.ts` — mock builder: TWO separate
  sibling `.or()` groups (AND-ed; comment at call site), status IN, order,
  cutoff computed in queryFn (stable key), disabled without ids. Plus a test
  that `invalidateShiftTradeQueries` hits all three keys.
- **GREEN:** in `src/hooks/useShiftTrades.ts`: export
  `type ShiftTradeStatus = ShiftTrade['status']`; add module-level
  `invalidateShiftTradeQueries(queryClient)` (invalidates `['shift_trades']`,
  `['marketplace_trades']`, `['my_trade_activity']`) and call it from all six
  mutations' onSuccess (replacing the repeated per-key calls; `['shifts']`
  extras stay); add `useMyTradeActivity`. Code comments: non-user-controlled
  interpolation (UUID + ISO), intentional AND-of-two-`.or()`.
- **Commit:** `feat(scheduling): useMyTradeActivity hook + shared invalidation`

## Task 3 — "My shift trades" card on EmployeeSchedule
- Replace "Pending Trade Requests" card: partition activity into postedByMe /
  claimedByMe; poster rows get stepper (`role="img"` + aria-label summary;
  labels hidden below `sm` with visible summary line instead) + manager_note on
  rejected (neutral `bg-muted/30` block, "Manager note:" prefix) + Withdraw
  (open only; single confirm dialog via useCancelShiftTrade; focus restored to
  a stable section-header ref on close — success unmounts the trigger);
  claimant rows get status line + manager_note.
- **Verify:** targeted unit tests + `npm run typecheck && npm run lint`.
- **Commit:** `feat(scheduling): poster status-tracker on EmployeeSchedule`

## Task 4 — Shift-email timezone
- **RED:** `tests/unit/notificationHelpers.getRestaurantInfo.test.ts` — happy
  path, error fallbacks, null timezone → 'America/Chicago'.
- **GREEN:** add `getRestaurantInfo` to `_shared/notificationHelpers.ts`; use in
  `send-shift-notification/index.ts`; pass tz to all four `formatDateTime` calls.
- **Commit:** `fix(scheduling): shift emails use restaurant timezone`

## Dependencies
1 → 3, 2 → 3. Task 4 independent. 1, 2, 4 parallelizable.

## Verification gate (Phase 8)
`npm run test && npm run typecheck && npm run lint && npm run build` green.
No supabase/ SQL diff → test:db unaffected (CI covers).
