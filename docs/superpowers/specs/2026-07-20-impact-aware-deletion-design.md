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
- `src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx` — add a `Delete template…` destructive `DropdownMenuItem` (with `onDelete` prop) in **both** the active and hidden dropdown branches (a mistakenly-hidden template must still be hard-deletable). Item uses `text-destructive` per CLAUDE.md. **Mobile note:** this dropdown is `hidden md:inline-flex` today; template delete inherits that desktop-only gap (same as existing Edit/Hide) — see non-goals.
- `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` — own the single `DeleteTemplateDialog` instance (single-dialog pattern), wire `onDelete` → open dialog; `onConfirmDelete` → `deleteTemplate`; `onHide` inside dialog → existing hide flow.
- `src/components/AvailabilityDialog.tsx` — add a `Remove` (destructive, `variant` per CLAUDE.md) button in the footer, shown only when editing an existing `availability`; opens `DeleteAvailabilityDialog`.
- `src/components/AvailabilityExceptionDialog.tsx` — same `Remove` affordance for editing an existing exception.
- `src/pages/Scheduling.tsx` — **owns the single `DeleteAvailabilityDialog` instance** (the common ancestor of the grid AND the two editor dialogs; it already owns `availabilityDialogOpen`/`exceptionDialogOpen`). All three triggers set a shared `deletionTarget` state here. (Correction from Phase 2.5: the grid cannot own this dialog because the editor Remove buttons — rendered as siblings in `Scheduling.tsx` — must reach it too.)
- `src/components/scheduling/TeamAvailabilityGrid.tsx` — desktop-only hover/focus-reveal trash **sibling** `<button>` on filled cells. The cell today is `role="button" tabIndex={0}` (opens edit); to avoid a nested interactive control, the trash button (a) is a real sibling `<button>` with `aria-label`, (b) calls `e.stopPropagation()` so it does not also open the edit dialog, and (c) is `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` (keyboard-reachable, not hover-only). **Omitted on the compact/mobile cell** — mobile deletes via the editor Remove button (tap cell → editor → Remove). Grid raises `onRequestDelete(entry)` up to `Scheduling.tsx`.

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
- **Mobile template delete is out of scope** (pre-existing gap): the template row `⋯` dropdown is `hidden md:inline-flex`, so Edit/Hide/Delete are all desktop-only. Availability delete IS reachable on mobile (tap cell → editor → Remove button). Adding a mobile template-action surface is a separate follow-up.

## Phase 2.5 — Design Review Resolutions

Both reviewers ran (Supabase + Frontend). Dispositions below; the doc above already reflects the inline fixes.

### Frontend — critical (both fixed in design)
1. **Nested interactive control on grid cells** → trash is a sibling `<button>` with `stopPropagation`, keyboard-focusable (`focus-visible:opacity-100`), omitted on compact/mobile. (See TeamAvailabilityGrid bullet.)
2. **`DeleteAvailabilityDialog` ownership contradiction** → owned at `Scheduling.tsx` page level (common ancestor of grid + both editors), not the grid. (See Scheduling.tsx bullet.)

### Frontend — major (all fixed in design)
3. **Impact-query error state** → on `useTemplateDeletionImpact` error, Delete stays **disabled** with an inline error row + Retry in the ledger (never silently enable — deleting with unknown blast radius is the worst failure). Loading → Delete disabled + "Checking impact…". Only the fully-resolved zero-impact path enables Delete without a checkbox. Impact-hook error branch added to the test plan.
4. **Mobile template delete** → explicit non-goal (above).
5. **Dense dialog CTA reachability at 375px** → the template Impact-Ledger dialog uses a **sticky footer** (`sticky bottom-0 bg-background border-t border-border/40`) so Cancel/Hide/Delete stay reachable without scrolling the full ledger. Mobile-viewport check is an acceptance criterion.
6. **Control-group gating** → extended to the availability dialog: its Delete button gates on `useDeleteAvailability.isPending || useDeleteAvailabilityException.isPending`; Cancel is disabled while a delete is in-flight. Template dialog gates Delete+Hide on the union `deleteTemplate.isPending || hideTemplate.isPending`.

### Frontend — minor (fixed)
7. **Pin token classes** (no literal `red-*`): Removed panel/pending-claims → `bg-destructive/10 border-destructive/20 text-destructive`; Kept panel → `bg-emerald-500/10 border-emerald-500/20` (mirrors the existing amber AI-panel convention); guardrail hero/checkbox → `bg-amber-500/10 border-amber-500/20`. Verify text contrast ≥4.5:1 in light AND dark during Phase 5.
8. **Success toast is a normal toast with strong copy**, NOT `variant="destructive"` (which signals error). e.g. `"Closing Server" deleted · 2 pending claims withdrawn`. No Undo action (unlike Hide).
9. **Dropdown placement TBD resolved**: Delete shown in both active and hidden branches.
10. **Severity pill + summary chips** use the CLAUDE.md custom badge span convention (`text-[11px] px-1.5 py-0.5 rounded-md`), not shadcn `Badge`, for consistency.

### Supabase — critical (deferred with rationale + tracked)
11. **`get_open_shifts` lacks a tenant-authorization check** (any authenticated user can call it with an arbitrary `restaurant_id`). This is **pre-existing** and **not introduced or worsened by this feature's code path** — `useTemplateDeletionImpact` always passes the caller's *own* selected `restaurant_id`, so no new cross-tenant leak. Bundling a `SECURITY DEFINER` auth-guard migration into a UI feature is risky: a naive `user_has_restaurant_access(p_restaurant_id)` guard would break the **service-role** caller `broadcast-open-shifts` (where `auth.uid()` is NULL). Correct fix (guard only when `auth.uid() IS NOT NULL`, allow any restaurant *member* since employees legitimately call it) belongs in a focused security PR with its own pgTAP. **Tracked as a separate task; documented here so the future fix preserves the service-role path.**

### Supabase — major (both fixed in design)
12. **Timezone display in availability copy** → the dialog MUST format `start_time`/`end_time` via `utcTimeToLocalTime(value, restaurant.timezone, referenceDate)` with the anchor matching the entry point: grid cell → that column's `date`; exception → the exception's `date`; recurring editor → "today". Never render raw `TIME` values (UTC contract; wrong-DST-anchor is a documented recurring bug class).
13. **TOCTOU between ledger snapshot and delete** → the impact query is forced fresh on each dialog open (`refetchOnMount` + invalidate on open). The residual small window (a claim approved between open and confirm) is an **accepted limitation**: the cascade stays consistent (no corruption); worst case the ledger over-states withdrawals. Documented rather than solved with a heavier pre-delete re-verify.

### Supabase — minor (fixed)
14. **Zero-row delete lies** → `deleteTemplate` chains `.select('id')` and treats a 0-row result as "already removed" (info toast), not a false success. Safe to add `.select()` here because `deleteTemplate` is a NEW hook with no sibling mocks (contrast lessons line 413, which was about the *shared* delete chain — left unchanged).
15. **Impact hook sums whole-restaurant `open_spots`** from `get_open_shifts` then filters to this `template_id` client-side (RPC takes no template filter). Bounded/cheap at current scale (4-week window); noted, not optimized.

**Re-approval:** design doc now reflects all critical + major concerns. Proceeding to Phase 3.
