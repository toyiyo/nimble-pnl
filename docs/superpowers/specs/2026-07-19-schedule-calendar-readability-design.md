# Design: Schedule calendar view readability

**Date:** 2026-07-19
**Branch:** `feature/schedule-calendar-readability`
**Surface:** `src/pages/Scheduling.tsx` (Schedule tab — weekly employee × day grid)

## Problem

User feedback on the weekly Schedule grid:

1. **"Today" is too subtle.** Current treatment is a 5%-opacity primary tint
   (`bg-primary/5`) plus a 1.5px pulsing dot. It disappears against the
   zebra-striped rows.
2. **Hard to use on mobile.** The 7-column table renders at all viewport
   sizes (`min-w-[600px]` + `overflow-x-auto`), so on a phone it collapses the
   team column to a 56px **initials-only** avatar strip.
3. **Names not visible on mobile** — only initials show.
4. **Availability is unclear**, and **time-off reads as ambiguous blue.** The
   off treatment uses `bg-info/10 text-info` — the same blue used for `server`
   shifts (`src/lib/positionColors.ts`) and info states — and only the **first
   day** of a multi-day span is labeled "Time off"; the remaining days are an
   unlabeled blue block.

## Goals

- Make "today" unmistakable at a glance.
- Give time-off a treatment that is (a) visually distinct from every shift/info
  color and (b) labeled on **every** day of a span.
- Explicitly flag a shift scheduled during approved time off as a **conflict**.
- Show a per-employee **weekly availability status** chip beside each name,
  backed by real availability data.
- Replace the initials-only mobile grid with a **day-focused layout**:
  a day-picker strip + full-name employee cards.

## Non-goals / decided trade-offs

- **Conflict = shift during approved *time off* only.** We do NOT expand the
  conflict flag to "shift outside recurring availability" — that is a separate,
  noisier signal already surfaced by the planner's `AvailabilityConflictDialog`.
  Keeping conflict scoped to approved time off matches the existing
  `isOff && hasShift` logic and bounds the blast radius.
- **No DB / RLS / edge / migration changes.** Availability is read through the
  existing `useEmployeeAvailability` / `useAvailabilityExceptions` hooks (already
  used by `TeamAvailabilityGrid`, already RLS-scoped by `restaurant_id`).
- **Mobile drops drag-and-drop.** DnD is a desktop affordance; mobile uses
  tap-to-edit and an explicit per-employee "Add shift" affordance. Selection
  mode continues to work via the shared `ShiftCard` (which already handles
  `selectionMode`).

## Design

### 1. "Today" highlight (desktop grid)

Three redundant cues instead of one faint tint (semantic `primary` token only):

- **Header cell** (`Scheduling.tsx` ~1489): filled `primary` date circle for the
  day number, a small "Today" badge (`bg-primary text-primary-foreground`), and
  a 3px `primary` cap rule via `shadow-[inset_0_3px_0_hsl(var(--primary))]`.
  Replaces the pulsing dot (also drops a `prefers-reduced-motion` offender).
- **Body column** (`DroppableDayCell`): raise the tint to `bg-primary/[0.06]`
  and **bracket** the column with inset left/right hairlines
  (`inset ±1px hsl(var(--primary)/.28)`) so it reads as one continuous vertical
  band from header to last row.

### 2. Time-off treatment (desktop grid)

`Scheduling.tsx` ~1738 (inside `DroppableDayCell`). Move off cells **off the
info-blue** onto a neutral hatched treatment, labeled every day:

- New utility classes in `src/index.css` `@layer utilities`:
  - `.timeoff-hatch` — `repeating-linear-gradient(45deg, …)` in
    `hsl(var(--muted-foreground)/…)` over a faint `muted` wash + dashed
    `muted-foreground/50` border. Neutral slate — distinct from the emerald/
    amber/red **availability** palette AND from `info` blue.
  - `.conflict-hatch` — same geometry in `hsl(var(--destructive)/…)`.
- **Every** off day renders a compact "Time off" pill (icon + label), not just
  `isRunStart`. Conflict days (`isOff && hasShift`) render a `destructive`
  "⚑ Conflict" tag above the shift on the conflict hatch.
- `sr-only` conflict/time-off text is preserved. **`DroppableDayCell` keeps
  `position: relative`** (regression guard for PR #585: abspos/`sr-only`
  descendants must stay clipped inside the scroller).

### 3. Weekly availability status chip (desktop name cell)

`Scheduling.tsx` ~1594. One chip system beside each name:

- **Data:** add `useEmployeeAvailability(restaurantId)` +
  `useAvailabilityExceptions(restaurantId)`; memoize
  `computeEffectiveAvailability(availability, exceptions, weekStart, employeeIds)`.
  Memo dep must be a **stable string key** (`employeeIds.join(',')` +
  `weekStartKey`), not a fresh `employees.map(...)` array literal, or the memo
  is defeated every render.
- **Three-state:** both hooks already use `staleTime: 30000`. While either query
  is loading or on error, the availability map is empty → `summarizeWeekAvailability`
  yields `unset` → **no chip** (graceful, no page skeleton — shifts/grid render
  independently). Time-off state still shows because it comes from the already-
  loaded `weekTimeOff`.
- **New pure helper** in `src/lib/effectiveAvailability.ts` (measured dir →
  coverage counts): `summarizeWeekAvailability(week, off)` →
  `{ status: 'time_off' | 'limited' | 'available' | 'unset', label }`.
  Priority: approved time off → `time_off`; else any unavailable/exception day →
  `limited`; else any available day → `available`; else `unset`.
