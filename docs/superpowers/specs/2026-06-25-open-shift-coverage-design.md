# Design: Coverage-based "needs staff" (open-shift) calculation

**Date:** 2026-06-25
**Branch:** `fix/open-shift-coverage`
**Status:** Design — pending review

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
- Server: `get_open_shifts` RPC (`20260529120000_fix_open_shifts_capacity_one.sql`), `assigned` CTE counts only shifts whose local time window **exactly equals** the template's; ignores `shift_template_id`.
- Evidence: Mon 6/22 & Tue 6/23 show 0 matched on every slot, yet 8/8/5 and 7/7/5 people are actually working those windows; 50 of 109 shifts match no template; 66 slots − 42 template-linked = **24 phantom "needs staff."**

## Goal

Replace exact-match with **time-coverage** so a slot is "staffed" only when, at every minute
of its window, at least `capacity` same-position people are working. Surface coverage in the
planner (who is covering and what % of the window is covered). One coverage definition,
identical in TypeScript and SQL.

## Coverage model (the one definition)

For a template **slot** = (window `[W0, W1]`, `capacity C`, `position P`) on a specific date `D`:

1. **Candidate shifts** = non-cancelled shifts on `D` with `position = P` whose local-time
   interval overlaps `[W0, W1]`. Evaluated in the **restaurant's IANA timezone**
   (`restaurants.timezone`), not the viewer's browser TZ.
2. **Concurrent headcount** `n(t)` = number of **distinct employees** present at instant `t`
   within `[W0, W1]`. (Distinct-employee, so one person with two overlapping shifts counts once.)
3. `minConcurrent = min over t∈[W0,W1] of n(t)` — including the leading/trailing/interior
   stretches where no shift is present (`n=0`).
4. **`openSpots(slot, D) = max(0, capacityFloor(C) − minConcurrent)`**, where
   `capacityFloor` coerces `0 / NaN / < 1 → 1` (guards legacy rows; DB enforces
   `CHECK (capacity >= 1)` only on new writes).
5. **Banner / publish "needs staff"** = `Σ openSpots` over every (active template, applicable
   day in the visible week).
6. **For the planner display**:
   - `coveragePct` = (minutes where `n(t) ≥ C`) / `(W1 − W0)`.
   - `segments` = covered vs. gap sub-intervals (where `n(t) < C`).
   - `coveringEmployees` = each contributing employee with their clipped interval.

This matches the user's example: a 4h window with capacity 1 covered by one person for 1h and
another for 3h whose intervals union the window → `minConcurrent = 1` → 0 open, 100% covered.
If both worked the same hour (2h gap) → `minConcurrent = 0` → needs staff.

### Algorithm (sweep line, shared by TS and SQL)

Breakpoints `B = sorted distinct({W0, W1} ∪ {clip_start_i} ∪ {clip_end_i})` where each shift is
clipped to `[max(W0,s0), min(W1,s1)]`. For each consecutive pair `[b_k, b_{k+1})` with
`b_{k+1} > b_k`, `n_k = COUNT(DISTINCT employee_id)` of clipped shifts with
`clip_start ≤ b_k AND clip_end > b_k`. Then `minConcurrent = min_k n_k`,
`coveredMinutes = Σ (b_{k+1}−b_k) where n_k ≥ C`. `COUNT(DISTINCT employee_id)` per sub-interval
makes the one-person-two-shifts case fall out for free (no explicit interval merge).

### Timezone & overnight

- All comparisons in restaurant-local minutes-of-day. Template times are stored as local `time`
  strings; shift timestamps are converted via `AT TIME ZONE` (SQL) / `date-fns-tz` (TS).
- Overnight handling (lesson 2026-05-18): when a window/shift has `end ≤ start`, treat it as
  crossing midnight by adding 1440 to `end` and doing absolute-minute math. Wetzel's current data
  has no overnight shifts (latest close 23:30), but the helper handles it generally.
- **Known v1 limitation (documented):** a shift that starts the *previous* calendar day and bleeds
  into day `D`'s early window is not counted for `D` (we key candidate shifts on `D`). No such data
  exists today; called out for a follow-up if overnight scheduling lands.

### Decided trade-offs

- **Distinct employees, not shift rows** — capacity is headcount; a split shift by one person is one body.
- **Position must match** (`template.position == shift.position`). Preserves the existing dimension; all
  Wetzel's data is "Server" so it is moot there, but a dishwasher must not "cover" a server slot.
- **Area is NOT used.** The `shifts` table has no `area` column (only `employees`/`shift_templates`
  do). Duplicate same-window templates (e.g. `Open-week-csc` + `Open-week-wtz`, identical window) are
  each evaluated independently against the same overlapping shifts; on partial fills this can *under*-
  report open spots (safe direction — never offers a covered shift). This supersedes the original
  "area-aware matching" idea, which is impossible without a shift-level area.

