# Default all user-visible dates to the restaurant's timezone

**Date:** 2026-07-28
**Branch:** `fix/restaurant-tz-display`
**Status:** Design

## Problem

A user viewing the application from a timezone other than the restaurant's sees
times rendered in *their* browser's zone. A manager in Madrid looking at a
Chicago restaurant sees a 6 PM shift as the following day. This has been
reported as confusion; it is also, in at least one path, silent data corruption.

The requested change: default every user-visible date and time to the
restaurant's timezone, especially for scheduling and cost attribution.

## What is already correct — do not change

The data model is sound. Verified against production
(`ncdujvdgqtaunuyigflp`, `information_schema.columns`, 2026-07-28):

| Kind | Columns | Action |
|---|---|---|
| Calendar day (`date`) | `daily_pnl.date`, `daily_labor_costs.date`, `daily_food_costs.date`, `unified_sales.sale_date`, `time_off_requests.start_date`/`end_date`, `inventory_transactions.transaction_date` | **None.** Already restaurant-local business days. Timezone-converting these would *introduce* a bug. |
| Instant (`timestamptz`) | `shifts.start_time`/`end_time`, `time_punches.punch_time`, `unified_sales.sold_at`, `shifts.published_at`, `time_off_requests.reviewed_at` | **This is the entire bug surface.** |
| Wall clock (`time`) | `shift_templates.start_time`/`end_time`, `employee_availability.start_time`/`end_time` | Two *different* conventions — see below. |

`restaurants.timezone` is reliable: 35 rows in production, **zero** null or
empty, 5 distinct IANA zones (`America/Chicago` ×31, plus `America/New_York`,
`America/Bahia_Banderas`, `America/Denver`, `America/Los_Angeles`).

Server-side logic is largely already timezone-aware: 46 files under
`supabase/migrations/` use `AT TIME ZONE`.

### The two `time` columns disagree with each other

This is the sharpest edge in the codebase and must not be "unified" by this work:

- `shift_templates.start_time`/`end_time` are **restaurant-local wall clock**
  (`src/lib/shiftInterval.ts:166`).
- `employee_availability.start_time`/`end_time` are **UTC clock times**, paired
  with a restaurant-**local** `day_of_week` — a lossy dual-convention encoding
  read via `utcTimeToLocalTime` (`src/lib/availabilityTimeUtils.ts:18`).

`memory/lessons.md:1185` documents a prior incident where picking the wrong
reference implementation for this pair produced false availability conflicts for
evening Pacific shifts. **Availability is out of scope for this PR.**

## Root cause

The defect is confined to the **client presentation and client-side
day-bucketing layer**. `format()`, `toLocaleDateString()` and `new Date()` all
read the *browser's* zone.

Correctness is currently **opt-in per call site**, and three different fallbacks
coexist:

| Site | Fallback |
|---|---|
| `src/pages/Scheduling.tsx:221` | `'UTC'` |
| `src/hooks/useDateFormat.tsx:9` | `'America/Chicago'` |
| `src/components/POSSalesImportReview.tsx:156` | `Intl.DateTimeFormat().resolvedOptions().timeZone` |

The third is the reported bug installed as a default.

The consequence of opt-in correctness is recurrence: 289 commits across the
repository mention timezone/tz/utc, including dedicated branches
`fix/publish-week-tz-offbyone` and `fix/publish-schedule-tz-bucketing`. The
project already holds the correct *rule* — `memory/lessons.md:1301`: "Before
serializing a `Date`, decide which of the two things it is — a *day on a
calendar* or a *moment in time*." Nothing mechanically enforces it.

Compounding: CI runs in UTC, the one zone where these bugs are invisible
(`memory/lessons.md:1303`).

## Defects this PR fixes

### 1. Punch edit round-trip silently rewrites the instant (data corruption)

`src/pages/TimePunchesManager.tsx:477` reads a punch into a `datetime-local`
field using the browser's zone:

```ts
punch_time: format(new Date(punch.punch_time), "yyyy-MM-dd'T'HH:mm"),
```

`src/pages/TimePunchesManager.tsx:492` writes it back, re-interpreting those
digits in the browser's zone:

```ts
punch_time: new Date(editFormData.punch_time).toISOString(),
```

A manager editing a punch from a zone other than the restaurant's shifts the
punch by the offset difference — **even when they change nothing but the notes
field.** This corrupts payroll hours permanently and is the highest-severity
item in this PR.

### 2. Labor-cost day bucketing uses the viewer's zone

`src/services/laborCalculations.ts:945` buckets worked hours by day:

```ts
const dateKey = formatDateUTC(period.clockIn ?? period.startTime);
```

`formatDateUTC` is **misnamed**. Its body reads *local* fields, not UTC
(`src/services/laborCalculations.ts:43-48`), and its own doc comment says as
much (`src/services/laborCalculations.ts:40`). Hours therefore attribute to
whatever day it is in the *viewer's* browser.

### 3. Payroll bucketing, same defect, explicitly coupled

`src/utils/payrollCalculations.ts:492`:

```ts
const dateKey = format(new Date(period.clockIn), 'yyyy-MM-dd');
```

`src/services/laborCalculations.ts:41-42` states this bucketing "must match
Payroll's day-bucketing (payrollCalculations.ts) so period totals and monthly
aggregation stay consistent." **The two must change together** or the Labor and
Payroll screens will disagree.

Additionally `src/utils/payrollCalculations.ts:559` does `new Date(dateKey)` on
a `YYYY-MM-DD` string, which the ECMAScript spec parses as **UTC midnight** —
the precise bug `parseDateOnly` exists to prevent (`src/lib/dateOnly.ts:13`).

### 4. Timecard day bucketing

