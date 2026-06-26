# Planner Coverage Area-Scope Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). Steps use `- [ ]`.

**Goal:** Make the planner per-cell coverage indicator visible and meaningful again — area-scope each cell's coverage and stop suppressing fully-covered cells. (PR #552 regression fix.)

**Architecture:** Opt-in `area` filter on the shared `computeSlotCoverage` (banner/SQL unchanged); planner derives each shift's area from its employee and passes the template's area; `ShiftCell` always shows the indicator with a two-tier (quiet full / prominent under-covered) treatment.

**Reference spec:** `docs/superpowers/specs/2026-06-26-planner-coverage-area-scope-design.md`

---

## Task 1: Engine — `CoverageShift.area` + opt-in area filter

**Files:** `src/types/scheduling.ts`, `src/lib/shiftCoverage.ts`, `tests/unit/shiftCoverage.test.ts`

- [ ] **Step 1 — Failing tests** (append to `tests/unit/shiftCoverage.test.ts`):

```ts
describe('computeSlotCoverage — area scope (opt-in)', () => {
  const tz = 'America/Chicago'; const D = '2026-06-27';
  const mkA = (emp: string, s: string, e: string, area: string | null) =>
    ({ employee_id: emp, employee_name: emp, start_time: s, end_time: e, position: 'Server', status: 'scheduled', area });

  it('counts only same-area shifts when options.area is set', () => {
    const shifts = [
      mkA('CS1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', 'Cold Stone'), // 10:00-16:30
      mkA('WZ1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', "Wetzel's"),
    ];
    const c = computeSlotCoverage('10:00:00', '16:30:00', 1, D, shifts, 'Server', tz, { area: 'Cold Stone' });
    expect(c.coveringEmployees.map(e => e.employeeId)).toEqual(['CS1']); // WZ1 excluded
    expect(c.openSpots).toBe(0);
  });

  it('no area filter when options omitted (back-compat) — counts both areas', () => {
    const shifts = [
      mkA('CS1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', 'Cold Stone'),
      mkA('WZ1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', "Wetzel's"),
    ];
    const c = computeSlotCoverage('10:00:00', '16:30:00', 2, D, shifts, 'Server', tz);
    expect(c.coveringEmployees.length).toBe(2);
  });

  it('options.area null/undefined ⇒ no filter (template with no area)', () => {
    const shifts = [mkA('X', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', 'Cold Stone')];
    expect(computeSlotCoverage('10:00:00','16:30:00',1,D,shifts,'Server',tz,{ area: null }).openSpots).toBe(0);
  });

  it('same-area half-shift fill-in ⇒ partial coverage + gap segment', () => {
    // cap 1, window 16:00-22:30; one Cold Stone person leaves at 19:30 → gap
    const shifts = [mkA('CS1', '2026-06-27T21:00:00Z', '2026-06-28T00:30:00Z', 'Cold Stone')]; // 16:00-19:30
    const c = computeSlotCoverage('16:00:00', '22:30:00', 1, D, shifts, 'Server', tz, { area: 'Cold Stone' });
    expect(c.openSpots).toBe(1);
    expect(c.coveragePct).toBeLessThan(100);
    expect(c.segments.some(s => !s.covered)).toBe(true);
  });
});
```

- [ ] **Step 2 — Run, expect FAIL** (`area` not on type / not filtered).
  `npx vitest run tests/unit/shiftCoverage.test.ts`
- [ ] **Step 3 — Implement.**
  - `src/types/scheduling.ts`: add `area?: string | null;` to `CoverageShift`.
  - `src/lib/shiftCoverage.ts`: change signature to `computeSlotCoverage(windowStart, windowEnd, capacity, dateStr, shifts, position, tz, options?: { area?: string | null })`. In the shift filter, after the `position` check add: `if (options?.area != null && s.area !== options.area) continue;` (use `!= null` only here is prohibited by ocr rules → write `if (options && options.area !== undefined && options.area !== null && s.area !== options.area) continue;`).
- [ ] **Step 4 — Run, expect PASS** under `TZ=UTC`, `America/Los_Angeles`, `Asia/Tokyo`.
- [ ] **Step 5 — Commit** `feat(scheduling): opt-in area filter on computeSlotCoverage`.

## Task 2: Planner — derive shift area from employee + thread template area

