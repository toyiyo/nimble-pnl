# Plan: Schedule overview panel pairing

Design: `docs/superpowers/specs/2026-06-20-schedule-overview-panel-design.md`
Branch: `feature/schedule-overview-panel`

Scope is one component + one test. TDD: write the failing test first, then the
implementation, then verify.

## Task 1 (RED) — Failing component test

**File:** `tests/unit/ScheduleOverviewPanel.test.tsx` (new)

Setup: vitest + `@testing-library/react` (jsdom). The component is pure-props
(no hooks/context) so render it directly — no `QueryClientProvider` needed.

Fixtures: build `OverviewDay[]` of 7 days, 5 staffed + 2 `unstaffed: true`.
Minimal valid `OverviewDay`: `{ day, pills: [], collapsedCount: 0, hasGap:
false, gapLabel: null, unstaffed }`. `coverageByDay` can be an empty `Map`.
Props: `isMobile={false}`.

Stable markers (no brittle text/SVG assertions, per the role-assertion lesson):
- Trigger state → `screen.getByRole('button', { expanded })`.
- Day-card presence → `container.querySelectorAll('[data-overview-day]')`
  (`OverviewDayCard` sets `data-overview-day` on its root; `CollapsibleContent`
  unmounts when closed, so count is 0 collapsed / 7 expanded).

Assertions:
1. **Collapsed by default:** `getByRole('button', { expanded: false })` exists;
   `querySelectorAll('[data-overview-day]')` length is 0; teaser
   `5/7 days staffed` is visible (`getByText(/5\/7 days staffed/)`).
2. **Expand reveals cards:** `fireEvent.click(trigger)` →
   `getByRole('button', { expanded: true })`; `[data-overview-day]` length is 7;
   teaser text is no longer present (`queryByText(/days staffed/)` is null).
3. **Collapse hides again:** click → expanded false → `[data-overview-day]`
   length 0; teaser visible again.
4. **Rollup math:** with 5 of 7 `unstaffed: false`, teaser reads
   `5/7 days staffed`.

These fail against the current file (expanded by default; teaser always shown;
no `expanded:false` initial state).

**Verify RED:** `npx vitest run tests/unit/ScheduleOverviewPanel.test.tsx`
shows failures. Commit: `test(scheduling): schedule overview collapse + teaser (RED)`.

## Task 2 (GREEN) — Implement panel

**File:** `src/components/scheduling/ShiftPlanner/ScheduleOverviewPanel.tsx`

Per the design doc. Key points:
- `useState(false)` (collapsed by default); drop `useId`.
- Imports: `CalendarRange, ChevronDown` from `lucide-react`;
  `Collapsible, CollapsibleContent, CollapsibleTrigger` from
  `@/components/ui/collapsible`.
- Structure: `<Collapsible open onOpenChange>` → `<section
  aria-label="Weekly schedule overview" className="rounded-xl border
  border-border/40 bg-background overflow-hidden">` → `<CollapsibleTrigger
  asChild><button …></CollapsibleTrigger>` + `<CollapsibleContent>`.
- Trigger button: `w-full flex items-center justify-between px-4 py-2.5
  hover:bg-muted/30 transition-colors`. **No `aria-label`** (visible text is
  the accessible name; Radix adds `aria-expanded`/`aria-controls`).
- Left cluster: chip `h-7 w-7 rounded-lg bg-muted flex items-center
  justify-center` containing `<CalendarRange className="h-3.5 w-3.5
  text-foreground" />`; title `<span className="text-[14px] font-medium
  text-foreground">Schedule overview</span>`; teaser, only when collapsed:
  `{!isExpanded && overviewDays.length > 0 && <span className="text-[12px]
  text-muted-foreground ml-2">{staffedCount}/{overviewDays.length} days
  staffed</span>}`.
- Right: `<ChevronDown className="h-4 w-4 text-muted-foreground
  transition-transform {isExpanded ? 'rotate-180' : ''}" />`.
- `CollapsibleContent` wraps the day grid: `cn('p-3', isMobile ? 'flex
  flex-col gap-2' : 'grid grid-cols-7 gap-2')` mapping `overviewDays` →
  `OverviewDayCard` (unchanged props).
- Keep `memo`, `staffedCount = overviewDays.filter(d => !d.unstaffed).length`,
  and the `shortLabel` helper.

**Verify GREEN:** the test file passes. Commit:
`feat(scheduling): schedule overview panel — collapsed default + CalendarRange chip (GREEN)`.

## Task 3 (VERIFY) — typecheck, lint, test

- `npx tsc --noEmit` (no new errors in the two files).
- `npx eslint <both files>` clean.
- `npx vitest run tests/unit/ScheduleOverviewPanel.test.tsx` green.
- No edits expected in `ShiftPlannerTab.tsx` (props unchanged) — confirm it
  still typechecks.

## Then: Phases 5–9 (autonomous via dev-build-and-ship)

UI review → simplify → multi-model review (frontend/a11y dimensions matter
most here) → CodeRabbit → full verify (`test`, `test:db`, `test:e2e`,
`typecheck`, `lint`, `build`) → push → PR → CI loop → comment triage.

## Dependencies
Task 1 → Task 2 → Task 3 (strictly linear; single file + its test).
