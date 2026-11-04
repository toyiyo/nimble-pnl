# Plan: Delete the dead component TradeMarketplace

Design: `docs/superpowers/specs/2026-09-26-delete-trade-marketplace-design.md`
Branch: `chore/delete-trade-marketplace`

## Task 1: Delete the component and its test

This task adds no behavior, so it has no RED step. The typecheck is the gate.

1. Run `grep -rn "TradeMarketplace" src tests`. Check that the output shows
   only the two files below.
2. Delete `src/components/schedule/TradeMarketplace.tsx`.
3. Delete `tests/unit/TradeMarketplace.tentative.test.tsx`.
4. Run `grep -rn "TradeMarketplace" src tests`. Check that the output is empty.
5. Run `npm run typecheck`. Check that it passes.
6. Run `npm run lint`. Check that it shows no new error.
7. Run `npm run test`. Check that it passes.
8. Commit with explicit paths:
   `git rm src/components/schedule/TradeMarketplace.tsx tests/unit/TradeMarketplace.tentative.test.tsx`.
   Message: `chore(schedule): delete the dead TradeMarketplace component`.

## Phase 8 gates

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- E2E: justified exception. No route mounts the component.
- `npm run test:db`: justified exception. The change touches no SQL.
