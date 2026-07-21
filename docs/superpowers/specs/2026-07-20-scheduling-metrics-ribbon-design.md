# Design: Scheduling metrics ribbon

**Date:** 2026-07-20
**Author:** Jose (via Claude Code)
**Status:** Approved (concept + open decisions locked)
**Surface:** UI-only (`src/pages/Scheduling.tsx`, new `src/components/scheduling/`)

## Problem

The `/scheduling` page opens with a wall of chrome before the actual work
(the schedule grid) appears:

1. A large gradient **hero header** ("Staff Schedule" + subtitle + This
   Week / Coverage), ~120px.
2. A **three-card metrics row** (Active Employees / Total Hours / Labor
   Cost), `grid md:grid-cols-3`, ~200px — and the Labor Cost card even
   embeds a Top Earners list + budget indicator, making it the tallest.

Together this pushes the schedule grid ~340px down. On a laptop the grid
is almost entirely below the fold. The numbers are useful **at a glance**,
but right now they form a barrier between the user and the work they came
to do.

User's words: *"once I glance at it, it feels burdensome since I really
want to work on the schedule and now I have to scroll down to do so."*

## Goal

Keep the summary numbers glanceable and always-available, but stop them
from occupying the viewport the schedule grid needs. Grid should be
visible on page load.

## Approach: compact sticky ribbon

Replace the hero header **and** the three metric cards with a single
**~52px metrics ribbon** that:

- Shows the three hero numbers + avg rate as inline **pills**:
  `24 staff · 325.8 hrs · $3,258 labor · $10/hr avg`.
- Folds the hero header essentials into its left edge: a small calendar
  icon + "Staff schedule" title, with `{shifts} shifts · {coverage} staff`
  as a muted secondary line. The big gradient header is **removed**.
- Is **sticky** to the top of the scroll region so the numbers ride along
  as the user scrolls the roster — they never disappear.
- Moves the rich detail (per-type cost breakdown, Top Earners via the
  existing `LaborCostBreakdown`, `LaborBudgetIndicator`) into a
  **collapsible "Details" disclosure**, **collapsed by default**.

Net effect: the grid starts ~230px higher (visible on load), and the
numbers are both always-present (sticky) and out of the way (collapsed).

### Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Details panel default | **Collapsed** | Grid maximally visible; one click for detail. |
| Details state persistence | **In-memory `useState`** (no localStorage) | Avoids the CLAUDE.md "no manual caching" rule; keeps it simple. |
| Hero header | **Folded into ribbon**, gradient header removed | Reclaims the most vertical space. |

## Sticky-positioning contract (the risky part)

Findings from the codebase that constrain the implementation:

- The app shell (`src/App.tsx` `LayoutSwitcher`) uses `min-h-screen`; the
  **window scrolls** — there is no nested `overflow-y-auto` scroller
  around `<main>`. So `position: sticky` resolves against the viewport.
- `AppHeader` is `sticky top-0 z-50`, height `h-14` (**56px**). To tuck
  the ribbon directly beneath it (not behind it), the ribbon is
  **`sticky top-14`** with **`z-30`** (below the header's `z-50`, above
  grid content).
- The ribbon needs an **opaque `bg-background`** and a bottom border so
  grid rows scrolling underneath don't show through.

### Lesson applied — L982-984 (mobile zoom-out regression on `/scheduling`)

A prior bug: an `sr-only` (`position:absolute`) element escaped the
`overflow-x-auto` schedule scroller because the scroller wasn't a
positioning context, blowing out `documentElement.scrollWidth` on mobile.
Relevance here:

- `position: sticky` **is** its own containing block, so the ribbon
  itself won't leak. Good.
- But I must **not** introduce any `position:absolute` decorative element
  (the current cards use `absolute` gradient corner blobs) inside a
  non-positioned overflow ancestor. The ribbon drops those blobs — flat
  surfaces per the Apple/Notion aesthetic — so no new abspos risk.
- Verify during Phase 5 UI review at 375px: `documentElement.scrollWidth`
  must equal `window.innerWidth` (no horizontal overflow), and the sticky
  offset must not overlap the app header.

## Component design

