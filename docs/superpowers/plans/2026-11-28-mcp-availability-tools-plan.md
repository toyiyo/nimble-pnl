# MCP Availability Tools: Plan

Design: `docs/superpowers/specs/2026-11-28-mcp-availability-tools-design.md`
Branch: `claude/gallant-lovelace-745b9z`

Each task is TDD: write the failing test, make it pass, commit with explicit
paths. Run the tasks in order.

## Task 0: Unblock the test tools

- Get `npm install` to work (the `cdn.sheetjs.com` host is blocked). Ask the
  user to allow the host, or install with `--omit=optional` if `xlsx` is not
  needed by Vitest.
- Check: `npx vitest --version`.

## Task 1: Pure time helpers

File: `supabase/functions/_shared/mcpAvailabilityTools.ts` (pure section).
Test: `tests/unit/mcpAvailabilityTools.test.ts`.

1. `parseDay`, `parseClock` (`HH:MM`, reject `24:00`), `parseWriteInput`.
2. `exceptionLocalToUtc(date, hhmm, tz)`: port of `localTimeToUtcTime`, with
   gap detection. Parity test against `src/lib/availabilityTimeUtils.ts` on the
   DST date table of design section 10.
3. `exceptionUtcToLocal(date, startUtc, endUtc, tz)`: canonical reader.
4. `uiShows(date, utc, tz)`: the UI rule. `display_mismatch` on
   2027-03-14 and 2027-11-07 at 20:00.

## Task 2: Conflict check

1. `shiftConflicts(shifts, window, tz)`: pure. Cases: inside, outside,
   overnight window, midnight end, closed day.
2. `recurringTargetDates(today, dow, exceptionDates)`: 28 days, skip exception
   dates into `skipped_dates`.

## Task 3: SQL functions and pgTAP

File: `supabase/migrations/20261128120000_mcp_availability_writes.sql`.
Test: `supabase/tests/mcp_availability_writes.test.sql`.

1. `availability_write_token`.
2. `mcp_set_recurring_availability` with the lock order of design section 6.
3. `mcp_set_availability_exception` with the SQL local-to-UTC rule and gap
   check.
4. pgTAP cases of design section 10.

## Task 4: Handlers

1. `runGetAvailability`, `runUpdateAvailability`, `runAddAvailabilityException`
   with an injected client. Unit tests with a fake client: preview shape,
   token pass-through, `40001` to `STALE_PREVIEW`, role deny.
2. `canUseAvailabilityTool(name, restaurantId, client)`.

## Task 5: Register and dispatch

1. `tools-registry.ts`: push the definitions, add to `WRITE_TOOLS`, route the
   gate.
2. `aiWriteTools.ts`: add the 2 write names.
3. `ai-execute-tool/index.ts`: 3 `case` lines.
4. Unit test: registry lists, `missingRequiredArgs`, MCP `destructiveHint`.

## Task 6: Docs

1. `docs/CLAUDE_INTEGRATION.md`: tool list.
2. Follow-up issue text for the exception reader bug (design section 3).

## Task 7: Verify and ship

`npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`,
`.claude/skills/run-tla/tlc.sh all`. pgTAP in CI. Then the PR to `main`.
