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
   (`supabase/functions/_shared/tools-registry.ts:694`).
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
  `Intl.DateTimeFormat.formatToParts` and `safeTz`.
- `ymdInTimeZone(instant: Date, timeZone: string): string` — the
  `YYYY-MM-DD` calendar day in `timeZone`.
- `toLocalYMD(d: Date): string` — moved from `ai-execute-tool/index.ts:47`.
- `addDays(d: Date, n: number): Date` — calendar-day offset on local fields.
- `calculateDateRange(period, customStart, customEnd, now)` — moved from
  `ai-execute-tool/index.ts:57`. The new required `now` argument replaces the
  internal `new Date()`. The body does not change otherwise.

### `ai-execute-tool`

- The `serve` handler calls `resolveRestaurantTimeZone(supabase,
  restaurant_id)` once. It builds `clock = { now:
  restaurantWallClock(new Date(), timeZone), timeZone }`.
- Each executor that reads the date gets `clock` as a 4th argument.
  `calculateDateRange(..., clock.now)` replaces the old call.
- Each `toISOString().split('T')[0]` for a calendar day changes to
  `toLocalYMD(...)` on a date from `clock.now`. The shift grouping key at line
  2315 changes to `ymdInTimeZone(new Date(shift.start_time), clock.timeZone)`.

### `ai-chat-stream`

- Resolve the timezone with `resolveRestaurantTimeZone(supabase,
  projectRef)` after the access check (line 505).
- The prompt says: `Current date: <local YMD> (restaurant local date,
  timezone <tz>) ...`. Line 541 uses the same value.

## Decided trade-offs

- Instant queries such as `.gte('punch_time', startDate.toISOString())`
  (`ai-execute-tool/index.ts:266`) and the shift query at line 2283 keep
  their present semantics: UTC midnight of the calendar day. Before this
  change the day was the UTC day. Now it is the restaurant day. A full fix
  converts each boundary with `zonedNaiveToUtc`. That changes labor math, so
  it is out of scope for this PR.
- One extra `restaurants` select per tool call. It is a primary-key read.

## Tests

- `tests/unit/restaurantDate.test.ts`: `2026-09-25T02:00:00Z` is
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
