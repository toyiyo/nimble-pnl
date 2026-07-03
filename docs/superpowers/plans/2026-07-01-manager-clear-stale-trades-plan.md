# Plan: Manager clears stale trades + email restaurant-timezone fix

Design: `docs/superpowers/specs/2026-07-01-manager-clear-stale-trades-design.md`
Branch: `feature/manager-clear-stale-trades`

Each task is RED → GREEN → REFACTOR → COMMIT. No DB migration.

## Task 1 — Pure expired-detection helper
- **RED:** `tests/unit/shiftTradeStatus.test.ts` — `isTradeExpired(startIso, now)`:
  past→true, future→false, exactly-now→false, undefined→false.
- **GREEN:** create `src/lib/shiftTradeStatus.ts` with the pure function.
- **Commit:** `feat(scheduling): isTradeExpired helper`

## Task 2 — `useDeleteShiftTrade` mutation hook
- **RED:** `tests/unit/useShiftTrades.deleteTrade.test.ts` — mock
  `from().delete().eq().in()`; assert (a) success invalidates `['shift_trades']`
  + `['marketplace_trades']` + success toast; (b) resolved `{ error }` → throws →
  destructive toast; (c) thrown transport error → destructive toast.
- **GREEN:** add `useDeleteShiftTrade` to `src/hooks/useShiftTrades.ts` with the
  `.in('status', ['open','pending_approval'])` guard, no `['shifts']` invalidation,
  no email.
- **Commit:** `feat(scheduling): useDeleteShiftTrade hook`

## Task 3 — Manager cleanup UI in `TradeApprovalQueue.tsx`
- Partition `openTrades` → `{ expired, active }` (single pass) and `pendingTrades`
  → `{ stalePending, normalPending }` using `isTradeExpired` + `!accepted_by`.
- `OpenTradeCard`: add `expired`, `onRemove`, `isRemoving` props; Expired badge
  (`<Badge variant="outline">`) + `<Button variant="destructive">` Remove.
- Render Expired group (removable) + Active group (read-only); "Needs cleanup" row
  for `stalePending`; feed `normalPending` to existing `TradeRequestCard`.
- "Remove all expired (N)" bulk button; disabled when `deletingIds.size > 0`.
- `deletingIds: useState<Set<string>>`; add on start, remove in `onSettled`;
  per-row spinner via `deletingIds.has(id)`.
- Single confirm dialog with `ConfirmTarget` discriminated union
  (`{type:'single',trade} | {type:'bulk',ids} | null`); restore focus on close.
- **Verify:** `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- **Commit:** `feat(scheduling): managers remove stale/expired shift trades`

## Task 4 — Email renders restaurant timezone
- **RED:** `tests/unit/emailTemplates.formatDateTime.test.ts` — same UTC instant →
  different string for `America/Chicago` vs `America/New_York`; omitted tz = back-compat.
- **GREEN:** add optional `timeZone?: string` to `_shared/emailTemplates.ts`
  `formatDateTime`; in `send-shift-trade-notification/index.ts` use the shared
  helper, add `timezone` to the restaurant embed, pass
  `trade.restaurant?.timezone || 'America/Chicago'`. Remove the file-local dup.
- **Commit:** `fix(scheduling): shift-trade email uses restaurant timezone`

## Task 5 — Follow-up flag (no code)
- Spawn a background task for the `send-shift-notification` identical UTC bug.

## Dependencies
1 → 3 (helper used by UI). 2 → 3 (hook used by UI). 4 independent. 1,2,4 parallelizable.

## Verification gate (Phase 8)
`npm run test && npm run typecheck && npm run lint && npm run build` all green,
plus `npm run test:db` (no SQL change, should be unaffected).
