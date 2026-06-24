# Design: Fix DST timezone anchor in availability conflict warning

**Date:** 2026-06-23
**Branch:** `fix/conflict-warning-tz-anchor`
**Type:** Bug fix (timezone / display)

## Problem

When a manager schedules a shift outside an employee's availability window, the
conflict warning displays the availability window **1 hour earlier than it was
set** during daylight saving time. An employee who set "available 10:00 PM –
10:30 PM" sees the warning report "available 9:00 PM – 9:30 PM".

### Root cause (confirmed)

`formatUTCTimeToLocal` in `src/lib/conflictFormatUtils.ts` converts a stored UTC
`TIME` value back to local for display using a **hardcoded January-1 anchor**:

```ts
const refDate = new Date(Date.UTC(2026, 0, 1, hours, minutes, 0)); // Jan 1 = standard time
```

Every other reader/writer of the `employee_availability` `TIME` columns anchors
the DST offset to **today** via `date-fns-tz`:

- Writer: `localTimeToUtcTime` (`src/lib/availabilityTimeUtils.ts`)
- Grid reader: `utcTimeToLocalTime` (same file)

January 1 falls in standard time (CST, UTC−6 for `America/Chicago`); today
(June) is daylight time (CDT, UTC−5). The two anchors differ by exactly one
hour, so a value written as `03:00:00`/`03:30:00` UTC (= 10:00/10:30 PM CDT)
is displayed by the conflict warning as 9:00/9:30 PM.

### Evidence

- **Prod data:** employee `dff3beb5…`, restaurant "Wetzel's - Cold Stone - Alamo
  Ranch" (`America/Chicago`), rows stored `03:00:00`/`03:30:00` — i.e. 10:00/10:30 PM
  CDT, correctly written.
- **Node repro:** the exact buggy line returns `9:00 PM` / `9:30 PM`; anchored to
  today it returns `10:00 PM` / `10:30 PM`.
- **Prior art:** lesson [2026-05-10] documents fixing this identical "winter
  offset always applied" bug class in `availabilityTimeUtils.ts`. That fix added
  a `referenceDate` (default today) and switched to local-field accessors.
  `conflictFormatUtils.ts` was written separately and never received the fix.

## Goals

- The conflict warning shows the same local times the employee entered and the
  availability grid displays (they must agree).
- No regression for other timezones or seasons.
- Eliminate the duplicate, divergent UTC→local conversion so it cannot silently
  drift again.

## Non-goals (out of scope)

1. **`ShiftDialog` browser-TZ shift parse** — `new Date(\`${date}T${time}\`)`
   parses in the browser's TZ, not the restaurant's. Only misbehaves when
   browser TZ ≠ restaurant TZ. Deferred per request.
2. **`extractDayLabel` off-by-one** (`conflictFormatUtils.ts:22`) — parses the
   shift date as UTC-midnight then formats in the restaurant TZ, shifting the
   **day label** back a day for western TZs. Real but separate from the reported
   time-window bug; flag for a follow-up task, do not widen this PR.
3. **Schema change to `TIMESTAMPTZ`/explicit anchor** — the proper long-term fix
   for the lossy `TIME` column. Large, separate effort.

## Approach (chosen: consolidate on the tested helper)

Rewrite `formatUTCTimeToLocal` to delegate the UTC→local conversion to the
existing, DST-correct, unit-tested `utcTimeToLocalTime`, then format the
resulting `HH:MM` to 12-hour using the existing `formatHourToTime`
(`src/lib/timeUtils.ts`). Thread an optional `referenceDate` (default
`new Date()`) through `formatUTCTimeToLocal` and `formatConflictLine` so tests
are deterministic across seasons.

```ts
export function formatUTCTimeToLocal(
  utcTime: string,
  timezone: string,
  referenceDate: Date = new Date(),
): string {
  const local = utcTimeToLocalTime(utcTime, timezone, referenceDate); // "HH:MM", DST-correct
  const [h, m] = local.split(':').map(Number);
  return formatHourToTime(h + m / 60); // "10:30 PM"
}
```

