# Per-area Coverage + Demand Legibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Split the Timeline coverage panel per brand `area` (coverage-only) and make demand self-explaining — a "how is needed set?" popover plus `have/needed` cells.

**Architecture:** New pure `summarizeAreaCoverage` (reuses `computeDayCoverage` + `summarizeCoverageHours`) feeds a per-area `AreaCoverageStrips`; a `CoverageDemandInfo` popover explains demand; `CoverageStatusStrip` cells show `have/needed`. Wired into `ShiftTimelineTab` (per-area strips only when `groupBy === 'area'`).

**Tech Stack:** React 18 + TS, Vitest, Tailwind, shadcn `Popover`, SVG/flex.

**Spec:** `docs/superpowers/specs/2026-07-03-timeline-area-coverage-design.md`

**Conventions:** semantic tokens + CLAUDE.md type scale; core-logic tests get the `CRITICAL:` prefix; `npm run test -- <file>` for one suite; TZ-portable model tests run under UTC + Asia/Tokyo.

---

## Task 1: `summarizeAreaCoverage` pure helper

**Files:**
- Modify: `src/lib/coverageSummary.ts`
- Modify: `tests/unit/coverageSummary.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import { summarizeAreaCoverage } from '@/lib/coverageSummary';
import type { Shift, Employee } from '@/types/scheduling';

const emp = (id: string, area: string): Employee =>
  ({ id, restaurant_id: 'r', name: id, area, position: 'Server' } as Employee);
const shiftFor = (id: string, eid: string, start: string, end: string): Shift =>
  ({ id, restaurant_id: 'r', employee_id: eid, start_time: start, end_time: end, break_duration: 0,
     position: 'Server', status: 'scheduled', is_published: false, source: 'manual',
     locked: false, created_at: '', updated_at: '' } as Shift);

describe('summarizeAreaCoverage', () => {
  const employees = [emp('a', 'Cold Stone'), emp('b', "Wetzel's")];
  const win = { startMin: 600, endMin: 720 }; // 10:00–12:00 CT
  const shifts = [
    shiftFor('s1', 'a', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'), // Cold Stone 10–13 CT
    shiftFor('s2', 'b', '2026-07-11T16:00:00Z', '2026-07-11T19:00:00Z'), // Wetzel's 11–14 CT
  ];

  it('CRITICAL: groups scheduled coverage per area (scheduled-only, no demand)', () => {
    const res = summarizeAreaCoverage(shifts, employees, '2026-07-11', 'America/Chicago', win);
    const cs = res.find((r) => r.area === 'Cold Stone')!;
    const wz = res.find((r) => r.area === "Wetzel's")!;
    expect(cs.hours[0]).toMatchObject({ hour: 10, scheduled: 1, needed: null, delta: null });
    expect(wz.hours[0].scheduled).toBe(0); // Wetzel's not on at 10:00
    expect(wz.hours.find((h) => h.hour === 11)!.scheduled).toBe(1);
  });

  it('CRITICAL: buckets a null/blank area under the Unassigned label', () => {
    const res = summarizeAreaCoverage(
      [shiftFor('s3', 'c', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')],
      [{ id: 'c', restaurant_id: 'r', name: 'c', area: null, position: 'Server' } as Employee],
      '2026-07-11', 'America/Chicago', win,
    );
    expect(res[0].area).toBe('Unassigned');
  });

  it('returns [] for no shifts', () => {
    expect(summarizeAreaCoverage([], employees, '2026-07-11', 'America/Chicago', win)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`npm run test -- tests/unit/coverageSummary.test.ts`).

- [ ] **Step 3: Implement** (append to `src/lib/coverageSummary.ts`)

```ts
import { computeDayCoverage } from '@/lib/shiftCoverage';
import { UNASSIGNED_LABEL } from '@/lib/scheduleGrouping';
import type { Shift, Employee } from '@/types/scheduling';

export interface AreaCoverage {
  area: string;
  hours: CoverageHour[]; // scheduled-only (needed/delta are null)
}

const AREA_STEP = 15;

/**
 * Per-area SCHEDULED coverage (no per-area demand). Groups shifts by the
 * employee's `area` (same key as buildRosterDay), then reuses computeDayCoverage
 * + summarizeCoverageHours with demand=null. Areas sorted alphabetically,
 * Unassigned last.
 */
