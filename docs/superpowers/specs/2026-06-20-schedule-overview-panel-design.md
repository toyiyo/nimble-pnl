# Design: Schedule overview / Staffing Suggestions panel pairing

- **Date:** 2026-06-20
- **Branch:** `feature/schedule-overview-panel`
- **Surface:** Shift Planner (`src/components/scheduling/ShiftPlanner/`)
- **Status:** Approved (design explored and signed off interactively before `/dev`)

## Problem

The Shift Planner stacks two collapsible panels above the template grid:

1. **Staffing Suggestions** (`StaffingOverlay.tsx`) — the primary, actionable
   AI insight. Already has the canonical header treatment: a blue `Users`
   icon chip, `text-[14px] font-medium` title, a collapsed-state teaser, a
   right-aligned rotating `ChevronDown`, built on the shadcn `Collapsible`
   primitives. Expanded by default.
2. **Schedule overview** (`ScheduleOverviewPanel.tsx`) — a weekly mini-Gantt
   of per-day coverage. Today it is visually inconsistent with its sibling:
   no icon chip, a hand-rolled button/`hidden`-div collapse, a different
   title size (`text-[13px] font-semibold`), a left-side chevron that swaps
   `ChevronDown`/`ChevronRight`, and a different surface (`bg-muted/30`).
   Expanded by default.

The two read as different component types even though they are peers, and the
overview — secondary reference data — competes for attention with the primary
suggestions panel.

## Goals

1. Make **Schedule overview collapsed by default**.
2. Give it an **icon chip** matching the sibling, and pick the right icon.
3. Bring its header into a **matched pair** with Staffing Suggestions.

Non-goal: changing `StaffingOverlay.tsx` (it is the canonical reference) or
changing any data/props.

## Approved decisions

### Icon: `CalendarRange` (lucide)

The panel is a weekly mini-Gantt of coverage spans across 7 days.
`CalendarRange` — a calendar with a horizontal range bar — visually echoes
those coverage bars and the week-as-a-span concept, and pairs conceptually
with the sibling's `Users`: **who** (Users) + **when, across the week**
(CalendarRange).

Alternatives considered and rejected:
- `CalendarDays` — generic "calendar," not tied to the panel's content.
- `CalendarClock` — reads as time-of-day, not a week.
- `LayoutGrid` — a grid, but says nothing about scheduling/time.

### Treatment: neutral monochrome chip

`bg-muted` box (`h-7 w-7 rounded-lg`) + `CalendarRange` at
`h-3.5 w-3.5 text-foreground` — deliberately **not** the sibling's blue.

This encodes hierarchy: Staffing Suggestions is the primary actionable insight
(blue chip, expanded by default); Schedule overview is secondary reference
data (neutral chip, collapsed by default). Full-contrast `text-foreground`
(not `text-muted-foreground`) keeps the icon reading as intentional rather
than disabled. Uses semantic tokens only (per CLAUDE.md and the
`text-yellow-500` lesson) — no literal palette colors are introduced.

### Header parity

Mirror `StaffingOverlay`'s header exactly:
- Migrate to the shared shadcn `Collapsible` / `CollapsibleTrigger` /
  `CollapsibleContent` primitives (drops the hand-rolled `useId` +
  `hidden`-class toggle, so the two panels share one collapse mechanism).
- Title: `text-[14px] font-medium text-foreground`.
- Surface: `bg-background` (was `bg-muted/30`).
- Trigger row: `w-full flex items-center justify-between px-4 py-2.5
  hover:bg-muted/30 transition-colors`.
- Right-aligned single `ChevronDown` that rotates 180° when expanded.
- Inline teaser `N/M days staffed` shown **only when collapsed** (matches the
  sibling, where the teaser is redundant once expanded). Since the panel
  defaults collapsed, the rollup is visible by default.

## Accessibility

- Keep the `<section aria-label="Weekly schedule overview">` landmark. The
  `rounded-xl border bg-background` classes live on this `<section>` (which
  sits inside the Radix `Collapsible` root `<div>`); the Radix wrapper is
  unstyled, so there is no duplicated border/box.
- **`CollapsibleTrigger` MUST use `asChild`** with a single `<button>` child
  (exactly as `StaffingOverlay` does at lines 278–279). This makes Radix
  inject `aria-expanded` + `aria-controls` onto the `<button>` directly and
  avoids a nested-`<button>` violation that would silently drop the ARIA
  wiring. (Phase 2.5 major finding.)
- **No `aria-label` on the trigger.** The visible "Schedule overview" text is
  the accessible name, and Radix supplies `aria-expanded` for state. This is
  the WAI-ARIA disclosure pattern and matches the *current* file's approach
  (visible-text-as-name + `aria-expanded`, no `aria-label`). It is a
  deliberate, small improvement over the sibling, whose
  `aria-label={isExpanded ? 'Collapse…' : 'Expand…'}` overrides its visible
  title+teaser — so screen-reader users there never hear the teaser. By
  dropping the `aria-label`, the collapsed "N/M days staffed" teaser becomes
  part of the button's accessible name and IS announced. (Phase 2.5 major
  finding.)
- Trigger is a real `<button>` → keyboard accessible.
- Decorative icons (`CalendarRange`, `ChevronDown`) are bare lucide `<svg>`
  with no role/text, so they do not pollute the accessible name.

## Scope / blast radius

- **One file:** `src/components/scheduling/ShiftPlanner/ScheduleOverviewPanel.tsx`.
- Props (`overviewDays`, `coverageByDay`, `isMobile`) are unchanged; the only
  consumer is `ShiftPlannerTab.tsx`, which needs no edits.
- `OverviewDayCard` and `usePlannerShiftsIndex` are untouched.

## Testing

New component test `tests/unit/ScheduleOverviewPanel.test.tsx`:
- Renders **collapsed by default**: day cards are not shown; the
  `N/M days staffed` teaser is visible.
- Expanding via the trigger reveals the day cards; collapsing hides them
  and restores the teaser.
- Assert on **accessibility role / `aria-expanded`**, not on raw text
  (per the role-assertion lesson), plus the staffed-count rollup math.

## Decided trade-offs

- **Radix `CollapsibleContent` unmounts when closed.** Because the panel
  defaults collapsed, the 7 `OverviewDayCard`s do not mount until first
  expand. This is a minor perf win and matches the sibling's behavior; the
  cards are pure presentational, so there is no effect/state to preserve.
- **Teaser hidden when expanded.** The `N/M days staffed` rollup disappears
  on expand (the day cards convey per-day status). Chosen for strict parity
  with the sibling rather than keeping a persistent right-side stat.
- **Hover at `hover:bg-muted/30`,** matching the sibling — do NOT carry over
  the current file's heavier `hover:bg-muted/50`.

## Retrospective notes (carry to Phase 10)

- `StaffingOverlay` uses literal palette colors on its icon
  (`text-blue-600 dark:text-blue-400`), a minor CLAUDE.md "no direct colors"
  deviation. The new panel deliberately does NOT replicate it (uses
  `text-foreground`). Aligning the sibling is out of scope here.
- `StaffingOverlay`'s trigger `aria-label` overrides its visible
  title+teaser; the new panel's no-`aria-label` approach is more correct.
  Candidate for a future sibling cleanup.
