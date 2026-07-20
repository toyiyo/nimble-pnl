# Design: Impact-Aware Deletion (Shift Templates + Availability)

**Date:** 2026-07-20
**Branch:** `feature/impact-aware-deletion`
**Status:** Approved design (visual mockup signed off by product)
**Mockup:** Artifact "Impact-Aware Deletion — EasyShiftHQ" (4 interactive scenarios)

## Problem

Managers cannot hard-delete shift templates or employee availability today:

- **Shift templates** only support a soft **Hide** (`is_active=false`, reversible, keeps shifts). There is no way to permanently remove a template that was created by mistake or is truly retired.
- **Availability** has delete hooks (`useDeleteAvailability`, `useDeleteAvailabilityException`) that are **dead code** — defined but never called, with no UI entry point.

When we add delete, a naive "Are you sure? This cannot be undone" dialog would be both **inaccurate** (some data survives) and **dangerous** (the genuinely destructive parts get lost in generic fear). We want managers to understand the *real* blast radius.

## Goal

Two destructive-delete flows that show a live **Impact Ledger** — what is *Removed* vs what is *Kept* — with friction proportional to the real blast radius, always offering the reversible alternative.

## Ground Truth (verified this session against local DB)

| Fact | Source | Consequence for UX |
|---|---|---|
| `shifts.shift_template_id` FK is **ON DELETE SET NULL** | `pg_constraint` | Already-scheduled shifts **survive** (detach from template). "Kept" column truthfully lists them. |
| `open_shift_claims.shift_template_id` FK is **ON DELETE CASCADE** | `pg_constraint` | Pending claims + claim history are **destroyed**. This is the irreversible part → gets the checkbox gate + names affected employees. |
| `employee_availability` has **no inbound FKs** | `pg_constraint` | Deleting availability cascades nothing. Impact is *informational*, not record-destroying. |
| `employee_availability.is_available` boolean | schema | Distinguishes an *available window* (low friction) from an *unavailable/blackout block* (guardrail — deleting it removes a scheduling constraint). |
| DELETE RLS policies exist on all 3 tables, restricted to **owner/manager** | `pg_policies` | **No migration needed.** UI exposes the action; RLS enforces permission. Employees keep their existing "delete own" policies (out of scope here). |

**No schema change, no new RPC, no edge function.** Frontend-only: hooks + dialogs + wiring + client-side impact queries.

## UX (from the approved mockup)

Uses the CLAUDE.md custom **Dialog** pattern (icon-box header, `px-6` body, semantic tokens) — same visual language as `TradeApprovalQueue.tsx`, not the bare shadcn `AlertDialog`.

### Shift template delete — Impact Ledger

Header: trash icon box, `Delete "<name>"?`, subtitle (position · time · days), **severity pill** (Low / High).

Body:
1. **Summary chips** (blast radius at a glance): pending-claims count (red, only if > 0), open-shifts-removed count (amber), scheduled-shifts-kept count (green).
2. **Ledger** — two panels:
   - **Removed** (destructive tint): "N pending claims are withdrawn — <names>" (only if N>0, `crit` styling); "N upcoming open shifts stop being claimable"; "Claim history for this template is erased".
   - **Kept** (green tint): "N already-scheduled shifts stay on the calendar"; "Everyone assigned keeps their shift & hours".
3. **Safe alternative** callout: "Hide it instead — stops new open shifts, keeps every shift & claim. Restore anytime." with an inline **Hide template** button (reuses existing `hideMutation` + undo toast).
4. **Acknowledgment checkbox** (friction) — **only rendered when `pendingClaimCount > 0`**: "I understand N employees' pending claims will be withdrawn." Gates the Delete button.

Footer: `Cancel` · `Hide template` (outline) · `Delete template` (destructive; disabled until ack checked when ack is present).

**Proportional friction:** zero pending claims + zero scheduled → no red ledger line for claims, no checkbox, plain confirm. The dialog earns its friction from the numbers.

### Availability delete — two variants (driven by `is_available`)

Header: calendar / calendar-x icon box, severity pill.

- **Available window** (`is_available=true`) — Low friction, informational. "What changes": scheduler stops suggesting this person for the window; can still be scheduled manually; posted schedule unchanged. Footer: `Cancel` · `Remove availability`. No checkbox.
- **Unavailable block** (`is_available=false`) — **Guardrail**. Amber **warning hero**: "This block is a guardrail. <Name> told you they can't work <day> <time>. Delete it and the scheduler — plus open-shift claiming — will stop blocking that window." "What changes": shifts can be scheduled over this time with no warning; open-shift claiming no longer treats it as a conflict. **Acknowledgment checkbox** (amber): "I understand shifts can be booked during a time <Name> marked off." Footer: `Cancel` · `Delete block` (disabled until ack).

**Exceptions** (`availability_exceptions`): one-time dated overrides. Same two-variant treatment keyed on the exception's available/unavailable flag; copy references the specific date instead of a weekday.

## Components & Hooks

### New
- `src/hooks/useTemplateDeletionImpact.ts` — `useQuery` keyed `['template-deletion-impact', templateId]`, `enabled` only when a template is selected for deletion, `staleTime: 30000`. Runs three lightweight reads:
  1. Pending claims: `open_shift_claims` where `shift_template_id` + `status='pending_approval'`, join `employees(name)` → `{ count, names[] }`.
  2. Future scheduled shifts: `shifts` count where `shift_template_id` = id AND `shift_date >= today` (the SET-NULL survivors worth naming as "kept").
  3. Upcoming open spots: call existing `get_open_shifts` RPC for a forward window (today → +N weeks), sum `open_spots` for this `template_id`.
  Returns `{ pendingClaims: {count, names}, scheduledShiftsKept, upcomingOpenSpots, isLoading }`.
