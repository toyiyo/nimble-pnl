# Recent Tip Splits: mobile button row (plan)

Design: `docs/superpowers/specs/2026-10-27-recent-tip-splits-mobile-design.md`

1. Write `tests/e2e/tip-splits-mobile.spec.ts`. Seed an approved split, set
   a 390x844 viewport, and click "View audit trail". Run it and see it fail
   with "element is outside of the viewport".
2. Change the class names in `src/components/tips/RecentTipSplits.tsx` as the
   design says. Run the spec again and see it pass.
3. Run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
4. Check the 1280px layout in the browser.
5. Commit and push to the session branch.
