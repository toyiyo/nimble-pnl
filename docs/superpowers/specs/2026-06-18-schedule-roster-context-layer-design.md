# Design: Schedule Roster Context Layer

**Date:** 2026-06-18
**Branch:** `feature/schedule-roster-context-layer`
**Status:** Approved (design agreed via `/frontend-design`; this doc captures the locked decisions)

## Problem

On the weekly schedule grid (`/scheduling?week=YYYY-MM-DD`), a manager building a
schedule cannot see three facts that directly affect who they should schedule:

1. **Who is a minor** (youth labor rules constrain hours / late shifts).
2. **Who is full-time vs part-time** (hour budgeting).
3. **Who has approved time off during the visualized week**, and on which days.

Today the schedule's employee identity cell shows only avatar + name + position +
an hours pill (+ an "Inactive" badge). Time off is invisible on the grid — it is
only surfaced as a per-shift conflict warning *after* a shift is placed, or in the
separate Time Off tab. The planner sidebar (`EmployeeSidebar.tsx`) and the roster
list (`EmployeeList.tsx`) already show Minor and FT/PT badges, but the schedule
grid — where scheduling decisions are actually made — does not.

## Goal

Add a lightweight "roster context layer" to the schedule grid that answers the
three questions at a glance, reusing existing badge patterns, and renders approved
time off **spatially on the day cells** (the grid columns already are the days of
the week).

## Approved design decisions

From the `/frontend-design` session (user-selected options):

| Decision | Choice |
|---|---|
| Time-off visual on day cells | **Blue band** (calm "info" treatment), distinct from amber (minor) and red (conflict) |
| Full-time / part-time display | **Tag on every row** (both FT and PT shown), neutral styling |
| Interaction depth | **Bands + name-cell summary chip + soft-block** of the add-shift affordance on off-days |

## Semantic color ladder

- **Amber** = legal caution → **Minor** pill (reuses documented `bg-amber-500/10 text-amber-600` pattern).
- **Neutral (`bg-muted`)** = structural fact → **FT/PT** tag.
- **Blue (`info`)** = unavailable → **time off** band + summary chip.
- **Red (`destructive`)** = error → **conflict** (shift scheduled on an off-day) — already provided by `useCheckConflicts`.

No hue does two jobs.

## Reuse — established patterns (do not reinvent)

`src/components/EmployeeList.tsx:291-298` already renders both badges; the schedule
grid mirrors them verbatim for consistency:

```tsx
// FT/PT tag (EmployeeList.tsx:291-293)
<span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted shrink-0">
  {employee.employment_type === 'part_time' ? 'PT' : 'FT'}
</span>

// Minor pill (EmployeeList.tsx:294-298)
{isMinor(employee.date_of_birth) && (
  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 font-medium shrink-0">
    Minor
  </span>
)}
```

`isMinor(date_of_birth)` from `@/lib/employeeUtils` is the authoritative minor
check (computes age < 18, UTC-safe). The hours pill on the schedule meta line is
already `text-[11px] px-1.5 py-0.5 rounded-md bg-muted`, so the FT/PT tag will sit
beside it with identical styling.

## Data — already in scope

`Scheduling.tsx` already fetches everything needed:

- `employee.employment_type` (`'full_time' | 'part_time'`) and `employee.date_of_birth` — `useEmployees` selects `*`.
- `timeOffRequests` — `useTimeOffRequests(restaurantId)` (line ~378), all requests for the restaurant.
- `currentWeekStart` (Mon), `weekEnd` (Sun), `weekDays: Date[]` (lines 370-371).
- Day cells already key off `format(day, 'yyyy-MM-dd')` (line ~1646).

No DB schema, RLS, RPC, edge-function, or migration changes. The columns and table
all exist.

## New: pure, testable time-off helper

`src/lib/scheduleTimeOff.ts` — extracted so it can be unit-tested directly without
mounting `Scheduling.tsx` (which pulls in 30+ hooks; see lessons 2026-05-17).

```ts
import type { TimeOffRequest } from '@/types/scheduling';

export interface TimeOffSpan {
  startKey: string;      // 'yyyy-MM-dd' first off-day of a contiguous run (within the week)
  endKey: string;        // last off-day of the run
  dayCount: number;
  reasons: string[];     // distinct, non-empty reasons covering the run
}

export interface EmployeeWeekTimeOff {
  offDayKeys: Set<string>;                 // all in-week 'yyyy-MM-dd' that are off
  spans: TimeOffSpan[];                    // contiguous runs, in weekDayKeys order
}

/**
 * Build per-employee approved-time-off context for the visualized week.
 * @param requests    all time-off requests for the restaurant (any status)
 * @param weekDayKeys ordered 'yyyy-MM-dd' for the 7 visualized days
 *                    (produced by the SAME format(day,'yyyy-MM-dd') the grid uses)
 * @returns Map<employee_id, EmployeeWeekTimeOff> (employees with ≥1 off-day only)
 */
export function buildWeekTimeOff(
  requests: TimeOffRequest[],
  weekDayKeys: string[],
): Map<string, EmployeeWeekTimeOff>;

/** Convenience: distinct reasons for an employee's whole-week off set, for the chip tooltip. */
export function summarizeOff(off: EmployeeWeekTimeOff): { label: string; reasons: string[] };
```

**Overlap math = date-string comparison, NOT Date objects.** All of
`start_date`, `end_date` (DB DATE → `'yyyy-MM-dd'`) and `weekDayKeys` are ISO
`yyyy-MM-dd` strings, which sort lexicographically identical to chronological
order. A day is off iff `start_date <= dayKey && dayKey <= end_date` for some
`status === 'approved'` request. This deliberately avoids `new Date(dateString)`
(host-TZ-dependent; lessons 2026-05-03 / 2026-05-10) and matches exactly how the
grid keys its cells. Defensive `.slice(0, 10)` on request dates guards against any
datetime drift. (Unlike *shift* overlap — lessons 2026-05-18 — time off is
whole-day/date-based, so there is no overnight/cross-midnight frame problem.)

