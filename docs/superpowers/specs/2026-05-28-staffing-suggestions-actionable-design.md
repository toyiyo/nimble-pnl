# Design: Make Staffing Suggestions Actionable + Fix the Dead-Ends

**Date:** 2026-05-28
**Status:** Approved (design phase) — revised after Phase 2.5 design review
**Branch:** `feature/staffing-suggestions-actionable`
**Area:** Scheduling → Planner tab → Staffing Suggestions

## Problem

Staffing Suggestions (the collapsible card on the Planner tab) "rarely gets used
and leaves more questions than answers." A four-angle code investigation traced
this to **one root cause and three dead-ends**:

- **Root cause — it's a report, not a workflow step.** `useStaffingSuggestions`
  already computes consolidated `shiftBlocks` (e.g. "4 staff Fri 5–10pm"), but the
  UI never renders them. After reading a recommendation, the manager has nowhere to
  click; the shift grid directly below is unlinked.
- **No-data dead-end** — with no POS data every column shows "No data" with no
  explanation, no "connect your POS" CTA, and the "How it works" explainer is
  hidden *exactly when there's no data*.
- **Discovery dead-end** — collapsed by default, no first-run hint.
- **Clarity dead-ends** — two save mechanics with no feedback; chart has no
  staff-count axis label; legend hidden on mobile.

## Goal

Two halves: **(A)** close the dead-ends so the feature explains itself, and
**(B)** make it actionable so suggestions become schedulable shift templates /
open shifts on the schedule.

## Key Decisions (locked during brainstorm)

1. **Direction:** Actionable + fix dead-ends (largest scope).
2. **Apply behavior:** Apply creates **open (unassigned) shifts** matching the
   recommended blocks — distinct from "Generate with AI" (which auto-assigns
   people), and reversible.
3. **Open-shift representation:** The `shifts` table requires a non-null
   `employee_id`; "open shifts" are unclaimed **`shift_templates`** surfaced via
   the `get_open_shifts` RPC and rendered in the Planner template grid. Apply
   creates `shift_templates` rows.
4. **Position mapping:** distribute the recommended headcount across the manager's
   **Minimum Crew** positions (proportional); if no Minimum Crew, create generic
   `"Staff"` shifts and show a non-blocking nudge.

## ⚠️ Corrections from Phase 2.5 design review

These overturned original assumptions and are now baked into the design:

- **`shift_templates` uses `days INTEGER[]`, not `day_of_week INTEGER`** (migration
  `20260301044927`). Insert shape per row:
  `{ restaurant_id, name, days: [dayInt], start_time, end_time, break_duration, position, capacity, is_active: true }`.
  `valid_days` constraint requires each element ∈ 0–6.
- **`name TEXT NOT NULL`** must be supplied. Convention:
  `"Suggested · {position} {start}-{end}"`.
- **`capacity` must equal the per-position headcount** from `distributePositions`,
  not the default of 1 — `get_open_shifts` filters out `capacity <= 1`, and the
  slot count derives from `capacity`.
- **Open shifts only surface when** `staffing_settings.open_shifts_enabled = true`
  **and** a published schedule covers the week. The created templates appear in the
  **Planner template grid immediately** regardless (that is the primary win);
  claimable-open-shift visibility is the secondary, gated path. The Apply dialog
  shows a non-blocking note when `open_shifts_enabled` is false explaining the
  templates were created but won't be claimable until open shifts are enabled.
- **Idempotency is enforced in the DB, not the client** (see Migration below).
- **No `localStorage`** (CLAUDE.md no-manual-caching). Discovery is solved by
  defaulting the card to **expanded** when sales data exists; no cross-session
  persistence.

## Migration (now in scope)

`supabase/migrations/<ts>_shift_templates_idempotent_apply.sql`:

- Partial unique index:
  `CREATE UNIQUE INDEX ... ON shift_templates (restaurant_id, start_time, end_time, position) WHERE is_active = true;`
  (`restaurant_id` first for multi-tenant selectivity.)
- Apply uses `INSERT … ON CONFLICT DO NOTHING` so re-applying is safe under
  concurrent sessions. Verify the partial-index predicate matches the conflict
  target requirements (may need a constraint, not just an index, for `ON CONFLICT`;
  if so, use a unique constraint or `ON CONFLICT (cols) WHERE ...` matching the
  partial index).
- pgTAP test asserts: duplicate apply is a no-op; distinct blocks insert; the
  `days`/`capacity`/`name` columns accept the produced shape.

## Architecture

### A. Dead-end fixes — `StaffingOverlay.tsx`, `StaffingConfigPanel.tsx`

1. **No-data empty state** (`hasSalesData === false`): explicit message + a real
   anchor CTA to the POS integrations route `/integrations`
   (router `<Link to="/integrations">Connect your POS</Link>` — keyboard-reachable,
   descriptive label). **Always render the "How it works" explainer** —
   unconditionally, immediately below the `CollapsibleTrigger` header; only the
   day-column grid and summary row stay data-gated.
2. **Error state:** **Retry** button (refetch) + POS-settings link.
3. **Discovery:** default the card to **expanded** when sales data exists (no
   `localStorage`).
4. **Save clarity:** "Save as Default" is enabled **iff `localSettings !== null`**
   (at least one numeric/crew change pending; immediately-saved toggles excluded);
   helper text — "Toggles save automatically; numeric settings save here."