## Architecture

```text
                         ┌─────────────────────────────────────────┐
                         │  src/lib/shiftCoverage.ts  (pure, NEW)   │
                         │  computeSlotCoverage(window,C,shifts,tz) │
                         │   → { minConcurrent, openSpots,          │
                         │       coveragePct, segments,             │
                         │       coveringEmployees }                │
                         └───────────────┬─────────────────────────┘
        ┌────────────────────────────────┼───────────────────────────────┐
        ▼                                 ▼                               ▼
  A. Scheduling.tsx                 B. ShiftPlannerTab/ShiftCell    (mirror in SQL)
     openShiftCount = Σ openSpots      compact %+bar; popover =     C. get_open_shifts RPC
     (replaces buildTemplateGridData     who/when/gaps               openSpots via sweep;
      + computeOpenSpots path)                                       offer slot iff > 0
```

`buildTemplateGridData` stays as-is for **shift placement** (which card renders in which cell).
The coverage indicator/popover is computed separately by the engine, so a fill-in placed under a
different template row still counts toward this slot's coverage.

### Files

| File | Change |
|---|---|
| `src/lib/shiftCoverage.ts` | **NEW** pure engine: clip/sweep/min-concurrent, coverage %, segments, covering employees. Restaurant-TZ + overnight aware. |
| `src/pages/Scheduling.tsx` | `openShiftCount` uses the engine with `restaurantTimezone` (already computed at `:175`); drop the `buildTemplateGridData`+`computeOpenSpots` path here. |
| `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` | Compute per-cell coverage via engine (memoized), pass to `ShiftCell`. |
| `src/components/scheduling/ShiftPlanner/ShiftCell.tsx` | Replace `classifyCapacity(capacity, shifts.length)` with coverage-based status; render compact `% + bar`; popover (hover/click) with covering employees + gap segments. |
| `src/lib/openShiftHelpers.ts` | Keep `formatCompactTime`/`capacityFloor`; remove now-dead `computeOpenSpots`/`classifyCapacity` only if no remaining importers (grep-verified). |
| `supabase/migrations/<ts>_open_shifts_coverage.sql` | Rewrite `get_open_shifts` `assigned`→min-concurrent sweep; `open_spots = max(0, capacity − minConcurrent − pending)`. Preserve `SECURITY DEFINER`, `STABLE`, `SET search_path=public`, the `open_shifts_enabled` gate, the published+future-date filter, and the per-(template,date) row shape (claiming needs `template_id`). |
| `src/types/scheduling.ts` | Coverage result types if shared. |

`claim_open_shift` is unchanged: its guard `assigned + pending >= capacity` stays consistent because
the RPC still emits per-(template,date) rows with an `open_spots > 0` filter.

## Testing

- `tests/unit/shiftCoverage.test.ts` (NEW): the 12–5 mid-shift fill-in regression (counts toward
  open window); the user's 1h+3h=covered example; an early-leave gap (`minConcurrent < C`); capacity
  > 1; distinct-employee dedup (one person, two overlapping shifts = 1); `capacityFloor` for 0/NaN;
  overnight window; restaurant-TZ correctness under `TZ=UTC`, `America/Los_Angeles`, `Asia/Tokyo`
  (anchor with `new Date(y,m,d)` per lesson 2026-05-10); coverage % + segment boundaries.
- `tests/unit/Scheduling*.test` and `useShiftPlanner.test.ts`: keep green; update banner-count
  expectations to coverage-based.
- `supabase/tests/open_shifts_coverage.test.sql` (NEW pgTAP): seed a published template + an
  overlapping mid-shift fill-in; assert `open_spots` drops to 0 (was > 0 under exact-match); assert
  an early-leave gap still reports `open_spots > 0`. **Dates computed from `CURRENT_DATE`** (lesson
  2026-04-21 — the RPC filters to future dates). Deterministic fixture: RLS off in-txn,
  delete-before-insert FK order, `ON CONFLICT DO UPDATE` (lesson 2026-04-22).
- Existing `open_shifts_capacity_one.test.sql` / `open_shift_claim_timezone.test.sql`: update to the
  coverage semantics, keep green.

## Out of scope

- No changes to production template data (`open_shifts_enabled` stays false; user decision).
- `buildTemplateGridData` shift *placement* logic is unchanged.
- Prior-calendar-day overnight carryover into an early window (documented limitation above).
- Concurrent-headcount is computed per slot independently; cross-slot optimization is unneeded.

## Decided / open questions for review

- SQL min-concurrent sweep performance: slot and shift counts per restaurant-week are small
  (≤ ~100 shifts, ≤ ~10 templates × 7 days); O(shifts²) per slot is acceptable. Reviewer: confirm.
- Popover interaction must be keyboard-accessible (focusable trigger, Esc to close) — Phase 5 / a11y.
