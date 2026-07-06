# Timeline Edit/Create — Implementation Plan

**Design:** docs/superpowers/specs/2026-07-05-timeline-edit-create-design.md
**Branch:** feature/timeline-edit-create
**Approach:** TDD per task; each task is one RED→GREEN→REFACTOR→COMMIT cycle.

## Stage A — Shared validation pipeline (no behavior change for planner)

### A1. `src/lib/shiftTimeMath.ts` — TZ + snap helpers
- `minutesToIso(dateStr, minutes, tz): string` — restaurant-local minutes (may exceed 1440
  for overnight) → UTC ISO via `fromZonedTime`. Handles day rollover.
- `snapToStep(min, step = STEP_MIN): number`.
- Tests: `tests/unit/shiftTimeMath.test.ts` — DST spring-forward/fall-back in
  America/Chicago (Mar 8 / Nov 1 style anchors, TZ-portable fixtures), overnight > 1440,
  COMBINED overnight+fall-back case (23:00 start the night before the transition),
  snap edges (negative offsets, exact boundaries).

### A2. `src/lib/shiftMutationPipeline.ts` — pure issue collector
- `collectShiftIssues({ employeeId, restaurantId, interval, shifts, excludeShiftId, checkConflicts })`
  → `{ warnings, conflicts }`. Composes `validateShift` + injected RPC checker
  (defaults to `checkConflictsImperative`).
- `assertNotLockedClient(shift)` → throws typed error for locked shifts.
- Tests: `tests/unit/shiftMutationPipeline.test.ts` — warning aggregation, excludeShiftId
  pass-through, RPC merge, checker rejection handling (RPC failure → surfaced, not swallowed),
  locked rejection.

### A3. `src/hooks/useValidatedShiftMutations.ts` — the pipeline hook
- Exposes `validateAndCreate` / `forceCreate` (existing shapes), new
  `validateAndUpdateTime` / `forceUpdateTime` / `validateAndReassign` / `forceReassign`
  ({ updated|reassigned, pendingConflicts?, pendingWarnings? }), `deleteShift`,
  `validationResult`, `clearValidation`.
