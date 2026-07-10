# Design: Overnight-Shift Punch Windowing Fix

**Date:** 2026-07-09
**Branch:** `fix/overnight-shift-punch-windowing`
**Type:** Bug fix (payroll correctness + data-integrity)

## Problem

Employees who clock in one day and clock out after midnight the next day
("overnight" shifts — e.g. clock in Thu 5 PM, clock out Fri 12:06 AM after
cleaning) trigger two wrong behaviours:

1. **False warnings.** The clock view shows "Open Sessions … Force Out" and
   the Payroll page shows "Incomplete Time Punches Detected … Clock-out at
   Jul 4, 12:06 AM has no matching clock-in." Managers, trusting the warning,
   manually add clock-in/clock-out punches — corrupting otherwise-clean data
   (observed live: duplicate clock-ins and stray 11:59 PM "force-out" punches).
2. **Dropped pay (latent).** Any shift whose clock-in and clock-out fall on
   opposite sides of a fetch-window boundary loses its hours from *both*
   periods. Confirmed live on the platform: two Sunday-night→Monday-morning
   shifts (~22.7 h) at another restaurant sit exactly on the Mon–Sun payroll
   week boundary and would be dropped from a standard weekly run.

### Root cause

The pairing engines (`parseWorkPeriods` in
`src/utils/payrollCalculations.ts`, `identifyWorkSessions` in
`src/utils/timePunchProcessing.ts`) are overnight-aware — they pair
clock-in→clock-out sequentially with an 18 h max-gap and do **not** group by
calendar day. They are correct *in isolation*.

The bug is in the **fetch layer**: every query loads punches with a hard
`punch_time >= start AND punch_time <= end` and **no buffer**. A shift is a
*pair*; when the window boundary falls between the two punches, the pair is
split before the pairing engine ever sees it:

- View day N → clock-in present, clock-out (day N+1) missing → "open session".
- View day N+1 → clock-out present, clock-in (day N) missing → "no matching
  clock-in" and the hours are not counted.

### Affected fetch sites

| Site | File | Symptom |
|---|---|---|
| Payroll | `src/hooks/usePayroll.tsx` | Dropped pay at period boundary + false banner |
| Open Sessions | `src/pages/TimePunchesManager.tsx` | False "open session" → Force-Out corruption |
| Employee Timecard | `src/pages/EmployeeTimecard.tsx` | **Per-day bucketing**; silently halves overnight hours, no warning |
| Dashboard labor cost | `src/hooks/useLaborCostsFromTimeTracking.tsx` | Overnight hours dropped at range edges |
| AI tool: P&L labor | `supabase/functions/ai-execute-tool/index.ts` (~L231) | Split-shift hours in AI "profit & loss" labor line |
| AI tool: payroll summary | `supabase/functions/ai-execute-tool/index.ts` (~L2242) | Split-shift hours in AI "payroll summary" |

The one path that already does it right is `fetchLaborData` in the **same**
edge file (`endLookaheadHours: 18`) → `calculateHoursPerEmployee`/
`calculateActualLaborCost` filter periods by clock-in day within
`[startDate, endDate]`. This design generalizes that proven pattern; the two
sibling handlers above (`executeGetProfitLoss`-family L231 and
`executeGetPayrollSummary` L2242) were added without going through
`fetchLaborData` and so still fetch unbuffered.

## Approach

**Fetch a buffered window, pair across the full set, then attribute each
shift to its clock-in day and drop shifts whose clock-in falls outside the
target window.** This yields exactly-once counting and eliminates false
orphans.

- **Buffer:** symmetric ±18 h around `[start, end]`.
  - *Look-ahead* (`end + 18h`): so the owning period sees the clock-out of a
    shift that started in-window and crossed the end boundary.
  - *Look-back* (`start − 18h`): so a period pairs (rather than orphans) a
    clock-out whose clock-in was in the previous period; the completed shift
    is then dropped as belonging to the prior period — suppressing the false
    "no matching clock-in" warning.
- **Attribution rule:** a shift belongs to the period containing its
  **clock-in** (`startTime`). This matches the existing daily-rate and
  labor-cost conventions (`docs/DAILY_RATE_PAYROLL_LOGIC.md`,
  `calculateHoursPerEmployee`).