- **Chip states** (reuse the established availability palette; `time_off` uses
  the neutral muted family to match the cell hatch):
  - `time_off` → existing off pill, restyled to the muted family (keeps its
    reasons tooltip). This IS the time-off state of the chip — no double signal.
  - `limited` → amber (`bg-amber-500/10 text-amber-700 dark:text-amber-400`).
  - `available` → subtle success (`text-success bg-success/10`), quiet so it
    doesn't shout on every row.
  - `unset` → no chip (avoid decorative noise; matches "structure encodes
    something true").

### 4. Mobile day-focused layout

**Only the `hidden md:block` / `md:hidden` CSS-split *mechanism* is borrowed
from `TeamAvailabilityGrid`** (whose mobile view is one card per employee across
all 7 days). The day-picker + single-day-per-card interaction model here is new.

- Wrap the existing `<table>` (+ its `DndContext`) in `hidden md:block`. Only the
  desktop tree carries a `DndContext` — no duplicate DnD. Dialogs stay page-level
  (Single Dialog Pattern), driven by shared handlers, so no duplication.
- New component `src/components/scheduling/WeekScheduleMobile.tsx` (`md:hidden`):
  - **Sticky day-picker strip:** 7 day chips (`Mon 14` … `Sun 20`), today marked
    with a `primary` tick + `aria-current="date"`, selected chip filled
    `primary/10`.
    - **A11y:** chips are `<button>`s with `aria-pressed={isSelected}`, a visible
      `focus-visible` ring, and a **≥44px** touch target (`min-h-11`); plain tab
      order (no roving tabindex — 7 buttons is fine).
  - Default selected day = today if within the displayed week, else the first day
    (pure `pickDefaultMobileDay(weekDays, today)` → unit-tested). **Re-derived
    when `weekStart` changes** (via `useEffect` on the week key), so prev/next
    week navigation doesn't leave the picker on a stale date.
  - **Employee cards** for the selected day: avatar + **full name** + position ·
    FT/PT + weekly-hours; availability chip; then body = shift(s) via the shared
    `ShiftCard` **or** a "Time off" banner **or** a conflict block (destructive
    header + shift) **or** empty + "Add shift".
  - Respects `selectionMode` (reuses `ShiftCard`'s selection props) and the
    existing `handleAddShift` / `handleEditShift` / `handleEditEmployee`.
- **`ShiftCard` keyboard access:** the mobile layout makes tap-to-edit the
  *primary* edit path, but `ShiftCard`'s clickable surface is a bare `<div
  onClick>` (no keyboard support). Add `role="button"`, `tabIndex={0}`, and an
  `onKeyDown` (Enter/Space) to that surface as part of this work — fixes a
  pre-existing gap that mobile would otherwise lean on. (Small, shared by desktop
  too; behavior otherwise unchanged.)
- Because the wide table is `display:none` on mobile, the PR #585 sr-only escape
  vector is inert on phones; the desktop fix remains in place. Note: both trees
  stay **mounted** (hidden ≠ unmounted), matching `TeamAvailabilityGrid` — the
  invisible desktop table still re-renders; acceptable at current roster sizes,
  measured in Testing.

## Files touched

| File | Change |
|---|---|
| `src/index.css` | `.timeoff-hatch`, `.conflict-hatch` utilities |
| `src/lib/effectiveAvailability.ts` | `summarizeWeekAvailability` + status→classes helper |
| `src/lib/scheduleMobile.ts` (new) | `pickDefaultMobileDay` pure helper |
| `src/pages/Scheduling.tsx` | today header, availability data + chip, time-off cell, desktop/mobile split, `ShiftCard` keyboard access |
| `src/components/scheduling/DroppableDayCell.tsx` | today column bracketing |
| `src/components/scheduling/WeekScheduleMobile.tsx` (new) | mobile day-focused view |
| `tests/unit/effectiveAvailability.test.ts` | `summarizeWeekAvailability` cases |
| `tests/unit/scheduleMobile.test.ts` (new) | `pickDefaultMobileDay` cases |

## Testing

- Unit: `summarizeWeekAvailability` (time_off > limited > available > unset
  priority; empty inputs) and `pickDefaultMobileDay` (today-in-week, today-out,
  week boundaries) — both in `src/lib` so SonarCloud counts the coverage.
- Manual/preview: verify today band, hatched every-day time off, conflict flag,
  availability chips, and the mobile day view at 375px in both themes; sanity-
  check that the (mounted-but-hidden) desktop table doesn't cause jank on a
  larger roster.

## Lessons applied (from `memory/lessons.md`)

- **PR #585** (mobile sr-only escape → horizontal overflow) — keep
  `DroppableDayCell` and the `overflow-x-auto` scroller `relative`; don't add
  abspos/`sr-only` content to unpositioned scroll ancestors.
- **No raw colors** — reuse the availability palette shared helper; time-off/
  conflict hatch use `muted-foreground` / `destructive` tokens via utilities.
- **SonarCloud cognitive complexity ≤15** — keep new helpers flat, extract
  per-branch functions; put pure logic in `src/lib` (measured) not components.
- **TZ discipline** — reuse `date-fns` `isToday` and the existing
  UTC-anchored availability/time-off helpers; no ad-hoc date math.