- `src/components/scheduling/DeleteTemplateDialog.tsx` — the ledger dialog. Props: `open`, `onOpenChange`, `template`, `onHide`, `onConfirmDelete`, impact data, combined `isPending`.
- `src/components/scheduling/DeleteAvailabilityDialog.tsx` — the two-variant availability dialog. Props include the availability/exception row (or a normalized shape) and `kind: 'availability' | 'exception'`.
- Pure helpers (exported, unit-tested) for copy/severity derivation, e.g. `deriveTemplateDeletionSeverity(impact)`, `describeAvailabilityDeletion(row)`.

### Modified
- `src/hooks/useShiftTemplates.tsx` — add `deleteMutation` (`deleteTemplate`), hard delete `.delete().eq('id', id).eq('restaurant_id', restaurantId)`; `onSuccess` invalidates + destructive-tone toast (**no undo** — cascade is irreversible; the Hide affordance is the reversible path). Follows existing mutation shape.
- `src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx` — add a `Delete template…` destructive `DropdownMenuItem` beneath Hide (with `onDelete` prop). Only for non-hidden rows (or both — TBD in build, default both).
- `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` — own the single `DeleteTemplateDialog` instance (single-dialog pattern), wire `onDelete` → open dialog; `onConfirmDelete` → `deleteTemplate`; `onHide` inside dialog → existing hide flow.
- `src/components/AvailabilityDialog.tsx` — add a `Remove` (destructive, `variant` per CLAUDE.md) button in the footer, shown only when editing an existing `availability`; opens `DeleteAvailabilityDialog`.
- `src/components/AvailabilityExceptionDialog.tsx` — same `Remove` affordance for editing an existing exception.
- `src/components/scheduling/TeamAvailabilityGrid.tsx` — hover-reveal trash icon on filled cells (`opacity-0 group-hover:opacity-100`, `aria-label`), opens `DeleteAvailabilityDialog` for that entry. Single dialog owned at grid level.

### Reused as-is
- `useDeleteAvailability`, `useDeleteAvailabilityException` (wire the dead hooks). Call shape: `mutate({ id, restaurantId })`.
- `hideMutation` / `restoreMutation` (safe alternative + undo).

## Friction & gating rules

- **Control-group gating (lessons/line 219):** the Delete/Hide button group is disabled on the *union* of all in-flight states (`deleteTemplate.isPending || hideTemplate.isPending`), not per-button.
- Checkbox present ⇒ Delete disabled until checked. Checkbox absent (low-impact) ⇒ Delete enabled immediately.
- Dialog closes on success; toast carries confirmation.

## Accessibility
- Dialogs use `DialogTitle` + `DialogDescription` (Radix `aria-describedby`).
- Trash icon buttons carry `aria-label` (e.g. `Delete <name>'s Wednesday availability`).
- Checkbox is a real `<Checkbox>`/label pair, keyboard-operable, focus-visible ring.
- Three-state rendering on the impact hook: loading → skeleton row in the ledger; the dialog is actionable but the counts show a subtle loading state until resolved (Delete stays enabled for the zero-friction path only after counts load, to avoid acting on unknown blast radius — if impact still loading, keep Delete disabled with a "Checking impact…" hint).

## Testing strategy
- **Unit (Vitest):**
  - `useTemplateDeletionImpact` — mock supabase; assert count aggregation, names extraction, forward-window sum, `enabled` gating. Watch the delete-chain mock lesson (line 413): if any shared delete chain changes, run the FULL suite.
  - `useShiftTemplates` deleteMutation — success invalidates + toast; error path.
  - Pure copy/severity helpers — all branches (Sonar branch-coverage lesson line 508: ≥2 assertions per new ternary; prefer one fixture exercising every branch).
- **Component (optional but recommended):** dialog renders correct ledger/friction for high vs low impact; checkbox gates Delete; Hide button calls onHide.
- **E2E (Playwright):** manager deletes a template with a pending claim → dialog shows ack gate → confirm → template gone, claim withdrawn. Manager removes an "unavailable" availability block → guardrail dialog → confirm. Reuse `e2e-supabase` helpers + `generateTestUser`.
- **No pgTAP** (no SQL/RPC/migration added). If build reveals a need for a counting RPC, add pgTAP with **dynamic dates** (lesson line 60).

## Decided trade-offs / non-goals
- **No undo for hard delete.** Cascade of `open_shift_claims` is irreversible; Hide is the reversible path and is surfaced inline. Documented in the toast (no Undo action, unlike Hide).
- **`useDeleteEntity` left unchanged.** It deletes by `id` only and relies on RLS for tenant isolation; changing the shared helper risks the sibling-mock breakage from lesson line 413. `deleteTemplate` (new, template-specific) *does* add `.eq('restaurant_id')` defense-in-depth since it's not shared.
- **Impact counts are client-side queries,** not a new RPC — keeps the change migration-free and within existing RLS. Forward window for open spots is bounded (e.g. 4 weeks) to keep the query cheap; the ledger says "upcoming" not "all future."
- **Bulk delete** (multiple templates at once) is out of scope for this PR.
- **Employee self-service availability delete** is out of scope; this targets the manager surfaces (Scheduling planner + availability grid/editor).