- **Constant:** buffer = 18 h, equal to `MAX_SHIFT_GAP_HOURS` (the max gap the
  pairing engine will pair). A shift with a larger gap is already flagged, not
  counted, so 18 h captures every pairable shift.

### Why symmetric buffer everywhere

Some sites strictly need only look-ahead (dashboard, open-sessions) while
payroll also needs look-back to suppress the start-boundary warning. A single
symmetric helper is simpler to reason about and safe everywhere, because each
site applies an attribution filter that drops out-of-window shifts. The pairing
engine's 18 h gap cap prevents mispairing across the wider fetch.

## Components

### New: `src/utils/punchWindow.ts`

Pure, dependency-light helpers (unit-tested):

- `OVERNIGHT_BUFFER_HOURS = 18` — with a test asserting
  `OVERNIGHT_BUFFER_HOURS >= MAX_SHIFT_GAP_HOURS` to prevent drift.
- `bufferPunchFetchRange(start: Date, end: Date, hours?): { fetchStart: Date; fetchEnd: Date }`
- `periodsInWindow(periods, start, end)` — keep periods whose `startTime` ∈ window.
- `incompleteShiftsInWindow(shifts, start, end)` — keep shifts whose `punchTime` ∈ window.
- `sessionsWithClockInInWindow(sessions, start, end)` — keep sessions whose `clock_in` ∈ window.

Window bounds are inclusive on both ends (`>= start && <= end`), matching the
existing `.gte/.lte` query semantics.

### Data-lineage rule (applies to every site)

Two derived data sets, never conflated:

- **Buffered set** — punches fetched across `[start−18h, end+18h]`. Feeds
  **pairing only** (`parseWorkPeriods` / `processPunchesForPeriod`). Pairing
  needs both punches of a boundary-crossing shift.
- **Window set** — data filtered back to the caller's logical `[start, end]`.
  Feeds **every display and every total**: raw punch tables, CSV export,
  manual-editor overlap checks, photo-thumbnail loads, per-employee hour
  summaries, and the "hours" headline metrics.

The pairing output (periods / sessions) is then attributed to the window by
**clock-in day** and everything with a clock-in outside `[start, end]` is
dropped. A period/session is "in window" iff its clock-in ∈ `[start, end]`
(inclusive both ends, matching `.gte/.lte`).

### 2. Payroll — `usePayroll.tsx` + `calculateEmployeePay`

- `usePayroll` widens the inline `.gte/.lte` to `bufferPunchFetchRange(startDate,
  endDate)`. The React Query **key stays keyed on the logical `startDate`/
  `endDate`** (buffering is encapsulated in `queryFn`) — no cache-key change.
