# Design: Make Staffing Suggestions Actionable + Fix the Dead-Ends

**Date:** 2026-05-28
**Status:** Approved (design phase)
**Branch:** `feature/staffing-suggestions-actionable`
**Area:** Scheduling → Planner tab → Staffing Suggestions

## Problem

Staffing Suggestions (the collapsible card on the Planner tab) "rarely gets used
and leaves more questions than answers." A four-angle code investigation traced
this to **one root cause and three dead-ends**:

- **Root cause — it's a report, not a workflow step.** `useStaffingSuggestions`
  already computes consolidated `shiftBlocks` (e.g. "4 staff Fri 5–10pm"), but the
  UI never renders them. After reading a recommendation, the manager has nowhere to
  click; the shift grid directly below is unlinked. So they look once, get no
  action, and stop returning.
- **No-data dead-end** — with no POS data every column shows "No data" with no
  explanation, no "connect your POS" CTA, and the "How it works" explainer is
  hidden *exactly when there's no data* (the users who most need it).
- **Discovery dead-end** — collapsed by default, no first-run hint, re-collapses
  every visit.
- **Clarity dead-ends** — two save mechanics (button vs. silent auto-save) with no
  feedback; chart has no staff-count axis label; legend hidden on mobile.

## Goal

Two halves: **(A)** close the dead-ends so the feature explains itself, and
**(B)** make it actionable so suggestions become open shifts on the schedule.

Touches `src/` only and **reuses the existing `shift_templates` table** — no
migration expected.

## Key Decisions (locked during brainstorm)

1. **Direction:** Actionable + fix dead-ends (largest scope).
2. **Apply behavior:** Apply creates **open (unassigned) shifts** matching the
   recommended blocks — distinct from the existing "Generate with AI" button
   (which auto-assigns people), and reversible (just delete the shifts).
3. **Open-shift representation:** In this codebase the `shifts` table requires a
   non-null `employee_id`; "open shifts" are unclaimed **`shift_templates`**
   surfaced via the `get_open_shifts` RPC. So Apply creates `shift_templates`
   rows, which flow through the existing open-shift/claim infrastructure (the same
   one the panel's own open-shift toggles already control).
4. **Position mapping:** `shift_templates.position` is `NOT NULL`, but the chart's
   headcount is aggregated across positions. Apply distributes the recommended
   headcount across the manager's configured **Minimum Crew** positions
   (proportional to their weights); if no Minimum Crew is set, it creates generic
   `"Staff"` open shifts and nudges the manager to define a crew.

## Architecture

### A. Dead-end fixes — `StaffingOverlay.tsx`, `StaffingConfigPanel.tsx`

1. **No-data empty state:** when `hasSalesData` is false, render an explicit state
   — "Staffing suggestions need sales history. Connect your POS or enter sales to
   see recommendations." — with a CTA link to POS settings. **Always render the
   "How it works" explainer** (move it out of the data-gated branch).
2. **Error state:** add a **Retry** button (refetch) and a POS-settings link.
3. **Discovery:** persist expand/collapse in `localStorage` keyed by
   `restaurant_id`; default **expanded on first visit**.
4. **Save clarity:** disable "Save as Default" when nothing is pending; helper
   text — "Toggles save automatically; numeric settings save here."
5. **Chart readability:** add a staff-count axis label; show the legend on mobile
   (currently `hidden md:flex`).

### B. Actionability — the root-cause fix

6. **Render `shiftBlocks`** (computed today, never shown) as a "Suggested shifts"
   list grouped by day.
7. **"Apply suggested shifts"** opens a preview dialog (`ApplyShiftsDialog`)
   listing the open shifts to be created (day · time · position · count); the
   manager can uncheck any block, then confirm.
8. **Confirm creates `shift_templates`** via a new `useApplySuggestedShifts`
   mutation; invalidate `['shift_templates','open_shifts','shifts']` so the grid
   updates immediately — finally linking suggestions → schedule.

## New Units (small, isolated, testable)

| Unit | Type | Responsibility |
|---|---|---|
| `distributePositions(headcount, minCrew)` | pure fn | → `[{position, count}]` proportional split across Minimum Crew; fallback `[{position:'Staff', count: headcount}]` |
| `shiftBlocksToTemplates(blocks, minCrew, weekContext)` | pure fn | map consolidated `shiftBlocks` → `shift_templates` insert rows (day_of_week, start/end TIME, position, break) |
| `useApplySuggestedShifts()` | hook | mutation mirroring `useBulkCreateShifts` — chunked insert, query invalidation, idempotency guard |
| `SuggestedShifts` | component | renders `shiftBlocks` grouped by day + the Apply button |
| `ApplyShiftsDialog` | component | preview + per-block toggle + confirm |

## Data Flow

```
useStaffingSuggestions  ──►  recommendations (hourly bars, already rendered)
                        └─►  shiftBlocks (consolidated)  ──►  SuggestedShifts (NEW render)
                                                                   │  Apply
                                                                   ▼
                              shiftBlocksToTemplates(blocks, minCrew)  ──►  ApplyShiftsDialog (preview)
                                                                   │  confirm
                                                                   ▼
                              useApplySuggestedShifts()  ──►  insert shift_templates
                                                                   │  invalidate
                                                                   ▼
                              get_open_shifts / planner grid reflects new open shifts
```

## Error Handling

- **Apply mutation:** toast on error (mirrors `useBulkCreateShifts`).
- **Idempotency guard:** skip blocks whose matching `shift_templates` row already
  exists (same day_of_week + start/end + position); warn rather than duplicate, so
  re-applying is safe.
- **No-data / error:** explicit states — no silent empties.

## Testing (per CLAUDE.md)

- **Unit (`tests/unit/`):**
  - `distributePositions` — proportional split, rounding, `headcount < positions`,
    empty-crew fallback, zero headcount.
  - `shiftBlocksToTemplates` — correct day/time/position mapping.
  - `useApplySuggestedShifts` — chunking, invalidation, error path (mocked supabase).
- **E2E (Playwright):** no-data empty state → suggested shifts render with seeded
  sales → Apply → preview dialog → confirm → open shifts appear on the grid.
  Accessible selectors (`getByRole`/`getByLabel`).
- **Phase 5 UI review:** Apple/Notion compliance, a11y (aria, focus, keyboard),
  three-state rendering.

## Decided Trade-offs / Out of Scope (follow-ups, not this PR)

These surfaced during investigation but are **backend/algorithm** concerns, not a
UI/UX fix:

- Two divergent staffing-requirement systems (client SPLH overlay vs. edge-function
  template-capacity solver) compute headcount differently and don't reference each
  other.
- `generate-schedule` hardcodes a 4-week lookback, ignoring
  `staffing_settings.lookback_weeks`; the solver's target labor % (30%) differs
  from `target_labor_pct` (22%).
- `manual_projections` is stored on `staffing_settings` but read by nothing.
- `staffing_settings` is missing from the generated Supabase types (`as any` cast).

Each is worth a separate ticket; bundling them here would balloon scope and mix
UI work with data-model changes.