**Files:** `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

- [ ] **Step 1 — Implement** `coverageByTemplateDay` (~:133):
  - Build `const empArea = new Map(employees.map(e => [e.id, e.area ?? null]));` (or reuse an existing map).
  - In the `cov` map, add `area: empArea.get(s.employee_id) ?? null`.
  - Call `computeSlotCoverage(t.start_time, t.end_time, t.capacity ?? 1, day, cov, t.position, restaurantTimezone, { area: t.area ?? null })`.
  - **Add `employees` to the dep array**: `[shifts, templates, weekDays, restaurantTimezone, employees]`.
  - Update `coverageSlotLabel` (~:500) to prepend `t.area` when set; append `(all areas)` when null.
  - Thread a concise `slotName = ${t.area ? t.area + ' ' : ''}${t.position}` to `ShiftCell` (new optional prop) for the aria-label.
- [ ] **Step 2 — Wiring test** (`tests/unit/shiftPlannerCoverageWiring.test.ts`): source-text assert `employees` is in the coverage memo deps and `t.area` (or `area:`) is passed to `computeSlotCoverage`.
- [ ] **Step 3 — Run** `npx vitest run tests/unit/shiftPlannerCoverageWiring.test.ts && npm run typecheck`.
- [ ] **Step 4 — Commit** `fix(planner): area-scope cell coverage via employee area`.

## Task 3: ShiftCell — always show, two-tier indicator, slot-aware aria-label

**Files:** `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`, `tests/unit/shiftCellCoverageIndicator.test.tsx`

- [ ] **Step 1 — Update tests** (`shiftCellCoverageIndicator.test.tsx`): replace the "suppressed at 100%" cases with:
  - fully-covered cell (coveragePct 100, openSpots 0, shifts≥1) **renders** the indicator (a `Check`/CheckCircle icon, `N/N`, `text-muted-foreground`, no progress bar).
  - under-covered cell (openSpots>0) renders `AlertTriangle` + `text-destructive` + `needs N` + bar.
  - `aria-label` contains the day + `of <capacity>` (slot identity), not a bare `Coverage 100%`.
  - source-text: no raw color classes; `showCoverageIndicator` no longer references `coveragePct === 100`.
- [ ] **Step 2 — Run, expect FAIL.** `npx vitest run tests/unit/shiftCellCoverageIndicator.test.tsx`
- [ ] **Step 3 — Implement** ShiftCell (~:96–172):
  - `const showCoverageIndicator = coverage !== undefined;`
  - Branch render on `coverage.openSpots > 0`: prominent (AlertTriangle, text-destructive, bar, "needs N") vs quiet (`Check` icon aria-hidden, `text-[10px] text-muted-foreground`, `${capacity - coverage.openSpots}/${capacity}`, no bar).
  - `aria-label` = `${slotName ?? 'Coverage'} ${day}: ${capacity - coverage.openSpots} of ${capacity} staffed${coverage.openSpots > 0 ? `, needs ${coverage.openSpots} more` : ''}. Open details`.
  - Import `Check` from lucide-react. Keep memo comparator (already compares `coverage`; add `slotName` if added).
- [ ] **Step 4 — Run, expect PASS** + `npm run typecheck`.
- [ ] **Step 5 — Commit** `fix(planner): always show coverage indicator with two-tier treatment`.

## Task 4: CoverageDetail — a11y polish

**Files:** `src/components/scheduling/ShiftPlanner/CoverageDetail.tsx`

- [ ] **Step 1 — Implement**: remove `role="status"` from the static gap rows (keep `aria-label`). (Heading area handled by Task 2's `coverageSlotLabel`.)
- [ ] **Step 2 — Run** `npx vitest run tests/unit/CoverageDetail.test.tsx` (update any role assertion).
- [ ] **Step 3 — Commit** `fix(planner): drop role=status on static coverage gap rows`.

## Self-review

- Spec coverage: area filter (T1), planner threading + deps + label (T2), always-show two-tier + aria (T3), a11y (T4) — every spec row mapped.
- Back-compat: banner (`Scheduling.tsx`) + SQL untouched (no `options` passed). Engine default behavior unchanged when `options` omitted (T1 back-compat test pins this).
- Types: `computeSlotCoverage` options bag `{ area?: string | null }` identical at all call sites.