- `calculateEmployeePay`, hourly branch: immediately after
  `parseWorkPeriods(punches)` (payrollCalculations.ts:430), and **before** the
  `hoursByDate` loop at :433, reassign `parsed.periods = periodsInWindow(...)`
  and `parsed.incompleteShifts = incompleteShiftsInWindow(...)`. This is gated
  behind an **explicit opt-in flag** `attributeToWindow` (default `false`), NOT
  merely the presence of `periodStartDate`/`periodEndDate`. Only
  `calculatePayrollPeriod` (the payroll path, which fetches buffered punches)
  passes `true`. All downstream OT-bucketing and tip-proration then operate on
  in-window periods unchanged. This is a real logic change inside the 55-line
  hourly block, **not** mere range-widening — it gets dedicated OT/tip-proration
  test coverage (see Testing).

  **Why opt-in (third caller):** `calculateEmployeePay` has a third production
  caller beyond payroll — `calculateActualLaborCostForMonth`
  (`src/services/laborCalculations.ts:913`) buckets punches by unbuffered ISO
  week and passes **noon-anchored** week bounds (`weekKey + 'T12:00:00'`) as a
  deliberate DST workaround (lessons.md PR #485). Keying the filter on the mere
  presence of period bounds would wrongly drop that caller's 09:00 clock-ins
  (09:00 < the noon anchor), shorting a full day of wages. The opt-in flag keeps
  that caller's behaviour byte-for-byte unchanged. Its own latent overnight bug
  (a Sun→Mon shift is split across ISO-week buckets) is real but DST-sensitive
  and out of scope — see Decided trade-offs.
- Daily-rate branch already guards `punchDate` within
  `[periodStartDate, periodEndDate]` (payrollCalculations.ts:496–508); buffered
  punches are safe there with no change.

Result: a Sun 20:00→Mon 02:00 shift is counted once in the Sunday week; the
Monday-week run fetches the Sunday clock-in via look-back, pairs it, and drops
it (clock-in < Monday start) — no double count, no false warning.

### 3. Open Sessions — `TimePunchesManager.tsx`

Current lineage: `filteredPunches = punches.filter(searchMatch)` (:308) →
feeds `processPunchesForPeriod` (:317), the Punch List table (:800), CSV export
(:517), `ManualTimelineEditor existingPunches` (:705), and the photo effect
(:333). `processedData.sessions`/`.processedPunches` feed the visualization
views and `todaySessions`/`totalWeekHours`/`incompleteSessions`.

Changes:
- Fetch the buffered range via `useTimePunches(restaurantId, empId,
  bufferedStart, bufferedEnd)`. `punches` is now the buffered set.
- `filteredPunches = punches.filter(searchMatch)` stays the **buffered**
  search-filtered set and feeds `processPunchesForPeriod` (pairing needs
  buffer).
- Add `windowPunches = filteredPunches.filter(p => inWindow(p.punch_time,
  rangeStart, rangeEnd))`. **Repoint all display consumers to `windowPunches`**:
  the Punch List table, `handleExportCSV`, `ManualTimelineEditor existingPunches`,
  and the photo-thumbnail effect (:333). This keeps buffer-period punches out of
  tables, exported files, overlap checks, and Storage signed-URL calls.
- Add `windowProcessedPunches = processedData.processedPunches.filter(p =>
  inWindow(p.punch_time, …))` for `PunchStreamView` (:747).
- Add `windowSessions = sessionsWithClockInInWindow(processedData.sessions,
  rangeStart, rangeEnd)`. Use it for **all** viewModes as the source for
  `EmployeeCardView`/`BarcodeStripeView`/`ReceiptStyleView`, `todaySessions`,
  `totalWeekHours` (:564), and `incompleteSessions` (:322). `incompleteSessions
  = windowSessions.filter(s => !s.is_complete)`. The day-view `todaySessions`
  filter switches from `isSameDay(...)` to the same `sessionsWithClockInInWindow`
  helper for consistent inclusive-boundary semantics.

Result: a Jul-4 shift whose clock-out lands 12:06 AM Jul 5 is paired →
`is_complete` → not surfaced as an open session, and its hours count in the
Jul-4 window total; "Force Out" is only offered for genuinely open shifts.
Week/month `totalWeekHours` no longer leaks neighbouring-period hours.

### 4. Employee Timecard — `EmployeeTimecard.tsx`

Explicit dual-source split:
- Call `useTimePunches(restaurantId, empId, bufferedStart, bufferedEnd)` where
  `{bufferedStart, bufferedEnd} = bufferPunchFetchRange(startDate, endDate)`.
  This **adds an `endDate` bound** (today only `startDate` is passed, so the
  fetch is unbounded-after-start) — a deliberate change that also *reduces*
  over-fetch for far-past periods.
- **Display list (window):** keep `periodPunches` (:124, `punchDate` in
  `[startDate, endDate]`) → `punchesByDay` → the visual per-punch timeline,
  unchanged.
- **Hours (buffered → attributed):** add pure
  `hoursByClockInDay(periods, weekDays)` where `periods = parseWorkPeriods(punches)`
  runs on the **buffered** hook `punches` (NOT `periodPunches` — feeding it the
  filtered set would reintroduce the split bug). It buckets each period by its
  clock-in **local** calendar day (`format(startTime, 'yyyy-MM-dd')`, matching
  the existing local-day list grouping) into the `weekDays` set, returning
  `{ totalHours, breakHours, netHours }` per day; days outside the period are
  ignored. Per-day rows and `weeklyTotals` read from this.
- Delete the now-dead `calculateDayHours`.

### 5. Dashboard — `useLaborCostsFromTimeTracking.tsx`

- Widen the inline fetch to `bufferPunchFetchRange(dateFrom, dateTo)`; query key
  stays on the logical `dateFrom`/`dateTo`. `calculateActualLaborCost` already
  keys costs by clock-in day and ignores out-of-window periods (date-map
  membership), so no further change.

### 6. AI edge tools — `ai-execute-tool/index.ts` (Deno)

- Two handlers fetch `time_punches` unbuffered and feed `calculateActualLaborCost`:
  L231 (P&L labor) and L2242 (`executeGetPayrollSummary`).
- Add `LABOR_FETCH_LOOKAHEAD_HOURS = 18` to
  `supabase/functions/_shared/laborCalculations.ts` and widen each fetch's
  upper bound to `endDate + LABOR_FETCH_LOOKAHEAD_HOURS` (look-ahead only, in
  parity with the sibling `fetchLaborData`; `calculateActualLaborCost` already
  drops out-of-window periods by clock-in-day date-map, so a shift starting
  before the window is not double-counted and no user-facing "orphan" warning
  is produced by these read-only aggregation tools). This is a Deno module, so
  the constant is defined Deno-side, mirroring the TS `OVERNIGHT_BUFFER_HOURS`;
  a drift-guard note lives beside both constants.

### Not touched

- `get_employee_punch_status` RPC — already unbounded (last punch), correct.
- The pairing engines (`parseWorkPeriods`, `identifyWorkSessions`) — correct in
  isolation; no change to pairing logic.
- `select('*')` on `time_punches` in `usePayroll`/`useLaborCostsFromTimeTracking`
  and Punch-List virtualization — pre-existing, left as documented follow-ups
  (see Decided trade-offs) to keep this fix focused.

## Data flow (payroll example)

```
usePayroll(start, end)
  → bufferPunchFetchRange → fetch time_punches in [start−18h, end+18h]
  → group by employee
  → calculateEmployeePay(employee, bufferedPunches, …, start, end)
       → parseWorkPeriods(bufferedPunches)          // pairs across boundaries
       → periodsInWindow(periods, start, end)       // attribute to clock-in day
       → incompleteShiftsInWindow(shifts, start, end)
       → OT / hours / pay on in-window periods only
```

## Error / edge handling

- **Genuine missing clock-out** (no clock-out anywhere within 18 h): still
  surfaces as an incomplete shift whose clock-in `punchTime` is in-window →
  correctly flagged.
- **Genuine orphan clock-out** (no clock-in within 18 h look-back): still
  surfaces as "no matching clock-in" → correctly flagged.
- **Duplicate / manual noise punches** (already present in live data): pairing
  and dedup behaviour is unchanged; this fix does not clean historical data
  (a separate data-hygiene pass, out of scope here).
- **DST boundaries:** buffer math is in absolute epoch ms (`Date.getTime()`),
  independent of local wall-clock, so DST transitions do not distort the ±18 h.
- **Performance:** ±18 h widening adds at most ~1.5 days of punches per query —
  negligible; existing `(restaurant_id, punch_time)` index still serves it.

## Testing

Pure-function unit tests carry the correctness weight. The `calculateEmployeePay`
and `hoursByClockInDay` changes are genuine logic changes (not mere range
widening) and get dedicated coverage.

1. `punchWindow.test.ts` — `bufferPunchFetchRange` offsets (±18h, epoch-ms);
   each filter keeps in-window / drops out-of-window with **inclusive**
   boundaries (a period whose clock-in == `start` or == `end` is kept);
   `OVERNIGHT_BUFFER_HOURS >= MAX_SHIFT_GAP_HOURS` drift guard.
2. `payrollCalculations.test.ts` — new cases:
   - Sun 20:00→Mon 02:00 shift counted **once** in the Sunday-week run (full
     hours, attributed to Sunday).
   - Monday-week run with look-back Sunday clock-in → shift dropped, **no**
     double count, **no** "no matching clock-in" incomplete shift emitted.
   - **OT/tip-proration path**: a week whose in-window periods push past 40h,
     with a buffered-but-out-of-window neighbouring shift present in the input,
     yields the same OT split and tip-prorated base rate as if the neighbour
     were never fetched (proves the window filter sits correctly ahead of the
     OT/tip math).
   - Genuine missing clock-out still flagged when the clock-in is in-window.
3. `timePunchProcessing` / open-sessions — a clock-out just after the window end:
   (a) the session reads `is_complete` (not open), **and** (b) once paired, its
   hours count toward the window's `totalWeekHours` (the two consumers —
   `incompleteSessions` and `windowSessions` totals — are asserted separately).
