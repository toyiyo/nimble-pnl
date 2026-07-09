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

The one path that already does it right is `fetchLaborData` in
`supabase/functions/ai-execute-tool/index.ts` (`endLookaheadHours: 18`) →
`calculateHoursPerEmployee` filters periods by `startTime` in
`[startDate, endDate]`. This design generalizes that proven pattern.

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

### 2. Payroll — `usePayroll.tsx` + `calculateEmployeePay`

- `usePayroll` fetches `bufferPunchFetchRange(startDate, endDate)` instead of
  the raw window.
- `calculateEmployeePay`: after `parseWorkPeriods(punches)`, when
  `periodStartDate`/`periodEndDate` are present (they already are — passed by
  `calculatePayrollPeriod`), filter `parsed.periods` via `periodsInWindow` and
  `parsed.incompleteShifts` via `incompleteShiftsInWindow` before the OT/hours
  computation. The daily-rate branch already guards `punchDate` within the
  period, so buffered punches are safe there.

Result: a Sun 20:00→Mon 02:00 shift is counted once in the Sunday week; the
Monday-week run fetches the Sunday clock-in via look-back, pairs it, and drops
it (clock-in < Monday start) — no double count, no false warning.

### 3. Open Sessions — `TimePunchesManager.tsx`

- Fetch the buffered range via `useTimePunches`.
- Derive `windowPunches = punches.filter(inWindow)` for the raw punch table /
  photo / display logic; pair sessions on the full buffered `punches`.
- `incompleteSessions` (and `todaySessions` open detection) = sessions with
  `clock_in` in the viewed `[dateRange.start, dateRange.end]` **and**
  `!is_complete`, via `sessionsWithClockInInWindow`.

Result: a Jul-4 shift whose clock-out lands 12:06 AM Jul 5 is now paired →
`is_complete` → not surfaced as an open session; "Force Out" is only offered
for genuinely open shifts.

### 4. Employee Timecard — `EmployeeTimecard.tsx`

- Replace the per-day `calculateDayHours` + `punchesByDay` **hours** path with
  `parseWorkPeriods` over buffered punches, attributed to clock-in day.
- Extract a pure `hoursByClockInDay(periods, days)` (or reuse period grouping)
  returning `{ totalHours, breakHours, netHours }` per calendar day — unit
  tested for overnight attribution.
- Keep the visual per-day punch *list* (`punchesByDay`) unchanged; only the
  hours numbers now come from paired periods. `useTimePunches` is called with a
  buffered `startDate`/`endDate`.

### 5. Dashboard — `useLaborCostsFromTimeTracking.tsx`

- Fetch `bufferPunchFetchRange(dateFrom, dateTo)`.
  `calculateActualLaborCost` already keys costs by clock-in day and ignores
  out-of-window periods (date-map membership), so no further change needed.

### Not touched

- `get_employee_punch_status` RPC — already unbounded (last punch), correct.
- The pairing engines (`parseWorkPeriods`, `identifyWorkSessions`) — correct in
  isolation; no change to pairing logic.

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

Pure-function unit tests carry the correctness weight (hook changes are
mechanical range widening):

1. `punchWindow.test.ts` — `bufferPunchFetchRange` offsets; each filter keeps
   in-window / drops out-of-window (boundary-inclusive); `OVERNIGHT_BUFFER_HOURS
   >= MAX_SHIFT_GAP_HOURS` drift guard.
2. `payrollCalculations.test.ts` — new cases:
   - Sun 20:00→Mon 02:00 shift counted once in the Sunday-week run.
   - Monday-week run with look-back Sunday clock-in → shift dropped, **no**
     double count, **no** "no matching clock-in" incomplete shift.
   - Genuine missing clock-out still flagged when clock-in is in-window.
3. `timePunchProcessing.test.ts` / timecard hours — a clock-out just after the
   window end reads `is_complete` (not open) once buffered; `hoursByClockInDay`
   attributes a Thu 23:00→Fri 07:00 shift entirely to Thursday.

Existing 58 tests in the target area must stay green.

## Decided trade-offs

- **Symmetric buffer** (vs look-ahead-only like `fetchLaborData`): chosen for
  uniform reasoning and to suppress the payroll start-boundary warning; the
  attribution filters make the extra look-back harmless.
- **No historical data cleanup** in this PR: the fix prevents *future* false
  warnings and dropped pay. Cleaning the already-created duplicate/force-out
  punches is a separate, data-only follow-up.
- **Attribute to clock-in day** (vs splitting hours across two calendar days):
  matches existing conventions and keeps a shift's OT in a single week bucket.
