# Design: Manual Timeline Editor — overnight shift hours & display

**Date:** 2026-07-11
**Branch:** `fix/manual-timeline-overnight-hours`
**Type:** Bug fix (time-clock display + hours accuracy)

## Problem

On the Time Clock **Manual** view (Day mode), an employee who clocks out the
next day shows **0h** and is omitted from the view's "Total hours for <day>."
Concrete case (Rakiyah James, Jul 10): clock in 4:45 PM → clock out 12:37 AM
(Jul 11) → shows **0h** in Manual, while the same page's header reads
**"Today: 15.9 hours"** and the **Cards** view correctly shows
`4:45 PM → 12:37 AM, Total 7.85h`. The page contradicts itself.

This is the last surface not covered by PR #599: payroll, open-sessions,
timecard, dashboard, tips, and the page-level total / Cards / Stream / Receipt
all attribute overnight shifts to the clock-in day correctly. Only
`ManualTimelineEditor` computes its own hours per calendar day.

## Root cause

`src/components/time-tracking/ManualTimelineEditor.tsx`:

1. **Data:** it receives `existingPunches={windowPunches}` (TimePunchesManager
   L736) — the **day-windowed** set. The next-day clock-out is never passed in.
2. **Pairing:** its init effect pre-filters punches with
   `isSameDay(new Date(p.punch_time), date)` (L95-96) then pairs `clock_in`→next
   `clock_out` within that day. An overnight shift's clock-in is left unpaired
   (its clock-out is on the next calendar day), and the prior night's clock-out
   orphans into the current day.
3. **Render:** `getPositionFromTime` uses `time.getHours()` (L151), so a
   next-day clock-out (00:37 → ~0.6%) sits at the far left; block
   `width = endPos − startPos` (L714) goes **negative** → the block can't be
   drawn. (`getBlockDurationMinutes` uses `differenceInMinutes(end, start)`
   (L168), so the numeric duration is already correct once the block exists.)

## Approach

Attribute a shift to its **clock-in day** — consistent with the rest of the app
(and the Cards view the user confirmed is correct). Three coordinated changes,
all scoped to this component + one prop in TimePunchesManager.

### 1. Feed buffered punches
`TimePunchesManager` passes `existingPunches={filteredPunches}` (the ±18h
**buffered**, search-filtered set) to `ManualTimelineEditor` instead of
`windowPunches`. This makes the next-day clock-out available for pairing. (The
buffered fetch already exists from #599; `filteredPunches` is that set,
search-filtered.)

### 2. Pair across midnight, keep clock-in-day blocks (pure + testable)
Extract the block-building from the init effect into a pure function
`buildTimelineBlocks(employeePunches, date)` in a new
`src/utils/manualTimelineBlocks.ts`:
- Sort the employee's (buffered) punches; pair `clock_in`→next `clock_out`
  sequentially — **no `isSameDay` pre-filter** — so a clock-in pairs with its
  clock-out even across midnight.
- Keep only blocks whose **clock-in** (`startTime`) is on `date`
  (`isSameDay(startTime, date)`). This drops the prior night's tail (its
  clock-in was the previous day) and next-day shifts, attributing each shift
  once to the day it began.
- Returns the existing `TimeBlock[]` shape (unchanged: `startTime`, `endTime`,
  `clockInPunchId`, `clockOutPunchId`, `isImported`, …), so downstream render /
  drag / save code is untouched.

The init effect calls this helper; `totalHours` (already
`Σ getBlockDurationMinutes/60`) then includes the full cross-midnight shift.
Rakiyah → 7.85h; the Manual footer now matches the header.

### 3. Render the cross-midnight block (clip + tag)
In the block render (L712-734):
- `endPos`: when `!isSameDay(block.endTime, date)` (block crosses midnight),
  clamp the end position to `100` (right edge) so `width = 100 − startPos`
  (never negative). Non-crossing blocks are unchanged.
