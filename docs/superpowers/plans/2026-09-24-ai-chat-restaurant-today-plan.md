# Plan: AI chat uses the restaurant's local date as "today"

Design: `docs/superpowers/specs/2026-09-24-ai-chat-restaurant-today-design.md`

## Task 1 — Pure date module (TDD)
1. Write `tests/unit/restaurantDate.test.ts`. Cover `restaurantWallClock`,
   `ymdInTimeZone`, `toLocalYMD`, `addDays`, and `calculateDateRange` with an
   injected `now`. Include `2026-09-25T02:00:00Z` → `2026-09-24` in
   `America/Chicago`. Run it and see it fail.
2. Create `supabase/functions/_shared/restaurantDate.ts`. Move
   `calculateDateRange` and `toLocalYMD` from `ai-execute-tool/index.ts`.
3. Run the test and see it pass. Commit.

## Task 2 — Real function in the existing date test
1. Change `tests/unit/ai-tools-date-resolution.test.ts` to import
   `calculateDateRange` from the new module. Delete the copy. Commit.

## Task 3 — `ai-execute-tool` uses the restaurant clock
1. Write a source-contract test (`tests/unit/ai-restaurant-today-wiring.test.ts`).
   It fails while the handler does not resolve the timezone.
2. Resolve the timezone in `serve`. Pass `clock` to the executors in the
   design. Change the calendar-day `toISOString` calls. Keep labor paths on
   the server clock.
3. Run the tests. Run `npm run typecheck`. Commit.

## Task 4 — `ai-chat-stream` prompt date
1. Extend the wiring test: the prompt uses the resolved timezone date.
2. Change `ai-chat-stream/index.ts`. Run the tests. Commit.

## Task 5 — Verify
`npm run test`, `npm run test:tz` for the new tests, `npm run typecheck`,
`npm run lint`, `npm run build`, and `deno check` on both edge functions if
`deno` is available.
