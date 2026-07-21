# Plan: Schedule calendar view readability

Design: `docs/superpowers/specs/2026-07-19-schedule-calendar-readability-design.md`
Branch: `feature/schedule-calendar-readability`

Each task is TDD (RED → GREEN → REFACTOR → COMMIT) where testable; CSS/JSX-only
tasks are verified by build + preview. Tasks 1–3 are foundational and
independent; later tasks depend on them.

## Task 1 — `summarizeWeekAvailability` helper (pure, tested)
**File:** `src/lib/effectiveAvailability.ts` (+ `tests/unit/effectiveAvailability.test.ts`)
- Add `WeekAvailabilityStatus = 'time_off' | 'limited' | 'available' | 'unset'`.
- `summarizeWeekAvailability(week: Map<number, EffectiveAvailability> | undefined, hasTimeOff: boolean, offLabel?: string): { status; label }`.
  - Priority: `hasTimeOff` → `time_off` (label = offLabel ?? 'Time off'); else any
    day `unavailable`/`exception-unavailable` → `limited`; else any `available` →
    `available`; else `unset`.
- Add `weekAvailabilityChipClasses(status)` → `{ bg, text }` reusing the
  availability palette (amber for limited, `text-success bg-success/10` for
  available, muted family for time_off; `unset` → none).
- **Tests first:** each priority branch, empty map, all-not-set → unset.
- Keep each function flat (SonarCloud complexity ≤15).

## Task 2 — `pickDefaultMobileDay` helper (pure, tested)
**File:** `src/lib/scheduleMobile.ts` (new) (+ `tests/unit/scheduleMobile.test.ts`)
- `pickDefaultMobileDay(weekDays: Date[], today: Date): number` → index of today
  if present in `weekDays` (compare via `date-fns` `isSameDay`), else `0`.
- **Tests first:** today mid-week, today == first/last day, today outside week,
  empty array guard.

## Task 3 — Hatch utilities (CSS)
**File:** `src/index.css` (`@layer utilities`)
- `.timeoff-hatch` — `repeating-linear-gradient(45deg, …)` in
  `hsl(var(--muted-foreground)/.14)` over `hsl(var(--muted-foreground)/.05)`.
- `.conflict-hatch` — same geometry in `hsl(var(--destructive)/…)`.
- Verify: `npm run build` compiles; visual check in preview.

## Task 4 — Today highlight (desktop)
**Files:** `src/pages/Scheduling.tsx` (header ~1489), `DroppableDayCell.tsx`
- Header today cell: filled `primary` date circle + `Today` badge
  (`bg-primary text-primary-foreground`) + inset cap rule; drop `animate-pulse`
  dot. Handle the `selectionMode` header variant too.
- `DroppableDayCell`: `bg-primary/[0.06]` + inset ±1px `primary/.28` side borders
  when `isToday` (bracketed column). Keep `relative` (PR #585 guard).
- Verify: build + preview (today column reads as one band, both themes).

## Task 5 — Time-off cell treatment (desktop)
**File:** `src/pages/Scheduling.tsx` (time-off cell ~1738)
- Replace `bg-info/10 border-info` with `.timeoff-hatch` + dashed
  `border-muted-foreground/50`; render a compact "Time off" pill (icon+label) on
  **every** off day (remove `isRunStart` gate).
- Conflict (`isOff && hasShift`): `.conflict-hatch` + `border-destructive` + a
  `text-destructive` "⚑ Conflict" tag above the shift.
- Preserve `sr-only` conflict/time-off text. No abspos added to unpositioned
  ancestors (PR #585).
- Verify: build + preview; multi-day span labeled each day; conflict flagged.

## Task 6 — Availability data + desktop chip
**File:** `src/pages/Scheduling.tsx` (imports + name cell ~1594)
- Add `useEmployeeAvailability(restaurantId)` + `useAvailabilityExceptions(restaurantId)`.
- `useMemo` `computeEffectiveAvailability(...)` with stable dep key
  (`employeeIds.join(',')` + week key).
- `useMemo` `Map<empId, {status,label}>` via `summarizeWeekAvailability`.
- Name cell: keep the existing off pill as the `time_off` chip (restyle to muted
  family); add the availability chip for `limited`/`available`; `unset` → nothing.
- Three-state: loading/error → empty map → `unset` → no chip (no page skeleton).
- Verify: build; typecheck; preview chips.

## Task 7 — `ShiftCard` keyboard access
**File:** `src/pages/Scheduling.tsx` (`ShiftCard` ~151)
- Add `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space → same as click)
  to the clickable surface; `focus-visible` ring. No behavior change otherwise.
- Verify: build; keyboard-activate a shift in preview.

## Task 8 — Mobile day-focused view
**Files:** `src/components/scheduling/WeekScheduleMobile.tsx` (new),
`src/pages/Scheduling.tsx` (split)
- Wrap desktop `<table>` + `DndContext` in `hidden md:block`.
- `WeekScheduleMobile` (`md:hidden`): sticky day-picker (`<button>`s,
  `aria-pressed`, `aria-current="date"` on today, `min-h-11`, focus ring);
  selected-day state defaulting via `pickDefaultMobileDay`, re-derived on
  `weekStart` change; employee cards (full name, avatar, position·FT/PT, hours,
  availability chip; body = `ShiftCard`(s) / Time-off banner / conflict block /
  empty + Add). Reuse page handlers + `selectionMode`.
- Verify: build; typecheck; preview at 375px both themes; confirm
  `documentElement.scrollWidth ≈ innerWidth` (no horizontal overflow, PR #585).

## Verification (Phase 8)
`npm run typecheck && npm run lint && npm run test && npm run build`; relevant
E2E if scheduling specs exist. Unit coverage from Tasks 1–2 lands in `src/lib`
(measured by SonarCloud).