export function summarizeAreaCoverage(
  shifts: Shift[],
  employees: Employee[],
  dateStr: string,
  tz: string,
  window: { startMin: number; endMin: number },
): AreaCoverage[] {
  if (shifts.length === 0) return [];
  const areaById = new Map(employees.map((e) => [e.id, (e.area ?? '').trim()]));

  const byArea = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (s.status === 'cancelled') continue;
    const key = areaById.get(s.employee_id) ?? '';
    const arr = byArea.get(key);
    if (arr) arr.push(s);
    else byArea.set(key, [s]);
  }

  const keys = Array.from(byArea.keys()).sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const areaShifts = byArea.get(key) ?? [];
    const coverage = computeDayCoverage(
      areaShifts as Parameters<typeof computeDayCoverage>[0],
      dateStr, tz, AREA_STEP, window.startMin, window.endMin,
    );
    return {
      area: key || UNASSIGNED_LABEL,
      hours: summarizeCoverageHours(coverage, null, window),
    };
  });
}
```

- [ ] **Step 4: Run under UTC + Tokyo — PASS.**
- [ ] **Step 5: Commit** — `feat(scheduling): summarizeAreaCoverage — per-area scheduled coverage`.

---

## Task 2: `CoverageDemandInfo` explainer popover

**Files:** Create `src/components/scheduling/ShiftTimeline/CoverageDemandInfo.tsx`

- [ ] **Step 1: Implement** — a shadcn `Popover`: trigger is a small ghost button `<button aria-label="How is needed staff calculated?">` with a `ti-help-circle`/lucide `HelpCircle` icon + "How is 'needed' set?" text (CLAUDE.md `text-[12px]`). Content (`PopoverContent`, `w-72`, semantic tokens):
  - "**Needed staff** = each hour's projected sales ÷ your target **sales per labor hour (SPLH)**, never below your minimum crew."
  - "**Covered** = scheduled ≥ needed. **Short** = below it."
  - A link row: `<a>Adjust targets in Staffing settings →</a>` (href to the staffing settings route; if none, render as a muted note). Keyboard-focusable.

- [ ] **Step 2: Typecheck + lint + commit.**

---

## Task 3: `AreaCoverageStrips` component

**Files:** Create `src/components/scheduling/ShiftTimeline/AreaCoverageStrips.tsx`

- [ ] **Step 1: Implement** — props `{ areas: AreaCoverage[] }`. For each area render:
  - a row header: area name (`text-[13px] font-medium`) + `text-[12px] text-muted-foreground` total ("scheduled").
  - a per-hour cell strip (flex, `gap-3px`): each cell shows the hour label (`text-[9px]`) + the scheduled count (`text-[11px] font-medium tabular-nums`), background `bg-muted/40` (scheduled-only, neutral — NOT red/green, since there's no per-area demand). Cell `role="img"` + `aria-label={\`${area}, ${formatCoverageHour(h.hour)}, ${h.scheduled} scheduled\`}`.
  - Below the strips, a single footnote: `text-[11px] text-muted-foreground` — "Demand targets are set for the whole location — per-brand targets coming soon."
  - Return `null` when `areas.length === 0`.

- [ ] **Step 2: Typecheck + lint + commit.**

---

## Task 4: `CoverageStatusStrip` — show `have/needed`

**Files:**
- Modify: `src/components/scheduling/ShiftTimeline/CoverageStatusStrip.tsx`
- Modify: `tests/unit/coverageStatusStrip.test.tsx`

- [ ] **Step 1: Add/adjust failing test** — a demand-present hour renders `have/needed` (e.g. `3/5`); a no-demand hour renders just the scheduled count.

```tsx
it('shows have/needed for demand hours and scheduled-only when no demand', () => {
  render(<CoverageStatusStrip hours={[
    { hour: 17, startMin: 1020, scheduled: 3, needed: 5, delta: -2 },
    { hour: 18, startMin: 1080, scheduled: 4, needed: null, delta: null },
  ]} />);
  expect(screen.getByText('3/5')).toBeInTheDocument();
  expect(screen.getByText('4')).toBeInTheDocument(); // no-demand → scheduled only
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — replace the cell's inner value span: when `h.needed !== null`, render `{h.scheduled}/{h.needed}`; else render `{h.scheduled}`. Keep the red (short) / green (covered) / muted (no-demand) `cellColorClass` and the `role="img"` + `aria-label` (extend aria-label to "6 PM, 3 of 5, short 2"). Keep the sr-only understaffed list.

- [ ] **Step 4: Run — PASS. Lint. Commit.**

---

## Task 5: Wire into `ShiftTimelineTab`

**Files:** Modify `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`

- [ ] **Step 1:** Add `const areaCoverage = useMemo(() => groupBy === 'area' ? summarizeAreaCoverage(dayShifts, employees, selectedDay, tz, model.window) : [], [groupBy, dayShifts, employees, selectedDay, tz, model.window]);`

- [ ] **Step 2:** In the coverage panel header row (next to the verdict), add `<CoverageDemandInfo />`.

- [ ] **Step 3:** After the aggregate `CoverageStatusStrip`, render `{groupBy === 'area' && <AreaCoverageStrips areas={areaCoverage} />}` inside the same `pl-[120px]` aligned wrapper.

- [ ] **Step 4: Full verify** — `npm run typecheck && npm run lint && TZ=UTC npm run test && npm run build`. Fix until green.

- [ ] **Step 5: Commit** — `feat(scheduling): per-area coverage strips + demand explainer in Timeline`.

---

## Self-review notes

- **Spec coverage:** area helper (T1), explainer (T2), per-area strips (T3), have/needed cells (T4), wire-up (T5). All map.
- **Sonar:** condition logic is in `summarizeAreaCoverage` (T1) with multi-branch fixtures (area grouping, Unassigned bucket, empty). Components under `src/components` are coverage-excluded by convention; keep logic in `src/lib`.
- **No new data fetching / DB changes** — per-area coverage is derived from shifts already loaded; no per-area demand introduced.
- **Type consistency:** `AreaCoverage` defined in T1, consumed unchanged in T3/T5; reuses existing `CoverageHour`, `computeDayCoverage`, `summarizeCoverageHours`, `UNASSIGNED_LABEL`.
