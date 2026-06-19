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

/**
 * Summary for the name-cell chip + its tooltip/AT text.
 * label format:
 *   - single off-day  → "Off Mon"            (weekday abbr of the only off-day)
 *   - contiguous run  → "Off Wed–Fri"        (first–last weekday abbr, en dash)
 *   - non-contiguous  → "Off 3 days"         (>1 span: total in-week off-day count)
 * Weekday abbr derived from the dayKey via date-fns format(parseISO(key),'EEE');
 * parseISO of a 'yyyy-MM-dd' is safe here — it is only used to pick a label, never
 * for overlap math. reasons = distinct non-empty reasons across all in-week spans.
 */
export function summarizeOff(off: EmployeeWeekTimeOff): { label: string; reasons: string[] };
```

### Memoization (required — perf review)

`Scheduling.tsx` re-renders on drag/hover/selection state, so the derived
structures MUST be memoized (lessons: derived state via `useMemo`, never recompute
in the render body):

```ts
// stable 'yyyy-MM-dd' keys for the 7 visualized days
const weekDayKeys = useMemo(
  () => weekDays.map((d) => format(d, 'yyyy-MM-dd')),
  [weekDays],
);
// per-employee approved-time-off context for the week
const weekTimeOff = useMemo(
  () => buildWeekTimeOff(timeOffRequests, weekDayKeys),
  [timeOffRequests, weekDayKeys],
);
```

Per employee row, read `const empOff = weekTimeOff.get(employee.id)` once, and
`const off = empOff ? summarizeOff(empOff) : null` once (destructure `off.label` /
`off.reasons` — do not call `summarizeOff` twice). Per cell, `offDayKeys.has(dayKey)`
is an O(1) lookup.

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
  has any off-day this week. The chip uses a shadcn `<Tooltip>` for the mouse-hover
  reason (NOT the `title` attribute — `title` is inaccessible to keyboard/SR/touch)
  plus an `sr-only` reason for AT, and `text-[11px]` to match the row scale:
  ```tsx
  {off && (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-info/10 text-info font-medium shrink-0">
            <CalendarOff className="h-3 w-3" aria-hidden="true" />
            {off.label}                              {/* "Off Wed–Fri" — text, not color-alone */}
            <span className="sr-only">
              — approved time off{off.reasons.length ? `: ${off.reasons.join(', ')}` : ''}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {off.reasons.length ? off.reasons.join(', ') : 'Approved time off'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )}
  ```
- **Meta line (1581):** add the **FT/PT tag** beside the hours pill (mirror
  `EmployeeList.tsx:291`), pinning `text-muted-foreground` so it renders identically
  regardless of which line it sits on:
  ```tsx
  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
    {employee.employment_type === 'part_time' ? 'PT' : 'FT'}
  </span>
  ```

### 2. Day cells (~1639-1695)

Inside the `weekDays.map`, compute `dayKey = format(day, 'yyyy-MM-dd')` (already
present) and `isOff = !!empOff?.offDayKeys.has(dayKey)`, plus
`isRunStart = empOff?.spans.some((s) => s.startKey === dayKey)`.

**Non-color signal on EVERY off-day cell (WCAG 1.4.1).** Color tint alone is not a
sufficient signal, and interior days of a multi-day run would otherwise be
color-only. So every off-day cell carries, in addition to the `bg-info/10` tint:
- a left accent bar — `border-l-2 border-info` (or `border-destructive` on a
  conflict day, see below): a position/shape cue that survives color-blind modes,
- an `sr-only` text node announcing the state for AT (announced as the cell is
  entered in the table), and
- the `CalendarOff` icon + visible label rendered **only on the run's first day**
  (`isRunStart`) so consecutive days still read as one band.

```tsx
// inside the cell content wrapper, when isOff:
<span className="sr-only">
  {hasShift ? 'Scheduling conflict: shift scheduled during approved time off' : 'Approved time off'}
</span>
{isRunStart && (
  <div className="flex items-center gap-1 text-[11px] text-info font-medium">
    <CalendarOff className="h-3 w-3" aria-hidden="true" />
    Time off
  </div>
)}
```

- **Off + no shift:** `bg-info/10` + `border-l-2 border-info` + sr-only "Approved
  time off" + first-day label. Suppress the default one-click "Add" and replace
  with a warning-styled **"Add anyway"** affordance that still routes through the
  existing `handleAddShift(day, employee)` (→ ShiftDialog). It MUST carry a
  contextual `aria-label` (the bare "Add" text is identical across every cell):
  ```tsx
  <Button variant="ghost" size="sm"
    className="w-full h-8 text-xs border border-dashed border-warning/50 text-warning hover:bg-warning/10 opacity-0 group-hover:opacity-100 transition-all"
    aria-label={`Add shift for ${employee.name} on ${format(day, 'EEE MMM d')} despite approved time off`}
    onClick={() => handleAddShift(day, employee)}>
    <Plus className="h-3 w-3 mr-1" /> Add anyway
  </Button>
  ```
  Per-day cells are preserved (no `colspan`) so `DroppableDayCell` drag-and-drop
  keeps working.
- **Off + has shift (conflict):** keep the shift card(s) — their existing
  `useCheckConflicts` AlertTriangle already fires (it calls the
  `check_timeoff_conflict` RPC) and is the authoritative conflict signal for sighted
  + AT users. Escalate the SAME accent bar to `border-l-2 border-destructive` (no
  separate `ring`, to avoid redundant noise) and switch the sr-only text to the
  conflict wording above. The blue tint stays so the day still reads as time off.
- **Not off:** unchanged.

### 3. Identity cell — mobile (~1604-1637)

Avatar-only column degrades to small corner dots on the avatar: amber dot when
minor, blue dot when off this week. The dots are decorative (`aria-hidden="true"`);
the state reaches AT through the avatar button's `aria-label` and the tooltip:

- Extend the avatar button `aria-label` (currently `"{name}, {position}"`) to:
  ```tsx
  aria-label={`${employee.name}, ${employee.position}${isMinorEmployee ? ', minor' : ''}${off ? `, ${off.label.toLowerCase()}` : ''}`}
  ```
- Add a line to the existing `<TooltipContent>` (currently name + position) showing
  `{isMinorEmployee ? 'Minor · ' : ''}{ft/pt label}{off ? ` · ${off.label}` : ''}`.

Day-cell bands still render (cells exist on mobile). Keep the existing `md:`
breakpoint — do not introduce `sm:`/`lg:` (lessons 2026-05-17, single-breakpoint
policy).

### 4. Icon import

Add `CalendarOff` to the lucide import block (`AlertTriangle` already imported).
Confirmed exported by the installed `lucide-react@0.462.0`, so no fallback needed.

### 5. Component primitive — raw `<span>` (decided)

All three tags (Minor, FT/PT, Off chip) use raw `<span>` elements, matching
`EmployeeList.tsx:291-298`, because the custom sizing (`text-[11px]`, `px-1.5
py-0.5`) already departs from shadcn `<Badge>` defaults and a span keeps the markup
identical to the established roster pattern. The existing Inactive `<Badge
variant="outline">` on the schedule row (line 1576) is left as-is. This is a
deliberate consistency choice over swapping everything to `<Badge>`.

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
  expression, the amber Minor pill class string, the `bg-info/10` + `CalendarOff`
  time-off markers, the `border-l-2 border-info` / `border-destructive` accent bars,
  the `sr-only` time-off/conflict text, and the contextual `aria-label` on the "Add
  anyway" control; negative-assert no hardcoded blue (`bg-blue-`) and no `title=`
  tooltip on the Off chip leaked in.
- No new DB tests (no SQL surface).

## Phase 2.5 review — folded changes

Frontend design review (approve-with-changes) accepted in full:
- **a11y (critical):** every off-day cell gets a `border-l-2` accent bar + `sr-only`
  text (not color-alone); "Add anyway" gets a contextual `aria-label`.
- **a11y (major):** Off chip uses shadcn `<Tooltip>` + `sr-only` reason instead of
  `title`; mobile avatar `aria-label` + tooltip carry minor/FT-PT/off; dots are
  `aria-hidden`.
- **perf (major):** `weekDayKeys` and `weekTimeOff` are `useMemo`'d; `summarizeOff`
  is called once per row.
- **consistency (minor):** chips use `text-[11px]` (not `10px`); FT/PT pins
  `text-muted-foreground`; conflict reuses the existing AlertTriangle and escalates
  the accent bar to `border-destructive` (no redundant ring); raw `<span>` chosen
  over `<Badge>` and documented.

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