### Why this approach

- **Removes the root cause:** one source of truth for the conversion. The bug
  was drift between two implementations; collapsing to one makes re-drift
  impossible.
- **Reuses tested code:** `utcTimeToLocalTime` already has 24 passing tests and
  the DST-fix history; `formatHourToTime` already produces the `"10:30 PM"`
  format.
- **Agrees with the grid:** both now anchor to today, so the warning and the
  availability grid always show the same local time.

### Anchor decision: today (not shift-date, not Jan 1)

The `TIME` column is lossy — it was written with today's offset. A faithful
round-trip requires the reader to use the **same** anchor as the writer.
Anchoring to the shift date would reintroduce the 1-hour error whenever the
shift and "today" straddle a DST boundary, and would make the warning disagree
with the grid. (Documented contract in `availabilityTimeUtils.ts`; lesson
[2026-05-10].)

### Output note

The new formatter emits a normal ASCII space before AM/PM (e.g. `"10:30 PM"`),
whereas `toLocaleTimeString` in recent ICU emits a narrow no-break space
(U+202F). Visually identical; the ASCII form is more stable across Node/ICU
versions, removing a class of snapshot flakiness. `formatUTCTimeToLocal` is only
consumed within `conflictFormatUtils.ts`, so no external caller depends on the
old separator.

## Components & data flow

```
SQL check_availability_conflict (unchanged)
  → ConflictCheck { available_start, available_end: UTC "HH:MM:SS" }
    → formatConflictLine(conflict, timezone, referenceDate=today)
       → formatUTCTimeToLocal(utc, tz, referenceDate)
          → utcTimeToLocalTime (date-fns-tz, today anchor)  ← single source of truth
          → formatHourToTime                                ← 12h presentation
    → "…outside availability (available 10:00 PM – 10:30 PM)"
```

No DB, RPC, RLS, migration, component, or styling change. `ShiftDialog` and
`AvailabilityConflictDialog` continue to call `formatConflictLine(conflict,
timezone)` with two args (referenceDate defaults to today).

## Testing

New `tests/unit/conflictFormatUtils.test.ts` (the file currently has **no**
tests):

- **Regression (reported bug):** `formatUTCTimeToLocal('03:00:00',
  'America/Chicago', new Date(2026, 5, 23))` → `'10:00 PM'`; `'03:30:00'` →
  `'10:30 PM'`. Fails on the old code (9:00/9:30 PM).
- **Anchor matters:** same input, `new Date(2026, 0, 1)` → `'9:00 PM'` (correct
  for CST) — documents the contract.
- **Real DST transitions:** `America/Chicago` around Mar 8, `America/New_York`
  around Nov 1.
- **Edge formats:** `12:00 AM`, `12:00 PM`, single-digit hour (`9:00 AM`),
  `HH:MM` input without seconds.
- **`formatConflictLine`:** time-off passthrough; composed
  "available 10:00 PM – 10:30 PM" with pinned `referenceDate`.
- **TZ-portability:** all reference dates use `new Date(y, m, d)` (local
  midnight, portable). Phase 8 runs the suite under `TZ=UTC`,
  `TZ=America/Los_Angeles`, `TZ=Asia/Tokyo`.

## Phase 2.5 design-review decision

**Both design reviewers skipped — documented, not silent.**

- **Supabase reviewer — skip:** zero DB surface. No migration, RPC, RLS, edge
  function, or table change; the `check_availability_conflict` RPC is read
  unchanged.
- **Frontend reviewer — skip:** zero UI surface. No component, JSX, styling,
  typography, a11y, or three-state-rendering change — only the output string of
  a pure `src/lib` utility (same format). The component callers are read-only
  verified.

Review rigor is applied in Phase 7 (five parallel code reviewers + CodeRabbit)
against the actual diff, which is the right place to scrutinize a logic/timezone
fix.
