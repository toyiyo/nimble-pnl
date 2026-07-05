# Hide Shift Templates — Design

**Date:** 2026-07-05
**Branch:** `feature/hide-shift-templates`
**Approved UX mockup:** https://claude.ai/code/artifact/21224a4a-5c0f-41a5-a104-32c5c96fbadb

## Problem

Managers who re-stagger their schedule create new shift templates and want to retire the
old ones. Today the planner row menu offers "Delete", which actually soft-archives
(`UPDATE shift_templates SET is_active = false` — `src/hooks/useShiftTemplates.ts:98-105`),
but the UI: (a) mislabels it as destructive, (b) offers no way to see or restore hidden
templates (`useShiftTemplates` hard-filters `.eq('is_active', true)`), and (c) leaves a
server-side hole — the latest `claim_open_shift`
(`supabase/migrations/20260626120000_open_shift_coverage.sql:343-346`) fetches the template
without an `is_active` guard, so an employee could claim into a hidden template.

Requirements from the user:
1. Hide templates from the planner without losing assigned schedules.
2. Be able to visualize hidden templates (and their schedules) on demand.
3. Labor numbers must not change when hiding.
4. With the "available shifts" feature enabled, hidden templates must not count toward
   (or be claimable as) open shifts.

## Approach (approved)

Give the existing `is_active` state a complete UX. No schema migration needed.

### Data layer — `useShiftTemplates`

- Add a status filter following the `useEmployees` convention:
  `useShiftTemplates(restaurantId, { status: 'active' | 'inactive' | 'all' } = { status: 'active' })`.
  Status is part of the query key. Default stays `'active'` so every existing consumer
  (Scheduling.tsx open-shift count, coverage, AI scheduler context, etc.) is unchanged.
- Rename the `deleteTemplate` mutation to `hideTemplate` (same `is_active: false` update).
- Add `restoreTemplate` (`is_active: true` update).
- Toasts:
  - Hide: title `“<name>” hidden`, description `N assigned shift(s) kept` (or
    `Assigned shifts are kept` when the visible week has none), with an **Undo**
    `ToastAction` that calls `restoreTemplate`.
  - Restore: title `Template restored`.
  - The kept-shift count for the current week is computed by the caller
    (ShiftPlannerTab has `gridData`) and passed to `hideTemplate({ id, name, keptShiftCount })`.

### Planner container — `ShiftPlannerTab`

- Fetch templates with `status: 'all'` and derive:
  - `activeTemplates = templates.filter(t => t.is_active)` — used for **all math**:
    coverage strip, `coverageByTemplateDay`, allocation, open-shift affordances.
  - `hiddenTemplates = templates.filter(t => !t.is_active)` — drives the toggle badge count.
  - `displayTemplates = showHidden ? templates : activeTemplates` — drives grid rows.
- `const [showHidden, setShowHidden] = useState(false)` — a **view filter**, session-scoped,
  never persisted, never mutates data.
- Build the grid with **all** templates (`buildTemplateGridData(shifts, templates, weekDays)`),
  so shifts keep bucketing under their hidden template (explicit `shift_template_id` first,
  legacy time-match fallback — both already work when the template is in the list). Derive:
  - `showHidden === true` → pass the grid as-is; hidden rows render their own shifts.
  - `showHidden === false` → merge every hidden-template bucket into one
    `hiddenLaneByDay: Map<day, Shift[]>` and pass the active rows only.
- New pure helper in `useShiftPlanner.ts` (exported, unit-tested):
  `collectHiddenLane(grid, hiddenTemplates, areaFilter)` → merges hidden-template buckets,
  honoring `areaFilter` (hidden template's `area` must match — same `t.area || UNASSIGNED`
  nullish convention as `groupTemplatesByArea`; see 2026-06 off-template lane lesson).

### Toolbar toggle — "Hidden (n)"

- Pill button in the planner toolbar (next to the existing controls), rendered **only when
  `hiddenTemplates.length > 0`**: `EyeOff` icon + `Hidden` + count badge.
