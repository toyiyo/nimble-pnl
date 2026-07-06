# Timeline Edit/Create Experience — Design

**Date:** 2026-07-05
**Status:** Approved (user approved interaction design in-session; this doc pins the technical shape)
**Surface:** `src/components/scheduling/ShiftTimeline/` (Timeline view toggle inside `ShiftPlannerTab`)

## Problem

The Timeline view is read-only. Managers find it the most intuitive schedule surface but must
switch to Plan view (template DnD) or the Scheduler grid (form dialog) to add/edit/delete
shifts. The user wants to add people to the schedule directly on the timeline, with the same
validations the planner runs.

## Validation reality (audited 2026-07-05)

Three validation layers exist; only the planner's `useShiftPlanner.validateAndCreate` composes
all of them:

| Layer | Source | Notes |
|---|---|---|
| Duration rules (`INVALID_DURATION` throw, `TOO_SHORT`/`MAX_ENDURANCE` warnings) | `src/lib/shiftInterval.ts` | Warnings, not errors |
| Overlap + clopen rest-gap (`OVERLAP`, `CLOPEN`) | `src/lib/shiftValidator.ts` `validateShift` | Warnings, not errors |
| Time-off + availability | RPCs `check_timeoff_conflict`, `check_availability_conflict` via `checkConflictsImperative` (`src/hooks/useConflictDetection.tsx`) | Server-side, DST-safe |

Key facts that shape this design:

- `validateAndUpdateTime` / `validateAndReassign` in `useShiftPlanner` run only client-side
  `validateShift` — no RPC checks, no override dialog — and have **zero call sites** in the
  planner UI today. Upgrading their contract is free.
- The override UX (`AvailabilityConflictDialog`, "Cancel / Assign Anyway") exists and is shared.
- `ShiftInterval.create(date, 'HH:MM', 'HH:MM')` anchors in **host-local** time. The timeline
  renders in **restaurant TZ** (`isoToLocalMinutes(iso, dateStr, tz)`). When host TZ ≠
  restaurant TZ these disagree. The timeline write path must therefore build UTC ISO
  timestamps with `fromZonedTime` (date-fns-tz, already used by `useGenerateSchedule`) and
  enter the pipeline via `ShiftInterval.fromTimestamps` — never via `.create`.
- Overlap/clopen are **warnings with override**, matching planner semantics. This design
  preserves that (no new hard errors).
- Locked shifts: server enforces via `assertShiftNotLocked` inside `useUpdateShift`; the
  pipeline also rejects client-side and the UI disables drag on locked bars.

## Approach

### 1. Shared validation pipeline (extract, then extend)

New hook `src/hooks/useValidatedShiftMutations.ts` — the single validate→confirm→mutate
pipeline. `useShiftPlanner` delegates to it with its public API **unchanged** (zero planner
regression risk; `ShiftPlannerTab` untouched).

Pure orchestration lives in `src/lib/shiftMutationPipeline.ts` (coverage lives in `src/lib`
per lessons):

```ts
// Pure, DI'd conflict checker for tests
export async function collectShiftIssues(args: {
  employeeId: string;
  restaurantId: string;
  interval: ShiftInterval;
  shifts: Shift[];
  excludeShiftId?: string;
  checkConflicts?: typeof checkConflictsImperative; // DI
}): Promise<{ warnings: ValidationIssue[]; conflicts: ConflictCheck[] }>
```

Hook contract (create path keeps the existing planner shape; update/reassign gain the same
pending-confirmation shape plus force variants):

```ts
validateAndCreate(input: ShiftCreateInput)          // unchanged shape
forceCreate(input: ShiftCreateInput)                // unchanged shape
validateAndUpdateTime({ shift, startIso, endIso, businessDate })
  → { updated: boolean; pendingConflicts?; pendingWarnings? }
forceUpdateTime({ shift, startIso, endIso, businessDate }) → boolean
validateAndReassign({ shift, newEmployeeId })
  → { reassigned: boolean; pendingConflicts?; pendingWarnings? }
forceReassign({ shift, newEmployeeId }) → boolean
deleteShift(shiftId)
validationResult / clearValidation                  // unchanged
```

All update/reassign paths now run **all three layers** (interval rules + validateShift with
`excludeShiftId` + RPC conflicts) and return pending issues for the
`AvailabilityConflictDialog` instead of silently proceeding. Locked shifts short-circuit with
an error result — including the **delete** path (client-side lock guard for parity with
update; `useDeleteShift` has no server-side `assertShiftNotLocked` today).

**Design-review fold-ins (Supabase):**

- The pipeline's `validateAndUpdateTime` builds its interval via
  `ShiftInterval.fromTimestamps(startIso, endIso, businessDate)` — it must NOT inherit the
  current `useShiftPlanner` implementation's `split('T')` + `ShiftInterval.create()`
  reconstruction, which re-anchors in host TZ. A regression test pins that a
  host-TZ ≠ restaurant-TZ round trip preserves the restaurant-local wall-clock time.
