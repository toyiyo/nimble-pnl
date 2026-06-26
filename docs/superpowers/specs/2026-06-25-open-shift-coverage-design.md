# Design: Coverage-based "needs staff" (open-shift) calculation

**Date:** 2026-06-25
**Branch:** `fix/open-shift-coverage`
**Status:** Design — revised after Phase 2.5 review

## Problem

The scheduling "X shifts still need staff" banner, the publish-dialog count, and the
`get_open_shifts` claiming RPC all decide a template slot is unstaffed by **exact-matching**
shifts to templates (same start+end+position, or `shift_template_id`). Real schedules use
mid-shift fill-ins and custom time windows that never exactly match a template, so covered
slots are reported as needing staff and (if open-shift claiming is enabled) offered to
employees who are already on the floor.

### Confirmed root cause (prod, Wetzel's–Cold Stone, rid `7c0c76e3…`, week 2026-06-22)

- "Open shifts" are virtual: `openShiftCount = Σ over active templates of max(0, capacity − exact-match count)`.
- Client: `Scheduling.tsx:531` → `buildTemplateGridData` (`useShiftPlanner.ts:122`) → `findMatchingTemplate` exact match (`:99`) → `computeOpenSpots` (`openShiftHelpers.ts:19`).
- Server: `get_open_shifts` RPC (`20260529120000_fix_open_shifts_capacity_one.sql`), `assigned` CTE counts only shifts whose local window **exactly equals** the template's; ignores `shift_template_id`.
- Evidence: Mon 6/22 & Tue 6/23 show 0 matched on every slot, yet 8/8/5 and 7/7/5 people are actually working those windows; 50 of 109 shifts match no template; 66 slots − 42 template-linked = **24 phantom "needs staff."**

## Goal

Replace exact-match with **time-coverage**: a slot is staffed only when, at every minute of its
window, at least `capacity` same-position people are working. Surface coverage in the planner
(who is covering, what % is covered, where the gaps are). One coverage definition, identical in
TypeScript and SQL, shared across the count, the planner, and every claim RPC.

## Coverage model (the one definition)

For a template **slot** = (window `[W0, W1]`, `capacity C`, `position P`) on date `D`:

1. **Candidate shifts** = non-cancelled shifts on `D` with `position = P` whose local interval
   overlaps `[W0, W1]`, evaluated in the **restaurant's IANA timezone** (`restaurants.timezone`).
2. **Concurrent headcount** `n(t)` = number of **distinct employees** present at instant `t` in
   `[W0, W1]` (`COUNT(DISTINCT employee_id)` — one person with two overlapping shifts = 1).
3. `minConcurrent = min over t∈[W0,W1] of n(t)`, including leading/trailing/interior stretches
   with no shift (`n=0`).
4. **`openSpots(slot, D) = max(0, capacityFloor(C) − minConcurrent)`**, where `capacityFloor`
   coerces `0 / NaN / < 1 → 1` (TS: explicit guard; SQL: `GREATEST(1, capacity)`).
5. **Banner / publish "needs staff"** = `Σ openSpots` over (active template, applicable day in week).
6. **Planner display**: `coveragePct` = minutes where `n(t) ≥ C` over `(W1 − W0)`; `segments` =
   covered vs gap sub-intervals; `coveringEmployees` = each employee + clipped interval.

User's example: 4h window, capacity 1, one person 1h + another 3h whose intervals union the
window → `minConcurrent=1` → 0 open, 100%. Both in the same hour (2h gap) → `minConcurrent=0` → needs staff.

### Algorithm (sweep line — shared by TS and SQL)

Clip each candidate shift to `[max(W0,s0), min(W1,s1)]`. Breakpoints
`B = sorted distinct({W0, W1} ∪ clip_starts ∪ clip_ends)` — **`W0`/`W1` are seeded
unconditionally** (so an empty shift set still yields the full-window `n=0` interval). For each
consecutive pair `[b_k, b_{k+1})` with `b_{k+1} > b_k`, `n_k = COUNT(DISTINCT employee_id)` of
clipped shifts with `clip_start ≤ b_k AND clip_end > b_k`. Then `minConcurrent = min_k n_k`;
`coveredMinutes = Σ (b_{k+1}−b_k) where n_k ≥ C`. `COUNT(DISTINCT)` per sub-interval gives the
one-person-two-shifts dedup for free.

### Timezone & overnight

- All math in restaurant-local **minutes-from-`D`-midnight**. Template times are local `time`;
  shifts convert via `AT TIME ZONE v_tz` (SQL) / `date-fns-tz` `toZonedTime` (TS).
- Overnight (lesson 2026-05-18): when a window or a clipped shift has `end ≤ start`, add **1440**
  to the end before building breakpoints. Both TS and SQL do this identically. (Wetzel's has none;
  latest close is 23:30 same-day.)