- `aria-pressed` reflects state; pressed style `bg-foreground text-background` (CLAUDE.md
  primary), unpressed ghost style. Keyboard accessible (it's a `<Button>`).

### Row menu — `TemplateRowHeader`

- Active template: `Edit` / **`Hide template`** (`EyeOff` icon, `text-muted-foreground`,
  with a right-aligned `keeps shifts` hint in `text-[11px] text-muted-foreground`).
  The `Trash2` "Delete" item is **removed** — hide is the only retire action (approved
  decision: no permanent delete).
- Hidden template (ghost row): `Edit` / **`Restore template`** (`Eye` icon).
- Hidden row header also shows a `Hidden` badge: `text-[10px] uppercase tracking-wider
  border border-dashed border-border rounded-md px-1.5` with inline `EyeOff` glyph
  (desktop; mobile shows the badge dot only — mobile header is 56px).
- `memo` comparison must add `prev.template.is_active === next.template.is_active`
  (updated_at changes on hide, but Undo/restore round-trips can race the timestamp).

### Ghost rows — `TemplateGrid` + `ShiftCell`

- A row whose `template.is_active === false` renders ghosted: wrapper `opacity-60` +
  `bg-muted/20` (subtle wash; no hatching — keep Tailwind semantic tokens only).
- Ghost cells are **read-only**: no drag/drop assignment, no mobile tap-to-assign, no
  open-slot affordances, no coverage indicator (`coverage` is only computed for active
  templates anyway). Pass `isHiddenTemplate` down to `ShiftCell`; chips render dimmed.
- Sorting: hidden rows sort after active rows within their area group so ghosts sink to
  the bottom of each section (`groupTemplatesByArea` input ordering: active first).

### "From hidden templates" lane

- Rendered at the bottom of the grid (after all area groups), only when
  `showHidden === false` **and** the lane has shifts this week.
- Visual: same lane pattern as `OffTemplateRow`, label `From hidden templates` with
  `EyeOff` icon, subtitle `N shift(s) kept · Show templates` where "Show templates" is a
  button that sets `showHidden = true`. Chips render in the ghost (dimmed) treatment.
- New component `HiddenTemplatesRow.tsx` (sibling of `OffTemplateRow.tsx`, same grid
  column contract). Shift chips keep their remove action (they are real shifts).
- The `__unmatched__` off-template lane behavior is unchanged — shifts linked to hidden
  templates no longer land there because the grid is built with all templates.

### Numbers (invariants, not changes)

- **Labor cost & hours:** computed from assigned `shifts` (`useScheduledLaborCosts`,
  `computeTotalHours`) — untouched by this feature. Unit test pins that
  `computeTotalHours` output is identical whether or not a template is hidden.
- **Open-shift count (client):** `computeOpenShiftCount` (Scheduling.tsx:329) and the
  planner coverage strip must receive **active templates only**. Scheduling.tsx already
  does (default hook status `'active'`); ShiftPlannerTab must keep passing
  `activeTemplates` to all coverage/count math after switching its fetch to `'all'`.
  Unit test pins exclusion.
- **Open-shift count (SQL):** `get_open_shifts` already filters `st.is_active = true`
  (both 20260412145842 and 20260626120000 versions). No change; pgTAP test pins it.

### SQL — close the claim hole

New migration `2026xxxx_claim_open_shift_active_guard.sql`:
- Recreate `claim_open_shift` **from the latest version in
  `20260626120000_open_shift_coverage.sql`** (per the 2026-05-01 "diff, don't believe"
  lesson: copy the current definition, change only the guard), adding
  `AND is_active = true` to the template fetch. Error message:
  `'This shift is no longer available'` (distinct from `'Template not found'` so support
  can tell the cases apart; both return `success: false`).
- pgTAP test (`supabase/tests/`): hidden template ⇒ (a) `get_open_shifts` excludes its
  slots, (b) `claim_open_shift` returns the new error, (c) restoring flips both back.
  Dates computed from `CURRENT_DATE` (2026-04-21 lesson — no hardcoded dates).

## Alternatives considered

- **`archived_at` timestamp column** (employees-style audit trail): richer, but requires a
  migration + codegen churn for a "hidden on <date>" caption the user didn't ask for.
  Deferred; `is_active` boolean is already the partial-index boundary
  (`uq_shift_templates_active_slot ... WHERE is_active = true`), which is exactly what
  enables the re-stagger workflow (hide old slot, create overlapping new slots).
- **Permanent delete for templates with no linked shifts:** rejected (approved decision) —
  hide covers every case; keeping one retire verb keeps the menu simple and reversible.
- **Persisting `showHidden`:** rejected — CLAUDE.md forbids manual caching; it's a
  transient lens, default-off is the correct reset.

## Test plan

| Layer | Test |
|---|---|
| Unit (hooks/lib) | `useShiftTemplates` status filter → query built with/without `.eq('is_active', true)`; `hideTemplate`/`restoreTemplate` payloads; toast-with-undo contract |
| Unit (pure) | `collectHiddenLane` merge + areaFilter + UNASSIGNED convention; grid derivation active vs all; `computeTotalHours` invariant under hiding; `computeOpenShiftCount` excludes non-active templates when caller filters |
| Component-adjacent unit | TemplateRowHeader menu items per `is_active`; memo comparator includes `is_active` |
| pgTAP | claim guard + get_open_shifts exclusion + restore round-trip (CURRENT_DATE-relative) |

## Decided trade-offs

- Labor-cost caption ("incl. shifts from hidden templates") from the mockup toolbar is
  represented in-product by the lane subtitle (`N shift(s) kept`) — the Scheduling header
  card is shared across tabs and out of this feature's scope.
- Editing a hidden template is allowed (harmless; matches mockup menu).
