# Planner Schedule Visibility & Week Sync

**Date:** 2026-04-21
**Status:** Draft — awaiting user approval
**Scope:** Scheduling area (Schedule tab, Planner tab), mobile + desktop

## Summary

Two related improvements to the Scheduling page:

1. **Shared week selection** — the selected week persists when the user switches between the Schedule tab and the Planner tab (and survives page reload).
2. **Planner schedule visibility** — the Planner grows four complementary views that answer "what does this week already look like?" and, critically, "is Jose already allocated, and where does this shift overlap with his existing schedule?" — without abandoning the template-driven planning model.

## Problem Statement

### Issue 1 — Date desync across tabs
`Scheduling.tsx` owns `currentWeekStart` for the Schedule tab (local `useState`). `useShiftPlanner` owns an independent `weekStart` for the Planner tab. Switching tabs presents the week each tab happens to hold, which rarely matches. Users lose their place.

### Issue 2 — Planner lacks schedule context
The Planner is template-centric: rows are templates (`Open-week-csc`, `Close-wtz`), columns are days, cells are capacity counters (`0/2`, `2/3`). Managers planning a week can't see:
- What does each day actually look like over time? (coverage shape, peak hours, gaps)
- Is Jose already on Monday? How many hours does he have?
- Does this template I'm about to assign to Jose overlap his existing shift?

The existing `EmployeeSidebar` shows names and total weekly hours, but not when those hours are. Conflicts surface only after the user attempts an assignment, via `AvailabilityConflictDialog` — reactive, not preventive.

## Design Overview

Four additions to the Planner, plus a shared week source across the Scheduling page:

| Key | Addition | Purpose |
|-----|----------|---------|
| A | Coverage strip under day headers | See hour-by-hour headcount density per day |
| B | "Schedule Overview" panel above grid | See each day's shift shape (mini-Gantt) + gaps |
| 1 | Rich employee cards with mini-week | See each person's whole week at a glance |
| 2 | Allocation overlay on hover/pick | See where the picked employee clashes, fits, or is already on |
| — | Shared `week` URL param | Persist selected week across tabs and reloads |

A and B give day-shape visibility. 1 and 2 give person-allocation visibility. They compose: A+B answer "what is this week?", 1+2 answer "where does this person fit in it?"

## Feature 1 — Shared Week State

**Approach:** URL search parameter `?week=YYYY-MM-DD` (Monday of the visible week).

**Why URL:**
- Survives page reload
- Shareable via link ("look at week of May 4")
- Orthogonal to tab selection (tab state stays local; week state is shared)
- Single source of truth — no lift-and-prop-drill, no new context

**Implementation:**
- New `useSharedWeek()` hook in `src/hooks/useSharedWeek.ts`:
  - Reads `week` from `useSearchParams()`. Defaults to current Monday if missing/invalid.
  - Returns `{ weekStart: Date, setWeekStart: (Date) => void }`.
  - Parses/serializes as `YYYY-MM-DD`. Validates as a Monday — if a non-Monday slips in, normalizes via `startOfWeek(..., { weekStartsOn: 1 })`.
- `Scheduling.tsx` replaces its `currentWeekStart` `useState` with `useSharedWeek()`.
- `useShiftPlanner` accepts an optional `externalWeekStart` prop. When provided, it uses that instead of internal state. `ShiftPlannerTab` passes the shared week down.
- Tab switch still uses `<Tabs defaultValue="schedule">` (unchanged); no URL coupling for the tab itself.