4. `hoursByClockInDay` — a Thu 23:00→Fri 07:00 shift attributes **entirely to
   Thursday** (local day); a **DST-transition** case (clock-in at a local
   midnight on a spring-forward/fall-back day, constructed via
   `new Date(year, month, day, …)` for TZ-portability per lessons.md) asserts
   attribution lands on the correct local calendar day regardless of process TZ.

Existing 58 tests in the target area must stay green. Run in UTC and at least
one offset TZ (e.g. `TZ=America/Chicago`) for the timecard/attribution suite,
per the DST lessons in `memory/lessons.md`.

## Timezone discipline

Fetch bounds use `Date.toISOString()` (UTC) and the ±18h buffer is epoch-ms, so
fetch widening is TZ-invariant. **Attribution/day-bucketing is local**: the
window `Date` boundaries (`startDate`/`endDate`) are constructed from local
calendar days upstream, and `hoursByClockInDay` buckets by the punch's *local*
calendar day — the two are compared consistently. This must be preserved: never
bucket attribution by the UTC date portion of `punch_time`, or overnight shifts
near local midnight in offset zones land on the wrong day (see `memory/lessons.md`
`parseDateOnly`/`getUTC*` entries).

## Decided trade-offs

- **Symmetric buffer** on the UI/payroll sites (vs look-ahead-only like
  `fetchLaborData`): chosen for uniform reasoning and to suppress the payroll
  start-boundary "no matching clock-in" warning; the attribution filters make
  the extra look-back harmless. The AI edge tools (read-only aggregation, no
  user-facing orphan warning) use **look-ahead only**, matching their sibling
  `fetchLaborData`.