- `useUpdateShift` and `useDeleteShift` gain an explicit `restaurant_id` filter
  (`.eq('restaurant_id', restaurantId)`) matching the `useDeleteShiftSeries` /
  `useUpdateShiftSeries` pattern and lesson 2026-07-02 — RLS remains the security boundary;
  the explicit filter is defense-in-depth. The pipeline threads `restaurantId` to both.

New TZ helper in `src/lib/shiftTimeMath.ts` (pure, tested):

```ts
minutesToIso(dateStr: string, minutes: number, tz: string): string
// minutes may exceed 1440 (overnight); uses fromZonedTime; DST-tested
snapToStep(min: number, step = STEP_MIN): number
```

### 2. Editable shift popover (Timeline)

`TimelineShiftPopover` gains an edit mode and actions while staying the single instance owned
by `ShiftTimelineTab` (single-dialog pattern):

**Overlay state machine (design-review fold-in):** one union state drives the single popover
instance across all entry points:
`activeOverlay: { mode: 'edit'; shift; anchorRect } | { mode: 'create'; draft; anchorRect } | null`.
Edit (bar click), quick-add (paint/click), and gap-click all set this state — they are
mutually exclusive by construction; never two popovers mounted.

**Anchoring:** the current zero-size `sr-only` trigger cannot anchor edit/create popovers.
Use Radix `PopoverAnchor` bound to the interacted element (bar / ghost / gap segment) via a
virtual anchor rect stored in `activeOverlay`, with `modal={false}` and the scrollable plot
container as `collisionBoundary` so positioning works inside `overflow-x-auto`.

**Conflict dialog stacking:** when Save surfaces pending issues, the popover **stays mounted
and open** behind `AvailabilityConflictDialog`; outside-click dismissal of the popover is
suppressed while the dialog is open; Escape closes only the topmost overlay (the dialog).
The popover closes only after the dialog resolves (confirm → force mutation → close;
cancel → back to editing).

- **View mode** (existing) + footer actions: Edit, Delete. Lock icon + disabled actions when
  `shift.locked`. Recurring shifts show "Changes apply to this shift only" hint
  (series editing stays in the Scheduler's ShiftDialog; out of scope here).
- **Edit mode:** start/end time fields (reuse `TimeInput`), employee select (active employees,
  sorted: position match first), break, notes. Live advisory conflicts via reactive
  `useCheckConflicts` for the currently selected employee (same pattern as `ShiftDialog`) +
  local `validateShift` warnings — rendered as amber chips using the exact
  `AvailabilityConflictDialog` classes (`bg-amber-500/10 border border-amber-500/20`), no new
  amber shade. New popover/quick-add markup follows the CLAUDE.md typography scale already
  used by `TimelineShiftPopover` (build-time checklist item).
- **Save** routes through `validateAndUpdateTime` / `validateAndReassign`; pending issues open
  the shared `AvailabilityConflictDialog`; confirm calls the force variant.
- **Delete:** immediate for unpublished; `AlertDialog` confirm for published shifts
  (`event.preventDefault()` before async work per lesson 2026-07-05).

### 3. Paint-to-create + quick-add popover

- Pointer handlers on each lane's plot region (empty space). Drag paints a ghost bar snapped
  to `STEP_MIN` (15 min) in restaurant-TZ minutes; a plain click (< 5 px movement) drops a
  default 2 h ghost at the snapped point. Touch: long-press (500 ms) to start painting so
  horizontal scroll still works.
- Ghost commit opens the quick-add popover (same component as edit mode, create variant):
  times prefilled from the ghost, employee picker prioritized by lane context — when grouped
  by **position**, employees matching the lane's position sort first and position is
  prefilled; when grouped by **area**, employees whose `employee.area` matches the lane sort
  first and position defaults to the selected employee's position (a shift's area is derived
  from its employee — `shifts` has no area column).
- "On shift" badge computed locally from the day's loaded shifts; live RPC conflict badge for
  the **selected** candidate only (no N× RPC fan-out).
- Save → `validateAndCreate` (input built with `minutesToIso`) → conflict dialog on pending →
  `forceCreate` on confirm.

### 4. Drag-move / edge-resize with live coverage

- Raw pointer events + `setPointerCapture` on `TimelineBar` (no dnd-kit — continuous 15-min
  snapping is simpler with pointers). Body drag moves; edge handles (desktop) resize; floating
  time readout while dragging. Locked bars don't drag.
- **Render budget (design-review fold-in):** draft state commits are throttled to one per
  `requestAnimationFrame` (never per raw pointermove), and `TimelineBar` + `TimelineLane` are
  wrapped in `React.memo` with comparators keyed on shift id + geometry, so a drag frame
  re-renders only the affected row while the coverage chart recomputes at the rAF cadence.
- **Stale-closure discipline:** pointer-capture handlers registered at `pointerdown` read
  `dayShifts` / overlay state through render-synced refs, never through values closed over
  when the gesture began (lesson 2026-06-04).
- **Touch strategy:** bar bodies and edge handles get `touch-action: none` scoped to their
  own hit areas only; lane background and the plot container keep `pan-x pan-y` so
  scroll-to-navigate is not regressed. On `pointerType === 'touch'` bars do not drag at all —
  tap opens the popover, which reaches every drag outcome via time fields.