`spans` are computed by walking `weekDayKeys` in order and grouping consecutive
off-days, so the renderer can show one label per run without `colspan`.

## New: `info` Tailwind token

`tailwind.config.ts` currently exposes `warning` and `success` (backed by CSS
vars) but **not** `info`, even though `--info` / `--info-foreground` already exist
in `src/index.css` (light + dark). Add `info` mirroring the existing pattern so the
time-off blue uses a semantic token (no hardcoded color, per CLAUDE.md):

```ts
info: {
  DEFAULT: "hsl(var(--info))",
  foreground: "hsl(var(--info-foreground))",
},
```

Enables `bg-info/10`, `text-info`, `border-info/20`.

## Rendering changes — `src/pages/Scheduling.tsx`

### 1. Identity cell — desktop (name line ~1562, meta line ~1581)

- **Name line (1562):** after the Inactive badge, add the **Minor pill** (amber,
  `isMinor(employee.date_of_birth)`) and the **Off summary chip** when the employee
  has any off-day this week:
  ```tsx
  {empOff && (
    <span title={summarizeOff(empOff).reasons.join(', ') || 'Approved time off'}
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-info/10 text-info font-medium shrink-0">
      <CalendarOff className="h-3 w-3" aria-hidden="true" />
      {summarizeOff(empOff).label}   {/* e.g. "Off Wed–Fri" or "Off Sat" */}
    </span>
  )}
  ```
- **Meta line (1581):** add the **FT/PT tag** beside the hours pill (mirror
  `EmployeeList.tsx:291`).

### 2. Day cells (~1639-1695)

Inside the `weekDays.map`, compute `dayKey = format(day, 'yyyy-MM-dd')` (already
present) and `isOff = empOff?.offDayKeys.has(dayKey)`.

- **Off + no shift:** render the cell with a blue band fill (`bg-info/10`); show
  `CalendarOff` + label only on the run's first day (`dayKey === span.startKey`) so
  consecutive days read as one band; suppress the default one-click "Add" and
  replace with a warning-styled **"Add anyway"** affordance (still routes through
  the existing `handleAddShift` / ShiftDialog). Per-day cells are preserved (no
  `colspan`) so `DroppableDayCell` drag-and-drop keeps working.
- **Off + has shift (conflict):** keep the shift card(s) (their existing
  `useCheckConflicts` AlertTriangle already fires — it calls the
  `check_timeoff_conflict` RPC), add the blue band tint, and escalate the cell with
  a `ring-1 ring-destructive/40` so the double-book is unmistakable.
- **Not off:** unchanged.

### 3. Identity cell — mobile (~1604-1637)

Avatar-only column degrades to small corner dots on the avatar: amber dot when
minor, blue dot when off this week. FT/PT stays in the existing tooltip. Day-cell
bands still render (cells exist on mobile). Keep the existing `md:` breakpoint —
do not introduce `sm:`/`lg:` (lessons 2026-05-17, single-breakpoint policy).

### 4. Icon import

Add `CalendarOff` to the lucide import block (`AlertTriangle` already imported).

## Testing

- `tests/unit/scheduleTimeOff.test.ts` — pure helper:
  - single-day off, multi-day off (span grouping), employee with no off-days absent
    from the map, pending/rejected requests excluded, request straddling the week
    boundary (clipped to in-week days), multiple requests for one employee,
    distinct-reason collection, datetime-suffixed dates (`.slice(0,10)`), and
    string-vs-Date TZ-safety (assert no `new Date(dateString)` dependence by
    running an off-day at a month/DST boundary).
- `tests/unit/scheduleRosterContext.classes.test.ts` — source-text guard
  (lessons 2026-05-17): assert the schedule identity cell contains the FT/PT tag
  expression, the amber Minor pill class string, and the `bg-info/10`/`CalendarOff`
  time-off markers; negative-assert no hardcoded blue (`bg-blue-`) leaked in.
- No new DB tests (no SQL surface).

## Decided trade-offs

- **No `colspan` merged band.** Merging would break the per-day `DroppableDayCell`
  drag-and-drop target. We get the band look via shared blue fill + single label on
  the run's first day. Accepted: a faint inner border appears between consecutive
  off-days.
- **Soft-block, not hard-block.** Off-day "Add anyway" still opens ShiftDialog; the
  manager can override (e.g. they just approved a swap). The created shift's
  existing conflict warning is the safety net. A hard confirm dialog is a possible
  follow-up if managers want more friction.
- **Conflict reuses `useCheckConflicts`.** We do not duplicate time-off conflict
  detection; the cell ring is presentational only.

## Out of scope

- Refactoring `EmployeeList.tsx` / `EmployeeSidebar.tsx` to share the badge markup.
- Filtering/sorting the schedule by these attributes.
- A schedule-grid legend (the badges are self-explanatory; can be a follow-up).
- Surfacing *pending* (un-approved) time off on the grid.

## Files

| File | Change |
|---|---|
| `tailwind.config.ts` | Add `info` color token |
| `src/lib/scheduleTimeOff.ts` | New pure helper (`buildWeekTimeOff`, `summarizeOff`) |
| `src/pages/Scheduling.tsx` | Minor pill, FT/PT tag, Off chip, day-cell bands, conflict ring, soft-block, mobile dots, `CalendarOff` import |
| `tests/unit/scheduleTimeOff.test.ts` | New |
| `tests/unit/scheduleRosterContext.classes.test.ts` | New (source-text class guard) |
