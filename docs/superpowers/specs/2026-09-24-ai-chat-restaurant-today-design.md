# AI chat: use the restaurant's local date as "today"

## Problem

A user asked the AI chat for "a report of today's sales by category". The AI
answered "there is no data available for this period". The restaurant had
sales for that day.

## Root cause

1. `supabase/functions/ai-chat-stream/index.ts:530` writes
   `new Date().toISOString().split('T')[0]` into the system prompt as
   "Current date". Edge functions run in UTC. After 19:00 CDT the UTC date is
   the next day. The model sends that date to `generate_report`, which
   requires explicit `start_date` / `end_date`
   (`supabase/functions/_shared/tools-registry.ts:693`).
2. `get_sales_by_category` filters `us.sale_date >= p_start_date AND
   us.sale_date <= p_end_date`
   (`supabase/migrations/20260814141000_get_sales_by_category.sql`). A
   future date matches 0 rows.
3. `calculateDateRange` in `supabase/functions/ai-execute-tool/index.ts:57`
   reads `new Date()` (line 62). Its fields are UTC fields on the edge
   runtime, so `period: 'today'` also resolves to the UTC day.
4. Other day math in the same file uses `toISOString().split('T')[0]`:
   lines 762, 763, 782, 797, 798, 1372, 1373, 1445, 1446, 2273, 2274, 2315,
   2751, 2752. `executeGetScheduleOverview` (line 2257),
   `executeGetMonthlyTrends` (line 2747) and `executeGetBreakEvenProgress`
   (line 3046) read `new Date()` directly.

The restaurant timezone is in `restaurants.timezone`. The helper
`resolveRestaurantTimeZone` (`supabase/functions/_shared/timezone.ts:169`)
reads it and falls back to `America/Chicago` (`timezone.ts:15`) on a missing
or invalid value.

## Design

### New pure module: `supabase/functions/_shared/restaurantDate.ts`

No Deno imports, so Vitest can import it.

- `restaurantWallClock(instant: Date, timeZone: string): Date` — returns a
  `Date` whose local fields (`getFullYear`, `getMonth`, `getDate`,
  `getHours`, ...) equal the wall clock in `timeZone` at `instant`. It uses
  `Intl.DateTimeFormat.formatToParts` with `hourCycle: 'h23'` and `safeTz`,
  and maps hour "24" to 0 (same pattern as `timezone.ts:67-79`).
- `ymdInTimeZone(instant: Date, timeZone: string): string` — the
  `YYYY-MM-DD` calendar day in `timeZone`.
- `toLocalYMD(d: Date): string` — moved from `ai-execute-tool/index.ts:47`.
- `addDays(d: Date, n: number): Date` — calendar-day offset on local fields.
- `daysBetweenYmd`, `laborServerNow` and `laborWindowMismatchReason`.
- `calculateDateRange(period, customStart, customEnd, now)` — moved from
  `ai-execute-tool/index.ts:57`. The new required `now` argument replaces the
  internal `new Date()`. The body does not change otherwise.

### `ai-execute-tool`

- The `serve` handler calls `resolveRestaurantTimeZone(supabase,
  restaurant_id)` once. It builds `restaurantNow =
  restaurantWallClock(new Date(), timeZone)`.
- Each executor that reads the date gets `restaurantNow` as a 4th argument.
  `calculateDateRange(..., restaurantNow)` replaces the old call.
- Each `toISOString().split('T')[0]` for a calendar day changes to
  `toLocalYMD(...)` on a date from `restaurantNow`. This includes line 1442,
  which feeds lines 1445 and 1446.

### `ai-chat-stream`

- Resolve the timezone with `resolveRestaurantTimeZone(supabase,
  projectRef)` after the access check (line 505).
- The prompt says: `Current date: <local YMD> (restaurant local date,
  timezone <tz>) ...`. Line 541 uses the same value.

## Decided trade-offs

- **Labor paths keep the server clock.** `laborCalculations.ts:547` puts
  each punch period into a day with `formatDateLocal`, which reads runtime
  local (UTC) fields. Punch fetch windows use `startDate.toISOString()`
  (`ai-execute-tool/index.ts:266`, `:2017`, `:2366`). A restaurant-day window
  in this UTC frame drops the evening clock-ins (Phase 2.5 review, major).
  A correct fix changes the labor engine. That is a separate PR. So these
  paths keep `new Date()` and do not change:
  - the labor block of `executeGetKpis` (a second `calculateDateRange` call
    with the server clock, `laborRange`);
  - `executeGetLaborCosts`, `executeGetTimePunches`,
    `executeGetPayrollSummary` (through `fetchLaborData` and line 2366);
  - `executeGetScheduleOverview` (shift instants at line 2282 and the
    grouping key at line 2315).
- In `get_kpis`, sales use the restaurant clock and labor uses the server
  clock. When the two windows are different days, `get_kpis` omits the
  labor, prime cost and profitability figures and returns
  `labor_omitted.reason` (`laborWindowMismatchReason`). It does not report a
  wrong labor % (Phase 7a sound-logic review, major).
- **Rule for the wall-clock Date.** Build it only with the local constructor
  `new Date(y, m, d, h, mi, s)`. Never call `toISOString()` or `getTime()` on
  a `clock.now`-derived Date to get an instant. Use `toLocalYMD` for a day.
- One extra `restaurants` select per tool call. The filter is on the primary
  key `restaurants.id`.

## Tests

- `tests/unit/restaurantDate.test.ts` (assertions do not depend on the
  host timezone; also run under `npm run test:tz`): `2026-09-25T02:00:00Z` is
  `2026-09-24` in `America/Chicago` and `2026-09-25` in `UTC`;
  `calculateDateRange('today', ..., now)` gives `2026-09-24` for that
  instant in Chicago; winter (CST) and a positive-offset zone
  (`Pacific/Auckland`); an invalid zone falls back to the default.
- `tests/unit/ai-tools-date-resolution.test.ts`: import the real
  `calculateDateRange` and delete the copied one.
- Source-contract test: `ai-chat-stream/index.ts` and
  `ai-execute-tool/index.ts` contain no `toISOString().split('T')[0]` for
  calendar days, and the prompt uses the resolved timezone.

## E2E

Justified exception: the AI chat calls OpenRouter. CI cannot drive a model
conversation to a deterministic tool call. The unit tests cover the date
logic, and the source-contract test covers the wiring.

## Deferred review findings

- `ai-execute-tool` resolves the timezone for every tool, also for tools
  that do not read the date (performance, minor). It is one primary-key
  select. A lazy clock adds code for a small gain.
- Embed `restaurants(timezone)` in the `user_restaurants` access select to
  save one round trip (performance, minor). Deferred to keep the access
  check unchanged.
- `get_sales_summary` `year` comparison rolls over on Feb 29 (logic, minor).
  The bug is older than this change.
- `any` parameters on the changed executor signatures (ocr, minor). The
  types are older than this change. Only the trailing comma is new.
- Log of the raw `restaurants.timezone` in `timezone.ts:198` (security,
  minor). The line is older than this change.
