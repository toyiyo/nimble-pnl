# Plan: hourly sales in the MCP connector (`get_hourly_sales`)

Design: `docs/superpowers/specs/2026-09-27-connector-hourly-sales-design.md`
Branch: `feature/connector-hourly-sales`. STE-aligned.

Rules for every task:

- Write the test first. Run it and see it fail. Then write the code.
- Stage explicit paths only. Never stage `progress.md`.
- Put no real restaurant or customer names in fixtures.

Order: Tasks 1–2 (SQL) come first. Tasks 3–6 (connector) and Tasks 7–8
(timeline) need Task 2. Tasks 3–6 and Tasks 7–8 do not depend on each other.

## Task 1 — RED: pgTAP for the RPC

File: `supabase/tests/77_get_hourly_sales_pattern.test.sql`.

Fixtures: two restaurants (A in `America/Chicago`, B with the bad zone
`'Not/AZone'`), one member user of A, one user with no membership. Set
`request.jwt.claims` for each caller.

Cases (design §5):

1. A non-member gets `Access denied to restaurant`.
2. Bad interval (45), bad view (`'x'`), reversed dates, a 367-day span →
   SQLSTATE `22023`.
3. `sale_date` 2026-09-13 (Sunday), `sold_at` 2026-09-14 03:30 UTC
   (22:30 local) → slot 1350 on DOW 0, not slot 210 (the UTC hour).
4. `sold_at` null, `sale_time` 16:40 → slot 990 at 30 min, slot 960 at 60.
5. 16:20 and 16:40 at 30 min → slots 960 and 990.
6. Average: slot 960 has sales on 2 of 4 Mondays → sum / 2, `sample_count` 2.
7. A child row (`parent_sale_id` set) and an `item_type = 'discount'` row are
   skipped.
8. Fallback: a weekday with no `sold_at` and no `sale_time` → 13 slots at 60
   (26 at 30), from 540 to 1260 (1290 at 30), each `day_total_avg / n`.
9. `by_date`: actual sums, `sample_count` 1, `day_total` includes rows
   without a slot, empty `slots` and `has_hourly_breakdown` false for a date
   with no slot.
10. `total_sales` equals the sum of all window rows.
11. DST: `sold_at` 2026-11-01 06:30 UTC (01:30 CDT) and 07:30 UTC (01:30
    CST) on the same `sale_date` → both in slot 60, `sample_count` 1.
12. Restaurant B → `time_zone` is `'America/Chicago'`.
13. A negative half average (−0.005) → `round(numeric, 2)` gives −0.01.
14. `has_function_privilege('anon', …, 'EXECUTE')` is false.

Run `npm run test:db`. The file must fail (the function does not exist).

## Task 2 — GREEN: the migration

File: `supabase/migrations/20260927120000_get_hourly_sales_pattern.sql`.

- Write the function from design §4.1: plpgsql, STABLE, SECURITY INVOKER,
  `SET search_path = public, pg_temp`.
- Guards in the design order. Use `ERRCODE = '22023'` for bad arguments.
- The `pg_timezone_names` guard reassigns the variable. Add the comment on
  `pg_catalog`.
- Build the output with CTEs and `jsonb_agg … ORDER BY`.
- `REVOKE ALL … FROM public, anon`. `GRANT EXECUTE … TO authenticated`.
- Add `COMMENT ON FUNCTION` with the rules.

Run `npx supabase db reset`, then `npm run test:db`. Task 1 must pass.
Run `EXPLAIN` of the base query for a 12-week window. Check that it uses
`idx_unified_sales_restaurant_keyset`.

## Task 3 — RED/GREEN: the staffing helper

Files: `supabase/functions/_shared/hourlyStaffing.ts`,
`tests/unit/hourlyStaffing.test.ts`.

- `minStaffFromCrew(minCrew, minStaff)` and
  `recommendStaffForHour(sales, targetSplh, minStaff)`.
- `recommendForSlots(slots, hourly, settings)`: each slot gets the value of
  the hour that contains it (decision 4).
- Parity test: for a grid of inputs (0, negative, fractional sales; 0 and
  null `target_splh`; null, empty and filled `min_crew`), compare with
  `buildHourlyRecommendations` and `computeMinStaffFromCrew` from
  `src/lib/staffingCalculator.ts`. The results must be equal.

## Task 4 — RED/GREEN: registry and gate