- Add a small end-of-bar marker/label `↳ h:mm a +1d` (e.g. "↳ 12:37 AM +1d")
  so the manager sees where it actually ends. The bar's duration label / total
  keeps using the real times (correct 7h52m).

### 4. Drag-edit safety
The drag handlers (`getTimeFromPosition`, resize/move) map canvas position →
same-day time and cannot represent a next-day boundary. For a cross-midnight
block:
- Disable the **right-edge (clock-out) resize handle** and whole-block drag;
  keep it visually distinct (the clipped bar + tag). Editing its clock-out is
  done via the **Punch List** (or the next day's view). Creating/editing
  same-day blocks is unchanged.
This prevents the editor from writing an incorrect same-day clock-out over a
real next-day punch.

## Not changing
- The page-level total / Open-Sessions / Cards / Stream / Receipt (already
  correct via #599's `windowSessions`).
- Drag-to-create for same-day blocks; the save/mutation path.
- The 24h canvas extent (a "business-day" extended canvas — showing the full
  overnight bar past midnight — is a deliberate follow-up, not this fix).

## Testing
- **Unit** (`tests/unit/manualTimelineBlocks.test.ts`): `buildTimelineBlocks`
  - overnight shift (clock-in `date`, clock-out next day) → one block, full
    duration, attributed to `date`;
  - prior-night tail (clock-out on `date`, clock-in previous day) → excluded;
  - normal same-day shifts, breaks/split shifts → unchanged vs current output;
  - a shift that starts next day → excluded.
- **E2E** (extend `tests/e2e/overnight-shift-hours.spec.ts`): reuse the Rakiyah
  repro — Manual view shows her block ~7.85h and the Manual footer equals the
  page header total (no more 15.9h vs 8h1m split).
- Existing suite stays green.

## Design-review resolutions (Phase 2.5, folded in)

- **Block body swallows clicks (major).** Only the 2px edge handles
  `stopPropagation`; a click on a block's *body* bubbles to the timeline
  container's create-new-block handler (L696). For cross-midnight blocks the
  clipped bar is a large target, so add `onPointerDown={e => e.stopPropagation()}`
  to cross-midnight block bodies AND gate the right-edge handle's *handler* out
  entirely (no-op) when the block crosses midnight — not just visually.
- **Sliver + marker overlap (major).** A late-night start (11:50 PM) clamps to
  ~0.7% width. Enforce a `MIN_CROSS_MIDNIGHT_WIDTH_PCT` floor for clipped blocks,
  and position the "+1d" marker inside the bar with a z-index/max-right offset so
  it never overlaps the trailing `w-32` Hours column (container has no
  `overflow-hidden`).
- **Expanded Block List (major).** L850-910 also lists these blocks as
  `h:mm a → h:mm a` with no date qualifier and an enabled Delete. Add a "+1d"
  suffix to the end time there for cross-midnight rows. **Delete stays enabled** —
  removing a whole shift (both punches) is a legitimate action and is not the
  "wrong same-day clock-out" corruption the canvas rail guards against.
- **Minors:** move `getImportSource` into `manualTimelineBlocks.ts` (keep the
  dependency direction util→types, never util→component); use
  `isWithinWindow(startTime, startOfDay(date), endOfDay(date))` from
  `punchWindow.ts` for the clock-in-day filter (reuse the centralized attribution
  rule, not a fresh `isSameDay`); give the disabled right handle
  `cursor-not-allowed` + a `title` pointing to the Punch List; the "+1d" marker
  uses semantic tokens (`text-muted-foreground`/`bg-muted`) and an
  `aria-label="Ends h:mm a the next day"`.
- **Noted, not fixed (pre-existing, out of scope):** the component has no
  `error` state (only `loading`).

## Decided trade-offs
- **Clip + tag** display (not an extended "business-day" canvas): correct total
  immediately, minimal risk to the drag editor. Extended canvas is a follow-up.
- **Cross-midnight blocks are view-only on the canvas** (edit clock-out via the
  Punch List): avoids the drag math producing wrong next-day times. A full
  cross-midnight drag editor is out of scope.
