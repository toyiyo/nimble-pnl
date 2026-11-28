# Plan: find_coverage MCP tool

Design: `docs/superpowers/specs/2026-11-28-find-coverage-design.md`
Branch: `claude/sharp-mendel-jbpkq0`

Use TDD for each task: write the failing test, run it, write the code, run it
again. The design doc is authoritative. Do not change behavior that the
design does not name. Commit each task with explicit paths only.

## Task 1. SQL batch RPC (pgTAP first)

1. Write `supabase/tests/get_slot_conflicts.test.sql` (design §5.1).
   Cases: approved time off, pending time off, recurring unavailable day,
   slot outside the availability window, no conflict (empty array),
   `has_recurring_availability` true and false, inactive employee skipped,
   other restaurant skipped, `p_end <= p_start` raises, a 26 h window
   raises, `anon` has no EXECUTE.
2. Run `npm run test:db`. Expect a failure.
3. Write `supabase/migrations/20261128120000_get_slot_conflicts.sql`.
4. Run `npm run db:reset` and `npm run test:db`. Expect a pass.
5. Seed 500 employees on the local database and run
   `EXPLAIN (ANALYZE, BUFFERS)` for an overnight slot. Write the time in
   `progress.md` for the PR body. If local Supabase cannot run, write that.

## Task 2. Pure helpers: slot warnings, week hours, streak

0. Export `paidShiftHours(s)` from `schedulingContext.ts` and call it in
   `buildRoster`. Add a unit test. `tests/unit/getSchedulingContext.test.ts`
   must stay green.

1. Write `tests/unit/findCoverage.test.ts` for `slotWarnings`,
   `weekHours` and `consecutiveDays` (design §5.3).
   Include: short rest before and after the slot, overlap (one reason, not
   two), overnight slot against a next-day morning shift, cancelled shifts
   skipped, breaks subtracted, streak gap, streak across the week edge.
2. Write `supabase/functions/_shared/findCoverage.ts`. Import
   `findShiftWarnings` and `MIN_REST_HOURS` from `shiftWarnings.ts`,
   `longestConsecutiveRun` from `schedule-validator.ts`, and
   `paidShiftHours` from `schedulingContext.ts`. No Deno globals, no I/O.

## Task 3. `rankCoverage`: rules and rank order

1. Add tests: each HARD reason (`overlap`, `time_off_approved`,
   `availability`), more than one reason, each SOFT flag
   (`short_rest`, `time_off_pending`, `over_hour_cap`,
   `over_consecutive_days`), each rank key in
   design §4.3, one mixed list, local times and `tz` in the output.
2. Write `rankCoverage` in `findCoverage.ts`. Use `computeHourBudget`
   for `max_weekly_hours`.

## Task 4. Loader `mcpFindCoverageTool.ts`

1. Write `tests/unit/mcpFindCoverageTool.test.ts` with a mock client.
   Cases: bad `date`, `24:00`, `25:00`, `end == start`, bad `limit`,
   overnight slot instants, fall-back DST night (9 h), spring-forward start,
   RPC error, RPC at 1000 rows, near shifts at 1000 rows (error), wide
   shifts at the page cap (`data_limits`), text-size trim.
2. Write `supabase/functions/_shared/mcpFindCoverageTool.ts` (design §5.2).

## Task 5. Register the tool

1. Add tests to `tests/unit/tools-registry.test.ts`: `find_coverage` is in
   `CAPABILITY_GATED_TOOLS`, `missingRequiredArgs` returns
   `date`, `start`, `end`, and the description names the rank order.
2. Add the definition to `tools-registry.ts` and add the name to
   `CAPABILITY_GATED_TOOLS`.
3. Add one import and one `case` to `ai-execute-tool/index.ts`.
4. Run `npm run test`, `npm run typecheck`, `npm run lint`.