Files: `supabase/functions/_shared/tools-registry.ts`,
`tests/unit/tools-registry.test.ts`, `tests/unit/connectorRoles.test.ts`.

- Add the `get_hourly_sales` definition (design §4.3 parameters, with
  enums and bounds).
- Add it to `CAPABILITY_GATED_TOOLS`. Do not add it to `WRITE_TOOLS`.
- Tests: the tool is absent when `hasSchedulingOrPayroll === false`. The
  tool is present for owner and manager. The tool is read-only.

## Task 5 — RED/GREEN: the handler

Files: `supabase/functions/ai-execute-tool/index.ts`, a new
`supabase/functions/_shared/hourlySalesTool.ts` for the pure parts,
`tests/unit/hourlySalesTool.test.ts`,
`tests/unit/aiExecuteToolArgValidation.test.ts`.

- Pure parts in `hourlySalesTool.ts`: `parseHourlySalesArgs` (defaults,
  in-band `INVALID_ARGUMENTS`), `resolveWindow` (weekday: local today −
  `lookback_weeks` × 7; by_date: default last 7 days), `maxByDateDays` (31,
  15, 7 with the byte-budget comment), `formatHourlySales` (compact rows,
  `HH:MM`, notes, fallback note).
- `executeGetHourlySales` in ai-execute-tool: read `staffing_settings`
  merged over the defaults, call the RPC, call it again at 60 min for a
  sub-hour view, map `22023` to `INVALID_ARGUMENTS`, return `{ ok, data,
  evidence }` like `executeGetDailySalesTotals`.
- Add the `switch` case.
- Tests: defaults, each bad argument, the by_date limit for each interval,
  sub-hour rows take the hour value, a fallback day has the note, and the
  worst-case output (every slot filled, largest values, max days) has
  `JSON.stringify(...).length <= 40_000`.

## Task 6 — Titles, docs and prompts

Files: `supabase/functions/_shared/mcpHandler.ts`,
`tests/unit/mcpHandler.test.ts`, `docs/CLAUDE_INTEGRATION.md`,
`supabase/functions/ai-chat-stream/index.ts`.

- `MCP_TOOL_TITLES.get_hourly_sales = 'Get hourly sales'`. Test the title
  and `readOnlyHint`.
- One sentence in `INSTRUCTIONS` and one line in the labor prompt (design
  §4.4).
- One row in the `## Tools` table.

## Task 7 — RED/GREEN: the timeline hook

Files: `src/hooks/useWeekStaffingSuggestions.ts` and its tests.

- Change the tests first (design §4.2 list):
  `useWeekStaffingSuggestions.pagination.test.ts`,
  `useWeekStaffingSuggestions.tz.test.ts`,
  `useWeekStaffingSuggestions.actualSplh.test.ts`,
  `StaffingOverlay.tz.test.tsx`. Add a test for a weekday that is absent
  from `days[]`.
- Then change the hook: one `supabase.rpc` call, the same query key and
  options, the mapping, `computeActualSplh(totalSales, punches)`.
- Run the other tests that name the hook (`shiftTimelineTab*.test.tsx`,
  `StaffingOverlay.*.test.tsx`, `shiftPlannerTab.*.test.tsx`). They must
  pass with no change, or with a change to the sales mock only.
- Run `npx supabase gen types` or add the RPC to
  `src/integrations/supabase/types.ts` by hand, so `npm run typecheck`
  passes.

## Task 8 — Delete the old code

- Delete `src/hooks/useHourlySalesPattern.ts` and
  `tests/unit/useHourlySalesPattern.test.ts`.
- Delete the entry in `tests/unit/highVolumeQueryGuard.test.ts:48`.
- Change the comments at `src/lib/splhAnalytics.ts:52`, `:187` and
  `src/lib/salesTrends.ts:600` to name the RPC.
- `grep -rn "useHourlySalesPattern\|aggregateHourlySales" src tests supabase`
  must return nothing.

## Task 9 — E2E

File: `tests/e2e/staffing-suggestions.spec.ts` (test at :69).

- Wait for the `rpc/get_hourly_sales_pattern` response. Assert status 200.
- Assert that the first suggested block starts at the first seeded sales
  hour.

Run `npx playwright test tests/e2e/staffing-suggestions.spec.ts
--reporter=line` in the foreground.

## Task 10 — Verify

Run `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run test`,
`npm run build`. All must pass. Then Phases 5–9 of the workflow.
