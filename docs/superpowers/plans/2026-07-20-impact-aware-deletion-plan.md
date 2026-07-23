# Plan: Impact-Aware Deletion

Design: `docs/superpowers/specs/2026-07-20-impact-aware-deletion-design.md`
Branch: `feature/impact-aware-deletion`

Each task is RED → GREEN → REFACTOR → COMMIT. Frontend-only; no migration. Run relevant tests per task; run the **full** unit suite after Task 3 (shared-hook file).

## Task graph
```
T1 helpers ─┬─> T2 impact hook ─┐
            ├─> T4 template dialog ─> T5 template wiring ─┐
T3 delete mut ┘                                           ├─> T8 E2E
T1 ─────────> T6 availability dialog ─> T7 avail wiring ──┘
```

## T1 — Pure helpers + copy builders
**Files:** `src/lib/scheduling/deletionCopy.ts` (new), `tests/unit/deletionCopy.test.ts`
- `deriveTemplateSeverity({pendingClaims, scheduledShiftsKept, upcomingOpenSpots})` → `'low' | 'high'` (high iff pendingClaims>0).
- `buildTemplateLedger(impact, templateName)` → `{ chips[], removed[], kept[], needsAck, ackLabel }`. Pending-claims line only when count>0, names joined (e.g. "Alex Rivera & Jordan Lee", ">2 → "Alex, Jordan +N more").
- `describeAvailabilityDeletion({isAvailable, dayLabel, timeLabel, personName, kind, dateLabel?})` → `{ severity, heroText?|null, changes[], needsAck, ackLabel }`. Guardrail (`isAvailable=false`) → hero + ack; available → no hero, no ack.
- **Tests:** every branch — pending 0 vs 1 vs 3 (name formatting), available vs unavailable, exception vs recurring copy. Aim ≥2 assertions per conditional (Sonar branch coverage).
**Acceptance:** helpers pure (no React/supabase), all branches covered.

## T2 — `useTemplateDeletionImpact`
**Files:** `src/hooks/useTemplateDeletionImpact.ts` (new), `tests/unit/useTemplateDeletionImpact.test.tsx`
- `useQuery(['template-deletion-impact', templateId])`, `enabled: !!templateId`, `staleTime:30000`, `refetchOnMount:true`.
- Reads: (a) `open_shift_claims` select `id, employees(name)` where `shift_template_id` + `status='pending_approval'`; (b) `shifts` count where `shift_template_id` + `shift_date>=today`; (c) `get_open_shifts(restaurantId, today, today+27d)` → sum `open_spots` where `template_id===templateId`.
- Returns `{ pendingClaims:{count,names}, scheduledShiftsKept, upcomingOpenSpots, isLoading, isError }`.
- **Tests (mock supabase):** aggregation, name extraction, forward-window sum filtered by template, `enabled` gating (no fetch when templateId null), error surfaces `isError`.
**Acceptance:** own-restaurant only; error path returns `isError` (never throws to caller).

## T3 — `deleteTemplate` mutation
**Files:** `src/hooks/useShiftTemplates.tsx`, `tests/unit/useShiftTemplates.*.test.ts(x)`
- `deleteMutation.mutateAsync({id})`: `.from('shift_templates').delete().eq('id',id).eq('restaurant_id',restaurantId).select('id')`.
- 0-row result → info toast "Template already removed"; ≥1 row → invalidate + normal toast (strong copy, **no** Undo, **not** destructive variant); error → destructive toast.
- Export `deleteTemplate`.
- **Tests:** success (invalidate+toast), zero-row (info), error path.
- **After GREEN: run the FULL unit suite** (`npx vitest run`) — shared file; guard against sibling delete-chain mock breakage (lessons #413).
**Acceptance:** full suite green.

## T4 — `DeleteTemplateDialog`
**Files:** `src/components/scheduling/DeleteTemplateDialog.tsx` (new), `tests/unit/DeleteTemplateDialog.test.tsx`
- CLAUDE.md custom Dialog (icon-box header, `px-6`, sticky footer). Consumes `useTemplateDeletionImpact` result via props (dialog owns nothing async itself — parent passes impact) OR calls hook internally keyed on `template.id`; prefer hook-internal keyed on open template.
- Severity pill + chips (custom badge span), Removed/Kept panels (`bg-destructive/10` / `bg-emerald-500/10`), safe-alt callout + Hide button, ack `<Checkbox>` only when `pendingClaims.count>0`.
- **Three-state:** loading → Delete disabled "Checking impact…"; error → Delete disabled + inline error + Retry; ready → Delete enabled (gated by ack when present).
- Control-group gating: Delete+Hide disabled on `isDeleting||isHiding`.
- **Tests:** high-impact renders ack+names & gates Delete; low-impact no ack, Delete enabled; error state disables Delete + shows Retry; Hide button fires onHide; contrast/token classes present.
**Acceptance:** a11y (DialogTitle+Description, checkbox label, focus ring); no per-row instance.

## T5 — Template delete wiring
**Files:** `TemplateRowHeader.tsx`, `TemplateGrid.tsx`, `ShiftPlanner/ShiftPlannerTab.tsx`
- Add `onDelete` prop + destructive `Delete template…` item in **both** dropdown branches (`text-destructive`).
- Thread `onDelete` through `TemplateGrid` → `ShiftPlannerTab`.
- `ShiftPlannerTab` owns single `DeleteTemplateDialog` (state `templateToDelete`); `onConfirmDelete`→`deleteTemplate`; dialog `onHide`→existing `handleHideTemplate`.
- **Tests:** existing ShiftPlannerTab/TemplateGrid tests stay green; add a wiring test if a testable seam exists (else rely on E2E T8).
**Acceptance:** delete opens dialog; confirm removes template; hide path intact.

## T6 — `DeleteAvailabilityDialog`
**Files:** `src/components/scheduling/DeleteAvailabilityDialog.tsx` (new), `tests/unit/DeleteAvailabilityDialog.test.tsx`
- Props: `{ open, onOpenChange, target: { kind:'availability'|'exception', row }, restaurantId }`.
- Derives copy via `describeAvailabilityDeletion` + `utcTimeToLocalTime(row.start_time, tz, refDate)` (anchor: exception→row.date; recurring→today).
- Available variant → informational; unavailable → amber hero + ack checkbox.
- Calls `useDeleteAvailability` / `useDeleteAvailabilityException` `mutate({id,restaurantId})`; control-group gating (Delete + Cancel disabled while pending); close on success.
- **Tests:** available (no hero/ack, Delete enabled), unavailable (hero+ack gates Delete), exception date copy, gating disables during pending.
**Acceptance:** TZ display correct; a11y complete.

## T7 — Availability delete wiring
**Files:** `src/pages/Scheduling.tsx`, `AvailabilityDialog.tsx`, `AvailabilityExceptionDialog.tsx`, `TeamAvailabilityGrid.tsx`
- `Scheduling.tsx` owns single `DeleteAvailabilityDialog` + `deletionTarget` state; passes `onRequestDelete` to grid, and Remove-callbacks to editors.
- `AvailabilityDialog`/`AvailabilityExceptionDialog`: add `Remove` button (destructive) shown only when editing an existing row → closes editor, opens delete dialog with that row.
- `TeamAvailabilityGrid`: sibling trash `<button>` on filled desktop cells (`stopPropagation`, `aria-label`, focus-visible reveal), omitted on compact/mobile → `onRequestDelete(entry)`.
- **Tests:** grid trash raises callback w/o opening editor (stopPropagation); editor Remove opens delete dialog.
**Acceptance:** all three triggers reach one dialog; mobile path via editor works.

## T8 — E2E
**Files:** `tests/e2e/impact-aware-deletion.spec.ts` (new)
- Seed (via `e2e-supabase` helpers, `generateTestUser`): restaurant, manager, template w/ capacity, published week, a pending open_shift_claim.
- Flow A: manager opens planner → template `⋯` → Delete → ledger shows ack + employee name → check ack → Delete → template gone; assert pending claim removed.
- Flow B: manager sets an `is_available=false` availability → opens delete → guardrail hero + ack → Delete → row gone.
**Acceptance:** both flows green.

## Verify (Phase 8)
`npm run typecheck && npm run lint && npm run test && npm run test:e2e && npm run build`. (No `test:db` — no SQL added.)

## Non-goals (locked)
Bulk delete; employee self-service delete; mobile template-delete surface; `get_open_shifts` auth hardening (separate security task).
