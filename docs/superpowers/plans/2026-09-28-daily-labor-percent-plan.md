# Daily labor cost % — plan

Design: `docs/superpowers/specs/2026-09-28-daily-labor-percent-design.md`

1. Write `tests/unit/dailyLaborPercent.test.ts` (fails). Add
   `src/lib/dailyLaborPercent.ts`. Commit.
2. Write `tests/unit/useDailyLaborPercent.test.ts` (fails). Add
   `src/hooks/useDailyLaborPercent.ts`. Commit.
3. Write `tests/unit/dailyLaborPercentBadge.test.tsx` (fails). Add
   `src/components/scheduling/DailyLaborPercentBadge.tsx`. Commit.
4. Add the optional `laborPercent` prop to `ScheduleDayHeaderContent`. Extend
   its test. Wire `Scheduling.tsx`. Commit.
5. Add the optional `laborPercentByDay` prop to `TemplateGrid`. Extend its
   test. Commit.
6. Add the optional `laborPercentByDay` prop to `ShiftTimelineTab` day
   buttons. Wire both props in `ShiftPlannerTab.tsx`. Commit.
7. Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
8. Push the branch.