**Edge cases:**
- No `week` param → default to today's Monday.
- Invalid/malformed param → normalize silently (don't error — log in dev).
- User navigates between `/scheduling` pages → URL carries forward.

**Out of scope:** persisting the active tab itself to URL. Different concern, different fix.

## Feature 2 — Coverage Strip (Option A)

A thin horizontal heatmap row **under the day headers** of the template grid, showing hour-by-hour headcount density for each day.

**Desktop layout:**
```
[SHIFT]   Mon 4   Tue 5   Wed 6   Thu 7   Fri 8   Sat 9   Sun 10
[Coverage] ▁▂▃▄▅▆  ▂▃▄▅▆▅  ▁▂▃▄▅▆  ...
[Open-week-csc] 2/2  2/2  1/2  ...
```

**Mobile:** Relocated. A 17-bucket heatmap across a 40px column is unreadable, so on mobile the strip lives **inside each day's Overview card** (see Feature 3). One coverage bar per day, stacked vertically.

**Computation:**
- Input: all shifts in the visible week (`shifts` from `useShifts`).
- For each day × hour bucket (6am–11pm = 17 hours):
  - Count shifts with `start_time ≤ hour < end_time` (ignoring breaks for v1).
- Bucket to 5 levels (`h0`–`h4`) based on headcount:
  - h0 = 0 people, h1 = 1, h2 = 2, h3 = 3, h4 ≥ 4.
  - Colors tuned to pass WCAG AA against `bg-background`.

**Respects area filter:** When `areaFilter` is set to "Cold Stone", coverage shows only shifts whose template belongs to Cold Stone (or, for template-less shifts, skip).

**Component:** `src/components/scheduling/ShiftPlanner/CoverageStrip.tsx`
- Props: `shifts`, `weekDays`, `areaFilter`
- Renders 7 inline-grid bars with hour tooltips

**Interaction:**
- Hover a bucket → tooltip "Mon 2–3pm · 3 on shift"
- Click a bucket → no action in v1 (future: scroll to that hour in Day-Overview panel)

## Feature 3 — Schedule Overview Panel (Option B)

A collapsible panel **above the template grid** (below Staffing Suggestions) that renders each day as a compact Gantt.

**Desktop layout:** 7 columns horizontally. Each column:
- Day label ("Mon 4")
- 3 tracks (one per simultaneous shift layer — overflow collapses into "+N more")
- Shift pills colored by role (server blue, cook amber, dish green, closer purple)
- A "gap" chip if the day has a coverage hole during expected operating hours (>= 1 hour with 0 headcount after the first shift starts)
- An "unstaffed" chip if no shifts at all

**Mobile layout:** Stacked vertically. Each day is a full-width card:
- Header row: "Mon 4" + chips ("3 shifts", "Gap 3p", etc.)
- Timeline track with shift pills
- A thin coverage heatmap (the mobile home for Feature 2)
- Hour ruler beneath
- Tapping the day card scrolls the template grid to that day's column

**Expanded by default** on both desktop and mobile — the panel is the primary answer to "what does this week look like?", so it must be visible on first paint. User can collapse. (Collapsed-state persistence is deferred to a later iteration.)

**Component:** `src/components/scheduling/ShiftPlanner/ScheduleOverviewPanel.tsx`
- Props: `shifts`, `weekDays`, `areaFilter`, `timezone`
- Sub-component: `OverviewDayCard` used in both layouts

**Data computation:**
- For each day, given shifts for that day:
  - Sort by start time, greedy-pack into N lanes (v1: max 3 lanes, remaining → "+N more")
  - Position each pill: `left = (start_hour - 6) / 17 * 100%`, `width = duration / 17 * 100%`
- Gap detection: starting from the earliest shift's start hour, scan forward; if a 60+ min window has 0 headcount before the last shift ends, flag it.
- Unstaffed: day has 0 shifts.

**Respects area filter** same as Feature 2.

## Feature 4 — Rich Employee Cards with Mini-Week (Option 1)

Expand each employee card in the `EmployeeSidebar` to show a 7-day mini-calendar of that employee's shifts **for the visible week**.

**Card layout:**
```
Jose Delgado                14h / 40
Manager · Both
┌──┬──┬──┬──┬──┬──┬──┐
│M │T │W │T │F │S │S │
│▓ │▓ │  │  ▓│  │  │  │   <- shift bars
└──┴──┴──┴──┴──┴──┴──┘
```

- Mini-week is 7 columns of ~14px width (desktop) / 28px width (mobile drawer)
- Each column is a 36px-tall vertical track representing 6am–11pm
- Each shift is a positioned colored bar: `top = (start_hour - 6) / 17 * 100%`, `height = duration / 17 * 100%`, color by `position` field
- Columns for days off are a lighter gray (`.off`)
- "Today" column gets a subtle indigo inset ring

**Performance consideration:** With 100+ employees, rendering 100 mini-weeks requires care.
- Compute `shiftsByEmployee` once per week at the hook level, memoized.
- `EmployeeCard` component is `memo`'d with `prevProps.shifts === nextProps.shifts && prevProps.employee.id === nextProps.employee.id`.
- Mini-week itself is a pure subcomponent passed pre-computed `employeeShifts: Shift[]`.

**Respects area filter** at employee-card level (already in place). Mini-week shows ALL of that employee's shifts in the week, not only shifts matching the filter — the point is to see total allocation, not filtered subset.

**Components:**
- Modify: `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx`
- Modify: `src/components/scheduling/ShiftPlanner/EmployeeCard.tsx` (or inline if it doesn't exist yet — will confirm during build)
- New: `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx`

## Feature 5 — Allocation Overlay on Hover / Pick (Option 2)

When an employee is "picked" (hover on desktop, tap-selected on mobile, or dragging), the template grid annotates itself based on each cell's relationship to that employee's existing allocation.

**Annotation rules** — given picked employee E and cell (template T, day D):
- **Already on (purple outline + "Name" chip):** E has a shift on day D where `start_time ≤ T.start_time AND end_time ≥ T.end_time` (E is already assigned to this template-slot or an encompassing shift).
- **Conflict (red stripes + "Conflicts" chip):** E has any shift on day D whose `[start, end)` intersects `[T.start, T.end)` but isn't the encompassing case above.
- **Fits cleanly (subtle green tint):** E has no overlapping shift on D, template is active on D.
- **Not active / off-day:** no annotation (cell stays as-is).

**Trigger states:**
- Desktop: `onMouseEnter` / `onMouseLeave` on `EmployeeCard` → sets `hoveredEmployeeId`. Existing `onDragStart` (from `@dnd-kit`) also sets it.
- Mobile: tapping an employee from the drawer already sets `selectedMobileEmployee`. Reuse that state as the pick signal.

**State plumbing:**
- `ShiftPlannerTab` owns new state: `pickedEmployeeId: string | null`, set by hover, drag, or mobile tap (whichever fires).
- Passed into `TemplateGrid` → `ShiftCell`. `ShiftCell` receives a new `allocationStatus: 'none' | 'highlight' | 'conflict' | 'available'` prop (pre-computed by parent) and renders the border/bg.

**Performance:**
- `computeAllocationStatuses(shifts, pickedEmployeeId, templates, weekDays)` returns `Map<cellId, status>` in O(days × templates). Memoized on `[shifts, pickedEmployeeId, templates, weekDays]`.
- Debounce hover changes (100ms) so quick mouse sweeps don't thrash renders.

**Visual** (CLAUDE.md semantic tokens):
- Highlight: `outline: 2px solid hsl(var(--primary))`, chip `bg-primary text-primary-foreground`
- Conflict: diagonal striped `hsl(var(--destructive)/.1)` background, outline `hsl(var(--destructive))`, chip `bg-destructive text-destructive-foreground`
- Available: `bg-primary/5`

**Accessibility:**
- `aria-live="polite"` region announces picked-employee count of conflicts/available slots once per selection.
- Color is never the only signal — every state has a chip or icon.

## Data & State Changes

### New hook: `useSharedWeek`
```typescript
// src/hooks/useSharedWeek.ts
export function useSharedWeek(): {
  weekStart: Date;
  setWeekStart: (date: Date) => void;
}
```

### New hook: `usePlannerShiftsIndex`
Memoized indexes derived from `shifts` for the visible week:
```typescript
// src/hooks/usePlannerShiftsIndex.ts
export function usePlannerShiftsIndex(shifts: Shift[], weekDays: string[]): {
  shiftsByEmployee: Map<string, Shift[]>;       // powers mini-week (Feature 4)
  coverageByDay: Map<string, number[]>;          // powers CoverageStrip (Feature 2)
  overviewDays: OverviewDay[];                   // powers OverviewPanel (Feature 3)
}
```

### New utility: `computeAllocationStatus`
```typescript
// src/lib/shiftAllocation.ts
export function computeAllocationStatus(
  employeeShifts: Shift[],      // the picked employee's shifts on this day
  template: ShiftTemplate,
  day: string,                  // YYYY-MM-DD
): 'highlight' | 'conflict' | 'available' | 'none'
```

### Modified component props

- `TemplateGrid`: add `allocationStatuses: Map<string, AllocationStatus>` prop (cellId → status). Key format: `${templateId}:${day}`.
- `ShiftCell`: add `allocationStatus?: AllocationStatus` prop. Render annotation layer when not `'none'`.
- `EmployeeSidebar`: add `shifts: Shift[]` prop (already passed — confirmed in exploration). Pass to `EmployeeCard` which renders the mini-week.
- `useShiftPlanner`: accept optional `externalWeekStart?: Date` prop to defer to shared state.

### No new Supabase calls
All data already fetched by `useShifts(restaurantId, weekStart, weekEnd)`. New features are pure derivations/memoizations over existing shifts.

## Mobile-First Considerations

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Coverage strip | Under day headers (horizontal, 7 cells) | Relocated — one strip inside each day's Overview card |
| Day-Overview panel | 7 horizontal day columns | Vertical stack, one day per row, collapsed by default |
| Employee cards | Inline sidebar (260px) | Slide-in drawer (existing) |
| Mini-week | Inside each card (14px cols) | Inside each card (28px cols) |
| Overlay trigger | Hover on card + drag | Existing tap-select (no hover) |
| Selected banner | N/A | Existing bottom banner reused |

The mobile tap-to-assign flow already has an explicit "selected employee" state — the overlay reuses that state, so implementation is simpler on mobile than desktop.

Touch targets: all interactive chips ≥ 32px tap target; mini-week day columns not tappable in v1 (visual only).

## Visual Design (CLAUDE.md Apple/Notion scale)

- Coverage bars: 5 density levels mapped to `hsl(var(--primary))` at 10%/30%/50%/70%/85% opacity.
- Overview panel background: `bg-muted/30`, cards `bg-background border-border/40 rounded-xl`.
- Mini-week track: `bg-muted/50`, bars at full role color (server/cook/dish/closer).
- Overlay:
  - highlight: `outline-primary`
  - conflict: `bg-destructive/10` with stripe pattern, `outline-destructive`
  - available: `bg-primary/5`
- Typography follows CLAUDE.md: day labels `text-[12px] uppercase`, counts `text-[11px] tabular-nums`.

## Testing Strategy

### Unit tests (Vitest)
- `src/lib/shiftAllocation.test.ts`
  - `computeAllocationStatus` — highlight (exact match), conflict (partial overlap), available (no conflict), none (off-day).
  - Edge cases: midnight-crossing shifts, zero-duration shifts, timezone boundaries.
- `src/hooks/usePlannerShiftsIndex.test.ts`
  - Coverage computation: empty week, one shift, multiple overlapping shifts, 5+ people at one hour.
  - Overview packing: ≤3 shifts all fit, 5 shifts collapse 2 into "+2 more".
  - `shiftsByEmployee` groups correctly.
- `src/hooks/useSharedWeek.test.ts`
  - Default to current Monday.
  - Round-trips via URL.
  - Non-Monday input normalizes to Monday.

### Component tests (Vitest + Testing Library)
- `<CoverageStrip>` with sample shifts → correct number of density classes applied.
- `<OverviewDayCard>` with 0, 1, 4 shifts → renders empty state, single pill, "+1 more".
- `<EmployeeMiniWeek>` with mixed role shifts → bars colored by role, off-day cells present.
- `<ShiftCell>` with each `allocationStatus` → correct CSS classes and chip text.

### E2E tests (Playwright)
- **tab-week-sync.spec.ts**: navigate to Schedule tab, change to next week, switch to Planner tab, assert Planner shows the same week header.
- **planner-allocation-overlay.spec.ts**: open Planner, assign employee A to Mon template, tap employee A again, assert Mon cell shows "already on" annotation.
- **planner-mobile-overview.spec.ts** (emulated viewport): open Planner on iPhone viewport, assert Overview panel is collapsed by default, tap to expand, assert stacked day layout.

### pgTAP
- No new SQL — all changes are client-side derivations. No new RLS concerns.

## Out of Scope / Deferred

- **Option 3 — Group-by Employees view toggle.** Larger change, different mental model. Worth revisiting after 1+2 ship and we see whether they've addressed the blind spot.
- **Option D — Coverage vs forecast overlay.** Depends on sales forecast confidence; StaffingOverlay already partly covers this. Defer.
- **Clickable coverage bar → scroll Overview to that hour.** Nice-to-have.
- **Mini-week click to filter or jump** — visual only for v1.
- **Persisting collapsed state of Overview panel** — defer.

## Success Criteria

- Switching between Schedule and Planner tabs preserves the visible week. ✔
- Reloading the Scheduling page preserves the visible week. ✔
- A planner user can answer "is Jose already on Monday?" without opening any dialog or switching tabs — visible in <1 second. ✔
- A planner user can identify coverage gaps on Tuesday without mental math. ✔
- Attempting to double-book an employee shows visual conflict *before* drop/tap, not only in a post-hoc dialog. ✔
- Mobile-viewport build passes all Playwright checks. ✔
- TypeScript, lint, and full test suite green. ✔

## Open Questions

None — all design decisions resolved in brainstorming.

## References

- Existing code: `src/pages/Scheduling.tsx:331` (Schedule week state), `src/hooks/useShiftPlanner.ts:311` (Planner week state)
- Existing mobile flow: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:504-564`
- Mockups: `.superpowers/brainstorm/99138-1776812268/content/` (mobile-mockup.html, person-allocation-mockups.html, in-context-mockups.html)