5. **Chart readability:** add a staff-count axis label; render the legend on mobile
   **inside/adjacent to the scrollable chart container** (not `hidden md:flex`,
   not detached from the bars).

### B. Actionability — the root-cause fix

6. **Render `shiftBlocks`** as a `SuggestedShifts` component (grouped by day) with
   explicit **three states**: loading inherits the parent skeleton; error inherits
   the parent error; **empty** (`blocks.length === 0` but `hasSalesData`) shows
   "No consolidated shifts to suggest this week — try adjusting your target SPLH."
7. **"Apply suggested shifts"** opens `ApplyShiftsDialog` (single instance at
   overlay level): preview list (day · time · position · count), per-block
   checkbox each with `aria-label` like "Include Friday 5–10 PM, 4 Staff", a
   non-blocking nudge banner when no Minimum Crew set, and the open-shifts-disabled
   note when applicable. Confirm/Cancel in a `DialogFooter`.
8. **Confirm** → `useApplySuggestedShifts` upserts `shift_templates`; invalidate
   `['shift_templates', restaurantId]`, `['open_shifts', restaurantId]`,
   `['shifts', restaurantId]` (exact key shape mirrors `useShiftTemplates`).
   Post-confirm toast names the result: "4 open shifts created · 2 already existed
   and were skipped."

### Accessibility contract (ApplyShiftsDialog)

- A `DialogTitle` is always present (visually hidden if needed).
- All interactive content lives inside `DialogContent`; dialog toggled via the
  `open` prop (not mount/unmount), so Radix focus-trap + return-focus to the
  "Apply suggested shifts" trigger both hold.
- Body is `overflow-y-auto` with a sticky `DialogFooter`; verified at 375×667 so
  Confirm is reachable. `max-h-[80vh]` per CLAUDE.md.
- `HelpCircle` tooltip triggers get `aria-label` (e.g. "Help for Sales per Labor
  Hour").

## New Units (small, isolated, testable)

| Unit | Type | Responsibility |
|---|---|---|
| `distributePositions(headcount, minCrew)` | pure fn | proportional split across Minimum Crew → `[{position, count}]`; rounding: ceil the largest remainder until the sum matches headcount (no lost heads); fallback `[{position:'Staff', count: headcount}]` |
| `shiftBlocksToTemplates(blocks, minCrew, restaurantId)` | pure fn | → template insert rows with `days:[n]`, `name`, `capacity`, `start_time`/`end_time` in **restaurant-local** time, `position`, `break_duration`, `is_active:true` |
| `useApplySuggestedShifts()` | hook | upsert (`ON CONFLICT DO NOTHING`) in chunks; explicit field select (no `*`); invalidates the three exact keys; returns `{created, skipped}` for the toast |
| `SuggestedShifts` | component | renders `shiftBlocks` grouped by day (three states) + Apply trigger |
| `ApplyShiftsDialog` | component | preview + per-block checkbox + nudge/notes + confirm |

## Data Flow

```
useStaffingSuggestions ─► recommendations (hourly bars, already rendered)
                       └► shiftBlocks ─► SuggestedShifts (NEW) ─► ApplyShiftsDialog
                                                                      │ confirm
                              shiftBlocksToTemplates(blocks, minCrew)  ▼
                              useApplySuggestedShifts() ─► upsert shift_templates
                                                                      │ invalidate
                              Planner template grid (immediate)  ◄────┤
                              get_open_shifts (if enabled+published) ◄─┘
```

## Error Handling

- Idempotency enforced by the DB unique index + `ON CONFLICT DO NOTHING`; the hook
  reports created-vs-skipped counts in the success toast.
- Apply mutation error → destructive toast (mirrors `useBulkCreateShifts`).
- No-data / error / empty states are all explicit — no silent empties.

## Timezone

`start_time`/`end_time` are `TIME` (no tz). The values must be **restaurant-local**,
derived from `shiftBlocks` (which are keyed to the restaurant timezone). A plan
task verifies `useStaffingSuggestions` produces restaurant-local times (not browser
-local / UTC) before they are written.

## Testing (per CLAUDE.md)

- **Unit (`tests/unit/`):** `distributePositions` (proportional, rounding sums to
  headcount, `headcount < positions`, empty-crew fallback, zero headcount);
  `shiftBlocksToTemplates` (days array, name, capacity, tz); `useApplySuggestedShifts`
  (chunking, conflict skip, invalidation keys, error path; mocked supabase).
- **DB (pgTAP):** the new partial unique index — duplicate apply is a no-op,
  distinct blocks insert.
- **E2E (Playwright):** no-data empty state → suggested shifts render with seeded
  sales → Apply → preview dialog (focus trap, checkbox labels) → confirm → templates
  appear in the planner grid. Accessible selectors.
- **Phase 5 UI review:** Apple/Notion, a11y, three-state rendering.

## Decided Trade-offs / Out of Scope (separate follow-ups)

- **Security (flagged separately):** `get_open_shifts` is `SECURITY DEFINER` with
  no per-caller restaurant membership check — an RLS-bypass that lets any
  authenticated user enumerate any restaurant's open shifts. Pre-existing; tracked
  as its own task (not this PR).
- Two divergent staffing-requirement systems (client SPLH overlay vs. edge-function
  solver); `generate-schedule` ignoring `lookback_weeks`/`target_labor_pct`;
  `manual_projections` stored-but-unused; `staffing_settings` missing from generated
  Supabase types (`as any`). Each its own ticket.