`src/pages/EmployeeTimecard.tsx:106` groups punches into days with
`format(punchDate, 'yyyy-MM-dd')` — browser zone.

### Explicitly NOT a defect

`src/hooks/useLaborCostsFromTimeTracking.tsx:112-113` calls
`format(dateFrom, 'yyyy-MM-dd')` against a `date` column. `dateFrom` is a
local-midnight `Date` *token* (a calendar day), and reading its local fields is
the **correct** serialization per the two-serialization rule
(`memory/lessons.md:1301`). This file is not changed.

## Design

### `src/lib/restaurantClock.ts` (new, pure — no React)

```ts
safeTz(tz: string | null | undefined): string
formatInstant(iso: string | Date, tz: string, pattern: string): string
toBusinessDay(iso: string | Date, tz: string): string      // → YYYY-MM-DD
parseWallClock(wallClock: string, tz: string): string      // → ISO instant
```

`safeTz` is ported from `supabase/functions/_shared/timezone.ts:25`, whose
`DEFAULT_TIMEZONE` is `'America/Chicago'`
(`supabase/functions/_shared/timezone.ts:15`) — matching the database default.
This becomes the single fallback, replacing all three above.
`memory/lessons.md:807` records that an invalid IANA string makes `Intl` throw
`RangeError`, which is why validation is mandatory rather than cosmetic.

**Load-bearing guard.** `formatInstant` **throws** when handed a date-only
string, and `formatDateOnly` (`src/lib/dateOnly.ts:49`) **throws** when handed
an ISO instant. This converts the "calendar day vs. moment in time" rule from a
convention people forget into a runtime error. It is the single highest-value
element of this design: it is what makes the next 35-file migration
self-checking rather than another round of manual vigilance.

### `src/hooks/useRestaurantClock.ts` (new)

Binds the pure functions to the selected restaurant and returns
`{ tz, tzAbbrev, viewerTzDiffers, today, formatInstant, toBusinessDay, parseWallClock }`.

- `today` composes the existing `useTodayInTimezone`
  (`src/hooks/useTodayInTimezone.ts:17`), which already re-checks across
  midnight and on tab focus. Reuse, not reimplementation.
- `tz` is declared **immediately after** `useRestaurantContext()`. Threading it
  into an earlier `useMemo` while declaring it lower causes a TDZ
  `ReferenceError` at render that `tsc` does not catch
  (`memory/lessons.md:1300`).
- `viewerTzDiffers` compares the **current UTC offset**, not the IANA string:
  `America/Chicago` and `US/Central` name the same zone and must not trigger a
  cue.

### `src/components/RestaurantTzNotice.tsx` (new)

Returns `null` when offsets match. Otherwise renders a muted
`text-[13px] text-muted-foreground` line ("times shown in restaurant time
(CDT)"), per the CLAUDE.md typography scale and semantic-token rules. Mounted on
the scheduling and timecard headers in this PR.

Rationale: correctness alone does not resolve the reported *confusion* — a
viewer in another zone still has no cue whose 6 PM they are reading.

### Enforcement — `eslint.config.js`, configuration only

`no-restricted-syntax` AST selectors banning `format(`, `parseISO(`,
`toLocaleDateString`, `toLocaleTimeString`, `toLocaleString`, and
`.toISOString().split('T')[0]` in files that reference instant columns, scoped
via `overrides` globs. The ~37 not-yet-migrated files are allowlisted by a
second override that disables the rule for them.

No custom ESLint plugin. The allowlist doubles as the migration tracker; its
length is an honest progress metric.

## Testing

- Unit tests per clock function, executed under multiple zones.
- **Corruption regression:** load a punch in zone X, save without editing any
  field, assert the persisted instant is byte-identical. This fails today.
- Guard tests asserting `formatInstant` rejects `'2026-07-28'` and
  `formatDateOnly` rejects `'2026-07-28T18:00:00Z'`.
- `test:tz` (`package.json:32`) currently runs 4 test files across 5 zones.
  Expand it to the **full unit suite** under `Pacific/Auckland` (ahead of UTC),
  `America/Chicago` (behind), and `UTC` (what CI runs).

**Fixture hazard.** `memory/lessons.md:1297` records that making a shared
bucketing helper timezone-aware broke CI in three places at once, because
fixtures seeded with naive datetime strings resolve differently on a UTC runner.
Before touching the bucketers, grep test seeds for naive datetime strings and
`getTimezoneOffset`, re-anchor them to explicit UTC instants matching production
`timestamptz` data, and run the whole suite under `TZ=UTC` locally.

## Scope boundary

**In:** the clock module, the hook, the notice component, the lint guardrail,
the CI zone matrix, and the four defect sites above.

**Out, deliberately:**
- ~35 display-only call sites — allowlisted, migrated in follow-up PRs.
- Availability (`employee_availability`) — the dual-convention hazard above.
- Per-restaurant business-day cutoff — tracked as a separate task. Note for that
  work: `period.clockIn` is already the bucketing anchor at both
  `src/services/laborCalculations.ts:945` and
  `src/utils/payrollCalculations.ts:492`, so an overnight shift's hours already
  attribute wholly to the clock-in day. The remaining gap is punches not linked
  to a shift.

## Risks

| Risk | Mitigation |
|---|---|
| Labor and Payroll bucketing drift apart | Change both in one commit; assert equality in a shared test. |
| Timezone-fragile fixtures break CI | Re-anchor seeds first; verify under `TZ=UTC` before pushing. |
| The throw-on-wrong-type guard breaks a caller passing a date-only string to `formatInstant` | Intended — that caller is a latent bug. Full unit suite under 3 zones surfaces them before merge. |
| Half-migrated period: some screens restaurant-tz, others browser-tz | Accepted. The corrupting and cost-attribution paths are fixed first; display-only drift is cosmetic and already the status quo. |
