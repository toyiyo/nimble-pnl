# Timeline UX Safety + Discoverability — Design

**Date:** 2026-07-06
**Branch:** feature/timeline-edit-create (extends PR #587)
**Trigger:** Live testing feedback — a manager (1) inadvertently deleted a draft shift with no
way to undo it, (2) couldn't find how to add someone, (3) dragged/assigned and got a toast but
no visible result to verify or correct.

## Problem

Three real gaps surfaced while testing the new Timeline editing canvas:

1. **Destructive delete, no undo.** `TimelineShiftPopover.handleDeleteClick` deletes an
   **unpublished** shift immediately on click (only *published* shifts get an `AlertDialog`
   confirm). Deletes are hard-deletes with no snapshot for drafts (`schedule_change_logs`
   only logs published-shift deletes), so a misclick is unrecoverable.
2. **No discoverable "add".** Creating a shift is only via painting empty lane space or a
   visually-hidden ("sr-only") "Add shift to <lane>" button. No visible affordance.
3. **Invisible result after a change.** Create / move / reassign fire a generic success toast
   but nothing on the canvas confirms *what* changed, so the user can't verify or correct it.

## Fixes

### Fix 1 — Undo on delete (all deletes), keep the published confirm

- Add **`deleteShiftWithUndo(shift: Shift)`** owned by `ShiftTimelineTab` (it persists after
  the popover closes). It:
  1. Captures the full shift, calls the existing `deleteShift(shift.id)` pipeline.
  2. Shows a toast: **"Shift deleted"** with an **Undo** `ToastAction`.
  3. On Undo → re-create the shift from the captured payload via `useCreateShift`
     (`restaurant_id, employee_id, start_time, end_time, position, break_duration, notes,
     status, is_published, source, shift_template_id`). New id (acceptable — it's a restore),
     then toast "Shift restored".
- `TimelineShiftPopover`'s `deleteShift: (id) => void` prop becomes **`onDelete: (shift) => void`**
  so undo has the data. The published-shift `AlertDialog` confirm stays as an extra guard;
  its confirm path also routes through `onDelete(shift)` so published deletes are undoable too.
- Undo re-inserts directly (no re-validation — the shift existed moments ago). Idempotency:
  the Undo action is one-shot (toast dismisses on click).

### Fix 2 — Visible "Add shift" button

- Add a visible **"Add shift"** button (Lucide `Plus`, CLAUDE.md primary button style) in the
  timeline controls row (alongside the day selector / group-by toggle).
- Click opens the existing create popover (`activeOverlay {mode:'create'}`) for the **selected
  day** with a sensible default block and **no lane context** (employee + position blank for
  the user to fill). Default range: a `DEFAULT_ADD_RANGE` (e.g. 09:00–17:00) clamped into the
  model window via the existing `endPaint`/clamp helpers; anchor the popover to the button's rect.
- Reuses `buildDraftShiftValues(range)` + the create-mode `TimelineShiftEditor` — no new form.
- Keyboard/a11y: it's a real `<button>` with a visible label (the sr-only per-lane buttons stay
  for in-lane adds; this is the primary discoverable entry point).

### Fix 3 — Confirming feedback + transient highlight

- **Descriptive toasts:** create / move / reassign success toasts name the change
  (e.g. "Added — Maya · 5:00–9:00 PM", "Moved — Ana to 3:30–10:00 PM"). Sourced from the
  employee name + formatted times already available at the call site.
- **Transient highlight:** `ShiftTimelineTab` keeps `recentlyChangedShiftId` (set on a
  move/resize/edit commit whose shift id is known; cleared after ~2s via a timeout).
  `TimelineBar` takes a `highlighted` prop → a brief `ring-2 ring-ring` pulse (semantic tokens).
  Created shifts (new id unknown until refetch) rely on the descriptive toast; move/edit/resize
  (known id) also get the ring so the user sees exactly what moved.

## Out of scope / decided trade-offs

- Undo re-creates (new id) rather than restoring the exact id — fine for a draft correction;
  avoids a soft-delete schema change. (True id-stable restore would need a DB change.)
- No change to the delete DB semantics or the audit trigger (a separate, larger topic).
- The Planner's employee-chip drag feedback is not touched here (this is the Timeline surface).

## Test plan

- Unit: `deleteShiftWithUndo` shows an undo toast and the undo action re-creates with the exact
  payload (mocked mutations); the "Add shift" button opens the create overlay with a default
  range + null lane context + the selected day; `TimelineBar` renders the highlight ring when
  `highlighted`; the transient highlight clears after its timeout (fake timers).
- E2E (extend the existing smoke): the visible "Add shift" button opens the quick-add popover.
- Verify: tsc, changed-file lint, full unit suite, build, E2E smoke, then push to PR #587.