- `validateAndUpdateTime` builds intervals via `ShiftInterval.fromTimestamps` — NEVER the
  host-TZ `split('T')` + `.create()` reconstruction (Supabase review major #2).
- Update/reassign/delete run the lock guard; update/reassign run all three validation layers.
- Tests: `tests/unit/useValidatedShiftMutations.test.tsx` — renderHook with mocked
  `useShifts` mutations + DI'd checker; pin pending-confirmation contract per mutation;
  pin that create-with-no-issues mutates immediately; TZ regression pinning restaurant-local
  wall-clock preservation when host TZ ≠ restaurant TZ.

### A3b. Explicit `restaurant_id` on single-shift mutations
- Extend `useUpdateShift` / `useDeleteShift` (`src/hooks/useShifts.tsx`) to accept and apply
  `.eq('restaurant_id', restaurantId)` (defense-in-depth per lesson 2026-07-02, matching the
  series-mutation pattern). Update ALL existing call sites. Tests pin the filter is applied.

### A4. Refactor `useShiftPlanner` to delegate
- Replace its inline validateAndCreate/forceCreate/validateAndUpdateTime/validateAndReassign/
  deleteShift with delegation to `useValidatedShiftMutations`; public API unchanged.
- Existing `tests/unit/useShiftPlanner*.test*` must pass unmodified (byte-compatible API).

## Stage B — Editable popover (full CRUD, zero new canvas gestures)

### B1. `TimelineShiftEditor` form component
- `src/components/scheduling/ShiftTimeline/TimelineShiftEditor.tsx`: start/end `TimeInput`s,
  employee `Select` (active employees, position-match sorted via pure helper), break, notes.
- Pure sort helper `rankEmployeesForShift(employees, { position, area })` in
  `src/lib/employeeRanking.ts` + tests.
- Live advisory: `useCheckConflicts` (reactive) for the selected employee + local
  `validateShift` warnings → amber chips; `aria-live="polite"` region.

### B2. Popover edit mode + actions
- `TimelineShiftPopover`: view mode gains footer (Edit / Delete); edit mode renders
  `TimelineShiftEditor`. Locked → lock icon, actions disabled. Recurring → "this shift only"
  hint. Published delete → AlertDialog confirm with `event.preventDefault()` before async.
- Anchor via Radix `PopoverAnchor` bound to the interacted element's rect stored in the
  overlay state; `modal={false}`; scrollable plot container as `collisionBoundary`.
- Single union overlay state in `ShiftTimelineTab`:
  `activeOverlay: { mode:'edit', shift, anchorRect } | { mode:'create', draft, anchorRect } | null`
  — edit, quick-add, and gap entry points are mutually exclusive by construction.
- Conflict-dialog stacking: popover stays open behind `AvailabilityConflictDialog`;
  outside-click dismiss suppressed while dialog open; Escape closes topmost only.

### B3. Wire `ShiftTimelineTab`
- Mount `useValidatedShiftMutations(restaurantId, shifts)`; single
  `AvailabilityConflictDialog` instance; save/delete flows; toasts come from mutation hooks.
- Three-state rendering preserved; no new fetches.

## Stage C — Paint-to-create + quick-add

### C1. `src/lib/timelineDraft.ts` — pure paint/drag math
- `pointerToMinutes(clientX, plotRect, window)`, paint-range reducer
  (`beginPaint/updatePaint/endPaint` with snap + min duration 15 min, click → default 120 min
  clamped to window), draft-shift builder (lane context → position/area prefill).
- Tests: `tests/unit/timelineDraft.test.ts`.

### C2. Lane paint layer + ghost bar
- Pointer handlers on lane plot region (mouse: drag; touch: long-press 500 ms then drag);
  dashed ghost bar rendered from draft state; Escape cancels.
- Visually-hidden per-lane "Add shift to <lane>" button as keyboard entry (opens quick-add
  with lane defaults).

### C3. Quick-add popover (create variant)
- Reuse `TimelineShiftEditor` in create mode anchored to the ghost; "On shift" badge from
  local day shifts; commit via `validateAndCreate` (input built with `minutesToIso`) →
  conflict dialog → `forceCreate`.

## Stage D — Drag-move / edge-resize with live coverage

### D1. `useTimelineBarDrag` pointer hook
- `setPointerCapture`; body drag = move (preserve duration), edge handles = resize;
  15-min snap; floating time readout; locked bars inert; touch uses popover instead
  (no drag on `pointerType === 'touch'`).
- Draft commits throttled to one per `requestAnimationFrame`; handlers read current values
  via render-synced refs (never pointerdown-time closures).
- `touch-action: none` scoped to bar bodies + edge handles only; lane background/plot keep
  pan behavior. Keyboard activation (Enter/Space → popover) must remain intact.

### D1b. Memoize `TimelineBar` + `TimelineLane`
- `React.memo` with comparators keyed on shift id + geometry (leftMin/endMin/row/label) so a
  drag frame re-renders only the affected row. Stable callbacks via `useCallback`.

### D2. Draft merge into the model
- `ShiftTimelineTab` holds `draftShift`; model input = day shifts with dragged original
  replaced by draft (pure merge helper + test). Coverage chart/verdict/status strip update
  live via existing memo chain at rAF cadence.
- Commit uses `useUpdateShift`'s existing optimistic `setQueriesData` path; draft cleared on
  mutation settle so the bar never jumps awaiting refetch.

### D3. Commit on release
- Release → `validateAndUpdateTime` (ISO from `minutesToIso`); pending → conflict dialog
  (cancel = snap back, confirm = `forceUpdateTime`); draft cleared on settle.

## Stage E — Clickable coverage gaps

### E1. `mergeUnderStaffedRange(hours, clickedMin)` in `src/lib/coverageSummary.ts` (or
  sibling) + tests — merge contiguous `under` hours around the clicked one.

### E2. `CoverageStatusStrip` under-segments become buttons → open quick-add prefilled with
  the merged range (no lane context). aria-labels per segment.

## Stage F — E2E + polish

### F1. Playwright smoke: timeline → click bar → edit time via popover → save; paint path
  covered indirectly via quick-add popover create (open via keyboard "Add shift" button to
  avoid drag flake). `tests/e2e/` with helpers from `../helpers/e2e-supabase`.

## Task dependencies
A1→A2→A3→A4; B1→B2→B3 (needs A3); C1→C2→C3 (needs A3, B1); D1→D2→D3 (needs A3);
E1→E2 (needs C3); F1 last. Stages B/C/D/E are sequential in this plan to keep diffs reviewable.