- **TS input convention:** `shiftCoverage.ts` receives shifts as UTC `Date`/ISO from Supabase plus
  the restaurant `tz`; it converts to local minutes internally (never reads host-TZ fields).
- **v1 limitation (documented):** a shift starting the *previous* calendar day that bleeds into
  `D`'s early window is not counted for `D` (candidates are keyed on `D`). No such data today.

### Decided trade-offs

- **Distinct employees, not rows** — capacity is headcount.
- **Position must match** — a dishwasher must not "cover" a server slot (all Wetzel's data is "Server", so moot there).
- **Area is NOT used** — `shifts` has no `area` column (only `employees`/`shift_templates` do).
  Duplicate same-window templates (`Open-week-csc` + `Open-week-wtz`) are each evaluated against the
  same overlapping shifts; on partial fills this may *under*-report open spots (safe direction — never
  offers a covered shift). Supersedes the original "area-aware matching" idea (impossible without a shift-level area).
- **`pending_claims` stays template-scoped** and is subtracted after coverage:
  `openSpots = max(0, GREATEST(1,capacity) − minConcurrent − pending)`. On a partial-coverage slot with
  a pending claim, this can leave `openSpots` slightly conservative (safe direction). Tested explicitly.

## Architecture

```text
                    ┌──────────────────────────────────────────────┐
                    │  src/lib/shiftCoverage.ts   (pure, NEW)       │
                    │  computeSlotCoverage(window, C, shifts, tz)   │
                    │   → { minConcurrent, openSpots, coveragePct,  │
                    │       segments, coveringEmployees }           │
                    └───────────────┬──────────────────────────────┘
       ┌────────────────────────────┼─────────────────────────────────┐
       ▼                            ▼                                  ▼
 A. Scheduling.tsx          B. ShiftPlannerTab → ShiftCell       mirrored in SQL
    openShiftCount =           per-cell compact %+bar;         ┌─────────────────────────────┐
    Σ openSpots (drop          ONE lifted CoveragePopover/     │ public.shift_slot_min_       │
    buildTemplateGridData      Drawer at grid level            │   concurrent(...) (NEW)      │
    + computeOpenSpots here)                                   │  sweep → int                 │
                                                               └──────┬──────────────┬────────┘
                                                                      ▼              ▼
                                                              C. get_open_shifts   claim_open_shift
                                                                 open_spots=…        guard uses same fn
```

`buildTemplateGridData` is unchanged (it still does shift **placement** — which card renders in
which cell). Coverage is computed separately, so a fill-in placed under a different template row
still counts toward this slot's coverage.

### Files

| File | Change |
|---|---|
| `src/lib/shiftCoverage.ts` | **NEW** pure engine (clip/sweep/min-concurrent, `coveragePct`, `segments`, `coveringEmployees`); restaurant-TZ + overnight; `capacityFloor`; reuse `formatCompactTime` from `openShiftHelpers`. |
| `src/pages/Scheduling.tsx` | `openShiftCount` (`:531`) calls the engine with `restaurantTimezone` (`:175` — **confirm it's in scope at the memo; thread it if not**); drop the `buildTemplateGridData`+`computeOpenSpots` path here. |
| `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` | ONE `useMemo` → `Map<templateId, Map<day, SlotCoverage>>` keyed on `[shifts, templates, weekDays, restaurantTimezone]`; pass as a single stable prop; per-slot `try/catch` → `null` (one bad row never blanks the grid). Own the single `CoveragePopover` (desktop) / `Drawer` (mobile) state `{templateId, day}`; follow the existing `AssignmentPopover` precedent. `CoverageStrip` (day-level summary) is untouched. |
| `src/components/scheduling/ShiftPlanner/ShiftCell.tsx` | Replace `classifyCapacity(capacity, shifts.length)` with coverage status from the passed `SlotCoverage`. Compact indicator = a `<button>` (not div) `text-[11px]`, semantic tokens only (`text-destructive`/`bg-destructive/10` for gap, `text-foreground`/`muted` for covered — no raw `emerald/amber/red`), with `aria-label="Coverage: 47% — gap 7:30–11:30 pm. Open details"`, `aria-expanded`/`aria-controls` via the trigger, a non-color cue (icon/`%` text) + `sr-only` summary. Fires `onCoverageClick(templateId, day)` (with `stopPropagation` so mobile tap-to-assign doesn't also fire). Add `coverage` to the `React.memo` comparator. Suppress the indicator when `coveragePct===100 && placedShifts≤1` (noise reduction). |
| `src/lib/openShiftHelpers.ts` | Keep `formatCompactTime`; extract `capacityFloor`. Remove `computeOpenSpots`/`classifyCapacity` only after grep confirms the sole callers (`Scheduling.tsx:55`, `ShiftCell.tsx:5/99`) are migrated. |
| `supabase/migrations/<ts>_open_shift_coverage.sql` | **NEW** `public.shift_slot_min_concurrent(restaurant_id, position, date, w_start time, w_end time, tz)` → `int` (`STABLE SECURITY DEFINER SET search_path=public`); rewrite `get_open_shifts` `assigned`→this fn (`COUNT(DISTINCT)`, `GREATEST(1,capacity)`), preserve `SECURITY DEFINER/STABLE/search_path`, the `open_shifts_enabled` gate, `published_dates` future filter, `capacity>0`, per-(template,date) shape, `pending` subtraction, and re-issue `GRANT EXECUTE`; rewrite `claim_open_shift` `v_assigned_count`→the same fn so its guard `assigned+pending >= GREATEST(1,capacity)` matches. Comment why `STABLE` is correct (read-only; `CURRENT_DATE` stable per stmt). |
| `supabase/migrations/<ts2>_idx_shifts_coverage.sql` | **NEW** separate migration: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_restaurant_start_status ON public.shifts(restaurant_id, start_time, status)` (the sweep filters restaurant+time+status). Separate file because `CONCURRENTLY` cannot run in a txn. |
| `src/types/scheduling.ts` | `SlotCoverage` + `CoveringEmployee` types. |

`approve_open_shift_claim` has **no** capacity guard today (pre-existing) and is left as-is;
adding a coverage re-check there is noted as a possible follow-up, out of scope here.

## Testing

- `tests/unit/shiftCoverage.test.ts` (NEW): mid-shift fill-in counts toward open window; the
  1h+3h=covered example; early-leave gap (`minConcurrent < C`, correct `coveragePct` + segment
  bounds); capacity>1; distinct-employee dedup (one person, two overlapping shifts = 1);
  `capacityFloor` 0/NaN→1; overnight window; **TZ-portable** under `TZ=UTC`/`America/Los_Angeles`/
  `Asia/Tokyo`, anchored with `new Date(y,m,d)` (lesson 2026-05-10). Branch-count aware (lesson 2026-05-24).
- `supabase/tests/open_shift_coverage.test.sql` (NEW pgTAP): **dates from `CURRENT_DATE`** (lesson
  2026-04-21); deterministic fixture (RLS off in-txn, delete-before-insert FK order, `ON CONFLICT
  DO UPDATE` — lesson 2026-04-22). **Non-tautological:** the fill-in's window must *not* equal the
  template's (e.g. starts before `W0`, ends after `W1`) so the old exact-match would count 0 — assert
  `open_spots` 0; a separate early-leave fixture asserts `open_spots > 0`; a partial-coverage + pending
  fixture asserts the conservative subtraction; `claim_open_shift` rejects on a coverage-full slot.
- Update `useShiftPlanner.test.ts`, `Scheduling*` tests, `open_shifts_capacity_one.test.sql`,
  `open_shift_claim_timezone.test.sql` to the coverage semantics; keep green.

## Out of scope

- No production template data changes (`open_shifts_enabled` stays false; user decision).
- `buildTemplateGridData` placement unchanged; `CoverageStrip` unchanged.
- `approve_open_shift_claim` capacity re-check; prior-calendar-day overnight carryover (documented).

## Phase 2.5 review resolutions (folded)

- **SQL** — `COUNT(DISTINCT employee_id)` (crit); shared `shift_slot_min_concurrent` so `claim_open_shift`
  guard matches `get_open_shifts` (crit, double-claim); overnight `+1440` clip (crit); seed `{W0,W1}`
  breakpoints (maj); `GREATEST(1,capacity)` (maj); composite index in its own `CONCURRENTLY` migration
  (maj/min); `pending` asymmetry documented + tested (maj); non-tautological fill-in fixture (maj);
  `STABLE` comment + `GRANT` re-issue (min); RLS unaffected (SECURITY DEFINER; `shifts` keeps restaurant-scoped RLS).
- **Frontend** — single lifted popover + mobile `Drawer` (crit, Single Dialog Pattern); accessible
  `<button>` trigger with `aria-*` + non-color cue + `sr-only` (crit, WCAG 1.4.1); tab-level `useMemo`
  Map + `memo` comparator includes `coverage` (maj); semantic tokens only (maj); `restaurantTimezone`
  threaded/confirmed at the count site (maj); per-slot `try/catch` + grid already hides while loading (maj);
  `text-[11px]` + reuse `formatCompactTime` + lock `Popover` primitive (min); `CoverageStrip` is separate (min);
  popover labelled "Covering employees for this slot" + suppress at 100%/single (min UX).