New file: `src/components/scheduling/ScheduleMetricsRibbon.tsx`

```tsx
interface ScheduleMetricsRibbonProps {
  activeEmployeeCount: number;
  totalScheduledHours: number;
  laborCostBreakdown: ScheduledLaborCostBreakdown; // { total, hourly:{cost,hours}, salary, contractor, daily_rate }
  laborCostSummary: LaborCostSummary;              // { total, averageHourlyRate, isAverageHigh, employeeCosts }
  laborBudgetData: LaborBudgetData;                // { hasBudget, tier, ... }
  shiftCount: number;
  scheduledEmployeeCount: number;
  isLoading: boolean;                            // employeesLoading || shiftsLoading
  onEditEmployee: (employeeId: string) => void;
}
```

Structure:

```
<div className="sticky top-14 z-30 -mx-4 px-4 bg-background/95 backdrop-blur
                border-b border-border/40">
  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
    {/* Title group: icon + "Staff schedule" + "{n} shifts · {n} staff" */}
    {/* Pills group: staff · hours · labor · avg rate  (flex, wraps on mobile) */}
    {/* Right: Details disclosure toggle button (chevron) */}
  </div>
  {detailsOpen && (
    <div className="pb-4 ...">  {/* cost breakdown grid + LaborCostBreakdown + LaborBudgetIndicator */}
  )}
</div>
```

- **Pills**: `h-7`, `rounded-full`, `bg-muted/40`, `text-[13px]`; number
  `font-medium text-foreground`, unit `text-muted-foreground`. A small
  Lucide icon (`Users`, `Clock`, `DollarSign`) leads each.
- **Warning state** (`laborCostSummary.isAverageHigh` OR budget tier
  `danger`/`warning`): the labor pill switches to `text-destructive` /
  `text-warning` and shows the `AlertTriangle` tooltip currently on the
  card. Uses semantic tokens only (per L70-71) — no raw colors.
- **Details toggle**: ghost button, `ChevronDown`/`ChevronUp`, label
  "Details" ↔ "Hide", `aria-expanded`, `aria-controls` the panel id.
- **Three-state rendering**: `isLoading` → skeleton pills; loaded → pills;
  the labor detail already handles its own empty (`employeeCosts.length`).
- The details panel reuses **existing** `LaborCostBreakdown` and
  `LaborBudgetIndicator` components unchanged.

### `Scheduling.tsx` change

- Delete lines ~726–987 (hero header block + three-card metrics row).
- Insert `<ScheduleMetricsRibbon {...} />` in their place, before the
  `<Tabs>`.
- The outer wrapper `space-y-6` stays; the ribbon is the first child.

## Accessibility

- Disclosure button: `aria-expanded`, `aria-controls`, visible label.
- Pills are non-interactive text; the warning `AlertTriangle` keeps its
  `aria-label` + tooltip.
- Icon-only controls get `aria-label`.
- Keyboard: the toggle is a real `<button>`, focusable and Enter/Space
  activatable.

## Testing

- **Unit** (`tests/unit/ScheduleMetricsRibbon.test.tsx`): renders pills
  with formatted values; toggle shows/hides the details panel and flips
  `aria-expanded`; warning state applies destructive styling + shows the
  alert when `isAverageHigh`; loading shows skeletons. (Component tests
  are optional per CLAUDE.md but valuable here for the toggle logic and
  to keep Sonar new-code coverage ≥80%.)
- If any pure formatting helper is extracted, it lives in a `.ts` file
  with its own unit test (per L840 — `.ts` under `src/components` is
  measured by Sonar).

## Out of scope

- No change to the data hooks or their queries.
- No change to the schedule grid, tabs, or other tab panels.
- No persistence of UI preference state.

## Decided trade-offs

- **Coverage vs Active**: the ribbon keeps both — "Active employees" as a
  pill (available to schedule) and "{n} staff" coverage in the title's
  secondary line (scheduled this week). They measure different things;
  collapsing them would lose information.
- **Sticky offset is a magic `top-14`** coupled to `AppHeader`'s `h-14`.
  Acceptable: both are app-shell constants; documented here and in a code
  comment so a future header-height change is traceable.
