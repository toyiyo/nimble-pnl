# Plan: marketplace trade cards in the restaurant time zone

Design: `docs/superpowers/specs/2026-09-25-marketplace-trade-time-zone-design.md`

1. RED: add tests for `tradeDateLabel` and `tradeTimeRange` in
   `tests/unit/claimableTrades.test.ts` (zone `Pacific/Kiritimati`).
2. GREEN: add the two helpers to `src/lib/claimableTrades.ts`.
3. Change `UpForGrabsCard` to use `tradeTimeRange`. Run its tests.
4. RED: set the restaurant zone in `AvailableShiftsPage.tradeCard.test.tsx`
   to `Pacific/Kiritimati`. Add tests for the trade date, the trade time and
   the My Claims date. Change the "time edited" test to expect zone labels.
5. GREEN: compute the labels in the page, pass `dateLabel` and `timeLabel`
   to `TradeCard`, add both to the memo compare function.
6. Verify: `npm run test:tz` for the touched files, `npm run typecheck`,
   `npm run lint`, `npm run build`.