- **Fetch-volume increase (accepted):** buffering widens each query by ~1.5 days
  *on top of* the queried span (a 1-day view fetches ~2.5 days), and the shifting
  buffered boundary reduces cross-navigation cache overlap. Correctness outweighs
  this; the `(restaurant_id, punch_time)` index keeps the scan cheap and payload
  stays small at restaurant scale. The React Query key stays on the *logical*
  window so cache identity is unaffected.
- **No historical data cleanup** in this PR: the fix prevents *future* false
  warnings and dropped pay. Cleaning the already-created duplicate/force-out
  punches is a separate, data-only follow-up.
- **Monthly labor-cost overnight bug deferred:** `calculateActualLaborCostForMonth`
  (`src/services/laborCalculations.ts`) buckets punches by unbuffered
  `startOfWeek` before pairing, so a Sun→Mon shift is split across ISO-week
  buckets — the same bug class. Fixing it needs buffered re-bucketing AND a
  decision on the noon-anchor-vs-midnight DST workaround (lessons.md PR #485
  documents a $2,246 TZ swing in this exact code), so it warrants its own design
  pass and DST-portable tests. Discovered during Phase 4; tracked as a follow-up
  rather than improvised into this PR. The opt-in flag ensures this PR does not
  regress that function.
- **Attribute to clock-in day** (vs splitting hours across two calendar days):
  matches existing conventions and keeps a shift's OT in a single week bucket.
- **Deferred follow-ups** (flagged by design review, intentionally out of scope
  to keep the fix focused): narrow `select('*')` → explicit columns in
  `usePayroll`/`useLaborCostsFromTimeTracking`; virtualize the `TimePunchesManager`
  Punch List table (CLAUDE.md 100+-item rule). Neither is newly triggered by
  this change once `windowPunches` wiring keeps row counts at pre-buffer size.