- **Draft state:** `ShiftTimelineTab` keeps `draftShift` (create ghost or in-flight
  moved/resized copy). The memoized `useTimelineModel` input becomes
  `dayShifts (minus dragged original) + draft`, so the coverage chart, verdict, and status
  strip update live during the drag — you watch the gap fill before committing.
- Release → `validateAndUpdateTime`; on pending issues the bar snaps back visually and the
  conflict dialog offers override.
- **Commit path:** drag commits use the existing `useUpdateShift` mutation, which already
  performs optimistic `setQueriesData` updates before invalidation — the draft is cleared
  when the optimistic cache write lands (mutation `onSettled`), so the bar never jumps while
  waiting for refetch, and no new invalidation behavior is introduced.
- The draft never writes to React Query caches or localStorage (no manual caching); commit
  goes through mutations, and draft state is cleared on success/cancel. A background refetch
  must not clobber an in-flight draft: the draft lives in local state keyed by shift id and is
  merged over query data at render time (lesson 2026-06-04).

### 5. Clickable coverage gaps

- `CoverageStatusStrip` segments with status `under` become buttons. Clicking one merges
  adjacent under-staffed hours into a contiguous range and opens the quick-add popover
  prefilled with that window (no lane context: employee picker unfiltered, position blank).
- Adjacency is computed within the single **day-wide hourly status strip** (the strip is not
  per-lane/per-area); the merged range never crosses non-`under` hours.
- Pure helper `mergeUnderStaffedRange(hours, clickedHourMin)` in `src/lib` with tests.

## Accessibility

- Bars stay `<button>`s; popover editing is fully keyboard accessible (drag is an
  enhancement, not the only path — every drag outcome is achievable via popover time fields).
  Pointer-drag wiring must not intercept keyboard activation (Enter/Space still opens the
  popover; no keyboard trap is introduced by making a bar both click target and drag handle).
- Paint layer: lanes get a visually-hidden "Add shift to <lane> lane" button per lane as the
  keyboard entry to the quick-add popover.
- All new inputs labeled; conflict chips use text, not color alone. The popover owns exactly
  ONE `aria-live="polite"` region that coalesces all dynamic signals ("on shift" badge +
  async RPC conflict result + client warnings) into a single composed announcement, so a
  picker interaction never produces multiple disjoint announcements.

## Out of scope

- Recurring-series editing (stays in Scheduler ShiftDialog).
- Unifying the Scheduler's `ShiftDialog`/copy-DnD onto the shared pipeline (follow-up; the
  extraction makes it possible).
- Overtime/labor-budget gating (no such validation exists anywhere today).
- Multi-day timeline editing (timeline is single-day by design).

## Follow-ups flagged by design review (separate PRs)

- Pin `SET search_path = public, pg_temp` on `check_timeoff_conflict` /
  `check_availability_conflict` (and siblings) — pre-existing, defense-in-depth.
- `check_timeoff_conflict` takes only `p_employee_id` (no tenant scoping param) — pre-existing
  read-surface hardening candidate.
- Planner's host-local `ShiftInterval.create` convention for template-based creates.

## Decided trade-offs

- Overlap/clopen remain overridable warnings (planner parity), not hard errors.
- Per-candidate RPC availability badges in the picker are limited to the selected candidate to
  avoid an N×2-RPC storm on popover open.
- `useShiftPlanner`'s create path keeps host-local `ShiftInterval.create` semantics to avoid
  changing planner behavior in this PR; only the timeline uses the restaurant-TZ ISO path.
  (Pre-existing host-TZ convention in the planner is unchanged — flagged as follow-up.)

## Test plan

- `src/lib/shiftTimeMath.ts`: `minutesToIso` across DST transitions (America/Chicago Mar/Nov),
  overnight (minutes > 1440), TZ-portable fixtures (`new Date(y,m,d)` per lesson 2026-05-10);
  `snapToStep` edges. Must include the COMBINED case: overnight minutes > 1440 crossing a
  fall-back DST boundary (e.g. 23:00 start the night before the transition).
- `src/lib/shiftMutationPipeline.ts`: `collectShiftIssues` with injected conflict checker —
  warning aggregation, excludeShiftId, RPC conflict merge, locked rejection.
- `src/lib` gap-merge + picker-sort helpers: unit tests.
- `useValidatedShiftMutations`: hook tests (mocked mutations + DI'd checker) pinning the
  pending-confirmation contract for create/update/reassign, and that `useShiftPlanner`'s
  delegated API is byte-compatible (existing planner tests keep passing).
- TZ regression: `validateAndUpdateTime` under a host TZ ≠ restaurant TZ preserves the
  restaurant-local wall-clock (pins the `fromTimestamps`-not-`create` requirement).
- Component: quick-add popover renders three states (idle/warnings/saving); drag math helpers
  (pixel→minute mapping) are pure and unit-tested; E2E drag choreography is not covered
  (Playwright drag flake risk), popover-based create/edit path covered by an E2E smoke test.
