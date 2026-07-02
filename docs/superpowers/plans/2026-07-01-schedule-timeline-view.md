# Schedule Timeline View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Timeline" view mode to the scheduler — a day gantt of shift bars grouped by area/position with a coverage-vs-demand curve over the same time axis.

**Architecture:** A pure `useTimelineModel` transform turns `useShiftPlanner`'s shifts + the day's staffing recommendations into `{ window, lanes, coverage, demand, gaps }`; presentational components render it. Three behavior-preserving extractions (coverage helper, position colors, staffing hook) precede the feature. Timeline mounts in `ShiftPlannerTab` behind a `Plan | Timeline` toggle and unmounts the planner's editing tree while active.

**Tech Stack:** React 18 + TS, Vitest, TailwindCSS, shadcn/ui (`ToggleGroup`, `Popover`), `date-fns-tz`.

**Spec:** `docs/superpowers/specs/2026-07-01-schedule-timeline-view-design.md`

**Conventions:** All new components use semantic tokens + the CLAUDE.md Apple/Notion type scale. Run `npm run test -- <file>` for a single suite. TZ-portable tests run under `TZ=UTC` and `TZ=Asia/Tokyo` (prefix the command).

---

## Task 1: Extract `POSITION_COLORS` to a shared module

**Files:**
- Create: `src/lib/positionColors.ts`
- Modify: `src/components/scheduling/ShiftPlanner/EmployeeChip.tsx:19-61` (remove local const, import instead)
- Test: `tests/unit/positionColors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { getPositionColors, DEFAULT_POSITION_COLORS } from '@/lib/positionColors';

describe('getPositionColors', () => {
  it('returns the server palette case-insensitively', () => {
    expect(getPositionColors('Server').text).toBe('text-blue-700 dark:text-blue-300');
    expect(getPositionColors('SERVER').bg).toBe('bg-blue-500/15');
  });
  it('falls back to default for unknown positions', () => {
    expect(getPositionColors('barista')).toEqual(DEFAULT_POSITION_COLORS);
    expect(getPositionColors('')).toEqual(DEFAULT_POSITION_COLORS);
  });
  it('maps every known position', () => {
    for (const p of ['server', 'cook', 'bartender', 'host', 'manager']) {
      expect(getPositionColors(p)).not.toEqual(DEFAULT_POSITION_COLORS);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/positionColors.test.ts`
Expected: FAIL — cannot resolve `@/lib/positionColors`.

- [ ] **Step 3: Create `src/lib/positionColors.ts`** (move the constants verbatim from `EmployeeChip.tsx`)

```ts
export interface PositionColors {
  bg: string;
  border: string;
  text: string;
}

export const POSITION_COLORS: Record<string, PositionColors> = {
  server: { bg: 'bg-blue-500/15', border: 'border-blue-500/30', text: 'text-blue-700 dark:text-blue-300' },
  cook: { bg: 'bg-orange-500/15', border: 'border-orange-500/30', text: 'text-orange-700 dark:text-orange-300' },
  bartender: { bg: 'bg-purple-500/15', border: 'border-purple-500/30', text: 'text-purple-700 dark:text-purple-300' },
  host: { bg: 'bg-green-500/15', border: 'border-green-500/30', text: 'text-green-700 dark:text-green-300' },
  manager: { bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-700 dark:text-red-300' },
};

export const DEFAULT_POSITION_COLORS: PositionColors = {
  bg: 'bg-muted/50',
  border: 'border-border/40',
  text: 'text-foreground',
};

export function getPositionColors(position: string): PositionColors {
  return POSITION_COLORS[position.toLowerCase()] ?? DEFAULT_POSITION_COLORS;
}
```

- [ ] **Step 4: Update `EmployeeChip.tsx`** — delete the local `POSITION_COLORS`, `DEFAULT_COLORS`, and `getColors` (lines 19-61) and import instead. Replace `getColors(position)` call sites with `getPositionColors(position)`.

```ts
import { getPositionColors } from '@/lib/positionColors';
// ...later, where getColors(position) was used:
const colors = getPositionColors(position);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- tests/unit/positionColors.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/positionColors.ts src/components/scheduling/ShiftPlanner/EmployeeChip.tsx tests/unit/positionColors.test.ts
git commit -m "refactor(scheduling): extract POSITION_COLORS to shared positionColors module"
```

---

## Task 2: Export `isoToLocalMinutes` + add `computeDayCoverage`

**Files:**
- Modify: `src/lib/shiftCoverage.ts:60` (add `export` to `isoToLocalMinutes`; append `computeDayCoverage`)
- Test: `tests/unit/shiftCoverage.dayCoverage.test.ts`

- [ ] **Step 1: Write the failing test** (TZ-portable — asserts on passed `tz`, not host)

```ts
import { describe, it, expect } from 'vitest';
import { computeDayCoverage, isoToLocalMinutes } from '@/lib/shiftCoverage';
import type { CoverageShift } from '@/types/scheduling';

const mk = (id: string, start: string, end: string, extra: Partial<CoverageShift> = {}): CoverageShift => ({
  employee_id: id, start_time: start, end_time: end, position: 'Server', status: 'scheduled',
  area: null, homeArea: null, employee_name: id, ...extra,
} as CoverageShift);

describe('isoToLocalMinutes (exported)', () => {
  it('resolves wall-clock minutes in the given tz regardless of host', () => {
    // 2026-07-11 15:00 in Chicago (UTC-5 in July) = 20:00Z
    expect(isoToLocalMinutes('2026-07-11T20:00:00Z', '2026-07-11', 'America/Chicago')).toBe(15 * 60);
  });
});

describe('computeDayCoverage', () => {
  it('counts overlapping headcount across the window at each step', () => {
    const shifts = [
      mk('a', '2026-07-11T15:00:00Z', '2026-07-11T21:00:00Z'), // 10:00–16:00 CT
      mk('b', '2026-07-11T17:00:00Z', '2026-07-11T23:00:00Z'), // 12:00–18:00 CT
    ];
    const cov = computeDayCoverage(shifts, '2026-07-11', 'America/Chicago', 60, 600, 1080);
    expect(cov.find((c) => c.min === 600)!.count).toBe(1);  // 10:00 → only a
    expect(cov.find((c) => c.min === 720)!.count).toBe(2);  // 12:00 → a+b
    expect(cov.find((c) => c.min === 1020)!.count).toBe(1); // 17:00 → only b
  });
  it('handles an overnight shift crossing midnight (+1440)', () => {
    const shifts = [mk('c', '2026-07-12T03:00:00Z', '2026-07-12T07:00:00Z')]; // 22:00–02:00 CT (Jul 11)
    const cov = computeDayCoverage(shifts, '2026-07-11', 'America/Chicago', 60, 1320, 1560);
    expect(cov.find((c) => c.min === 1380)!.count).toBe(1); // 23:00
    expect(cov.find((c) => c.min === 1500)!.count).toBe(1); // 01:00 next day
  });
  it('excludes cancelled shifts', () => {
    const shifts = [mk('d', '2026-07-11T17:00:00Z', '2026-07-11T21:00:00Z', { status: 'cancelled' })];
    const cov = computeDayCoverage(shifts, '2026-07-11', 'America/Chicago', 60, 600, 1080);
    expect(cov.every((c) => c.count === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/shiftCoverage.dayCoverage.test.ts`
Expected: FAIL — `computeDayCoverage` / `isoToLocalMinutes` not exported.

- [ ] **Step 3: Implement** — change `function isoToLocalMinutes` (line 60) to `export function isoToLocalMinutes`, then append:

```ts
export interface DayCoverageSample {
  min: number;
  count: number;
}

/**
 * Whole-day coverage curve: headcount of non-cancelled shifts on the floor at
 * each `stepMin` sample from windowStartMin to windowEndMin (inclusive).
 * Uses local wall-clock minutes in `tz`; overnight shifts (end ≤ start) extend +1440.
 */
export function computeDayCoverage(
  shifts: CoverageShift[],
  dateStr: string,
  tz: string,
  stepMin: number,
  windowStartMin: number,
  windowEndMin: number,
): DayCoverageSample[] {
  const intervals: { s: number; e: number }[] = [];
  for (const s of shifts) {
    if (s.status === 'cancelled') continue;
    const ds = isoToLocalMinutes(s.start_time, dateStr, tz);
    let de = isoToLocalMinutes(s.end_time, dateStr, tz);
    if (de <= ds) de += 1440;
    intervals.push({ s: ds, e: de });
  }
  const samples: DayCoverageSample[] = [];
  for (let m = windowStartMin; m <= windowEndMin; m += stepMin) {
    let count = 0;
    for (const iv of intervals) if (m >= iv.s && m < iv.e) count++;
    samples.push({ min: m, count });
  }
  return samples;
}
```

- [ ] **Step 4: Run tests under both timezones**

Run: `TZ=UTC npm run test -- tests/unit/shiftCoverage.dayCoverage.test.ts && TZ=Asia/Tokyo npm run test -- tests/unit/shiftCoverage.dayCoverage.test.ts`
Expected: PASS in both.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shiftCoverage.ts tests/unit/shiftCoverage.dayCoverage.test.ts
git commit -m "feat(scheduling): export isoToLocalMinutes + add computeDayCoverage whole-day curve"
```

---

## Task 3: Extract `useWeekStaffingSuggestions` into its own hook

**Files:**
- Create: `src/hooks/useWeekStaffingSuggestions.ts`
- Modify: `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx:35-~200` (remove local fn), add import
- Test: none new — behavior-preserving move; existing StaffingOverlay tests + typecheck guard it.

- [ ] **Step 1: Cut the `useWeekStaffingSuggestions` function** (starts `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx:35`) verbatim into the new file, exporting it. Move any imports it needs (`useQuery`, `computeStaffingSuggestions`, `useStaffingSettings`, types) along with it; keep them in `StaffingOverlay` too if still used there.

```ts
// src/hooks/useWeekStaffingSuggestions.ts
export function useWeekStaffingSuggestions(/* same signature as before */) {
  // ...moved body verbatim...
}
```

- [ ] **Step 2: Import it in `StaffingOverlay.tsx`**

```ts
import { useWeekStaffingSuggestions } from '@/hooks/useWeekStaffingSuggestions';
```

- [ ] **Step 3: Verify no behavior change**

Run: `npm run typecheck && npm run test -- StaffingOverlay`
Expected: PASS (or "no tests" — the typecheck is the gate). If a `RETURN TYPE` is inferred, export it as `WeekStaffingSuggestions` for reuse in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useWeekStaffingSuggestions.ts src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx
git commit -m "refactor(scheduling): extract useWeekStaffingSuggestions to shared hook"
```

---

## Task 4: `useTimelineModel` types + window derivation

**Files:**
- Create: `src/components/scheduling/ShiftTimeline/useTimelineModel.ts`
- Test: `tests/unit/useTimelineModel.test.ts`

- [ ] **Step 1: Write the failing test** (window derivation only)

```ts
import { describe, it, expect } from 'vitest';
import { deriveWindow } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { Shift } from '@/types/scheduling';

const shift = (start: string, end: string): Shift => ({
  id: start, restaurant_id: 'r', employee_id: 'e', start_time: start, end_time: end,
  break_duration: 0, position: 'Server', status: 'scheduled', is_published: false, source: 'manual',
} as Shift);

describe('deriveWindow', () => {
  it('floors start and ceils end to the hour', () => {
    // 10:30–16:15 CT
    const w = deriveWindow([shift('2026-07-11T15:30:00Z', '2026-07-11T21:15:00Z')], '2026-07-11', 'America/Chicago');
    expect(w.startMin).toBe(600); // 10:00
    expect(w.endMin).toBe(1020);  // 17:00
  });
  it('extends past 1440 for overnight shifts', () => {
    const w = deriveWindow([shift('2026-07-12T03:00:00Z', '2026-07-12T07:00:00Z')], '2026-07-11', 'America/Chicago'); // 22:00–02:00
    expect(w.startMin).toBe(1320); // 22:00
    expect(w.endMin).toBe(1560);   // 02:00 next day
  });
  it('returns a sane default span for an empty day', () => {
    const w = deriveWindow([], '2026-07-11', 'America/Chicago');
    expect(w.startMin).toBe(600);  // 10:00 default
    expect(w.endMin).toBe(1380);   // 23:00 default
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/useTimelineModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types + `deriveWindow`**

```ts
import { isoToLocalMinutes } from '@/lib/shiftCoverage';
import type { Shift } from '@/types/scheduling';

export interface TimelineWindow { startMin: number; endMin: number }
export interface TimelineBar {
  shift: Shift; row: number; leftMin: number; endMin: number;
  label: string; ariaLabel: string; color: import('@/lib/positionColors').PositionColors;
}
export interface TimelineLane { key: string; label: string; hours: number; bars: TimelineBar[] }
export interface TimelineGap { startMin: number; endMin: number }
export interface TimelineModel {
  window: TimelineWindow;
  lanes: TimelineLane[];
  coverage: { min: number; count: number }[];
  demand: { min: number; target: number }[] | null;
  gaps: TimelineGap[];
}

const DEFAULT_START = 600;  // 10:00
const DEFAULT_END = 1380;   // 23:00

export function deriveWindow(shifts: Shift[], dateStr: string, tz: string): TimelineWindow {
  if (shifts.length === 0) return { startMin: DEFAULT_START, endMin: DEFAULT_END };
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const s of shifts) {
    const ds = isoToLocalMinutes(s.start_time, dateStr, tz);
    let de = isoToLocalMinutes(s.end_time, dateStr, tz);
    if (de <= ds) de += 1440;
    minStart = Math.min(minStart, ds);
    maxEnd = Math.max(maxEnd, de);
  }
  return { startMin: Math.floor(minStart / 60) * 60, endMin: Math.ceil(maxEnd / 60) * 60 };
}
```

- [ ] **Step 4: Run under both timezones**

Run: `TZ=UTC npm run test -- tests/unit/useTimelineModel.test.ts && TZ=Asia/Tokyo npm run test -- tests/unit/useTimelineModel.test.ts`
Expected: PASS in both.

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/ShiftTimeline/useTimelineModel.ts tests/unit/useTimelineModel.test.ts
git commit -m "feat(scheduling): timeline model types + window derivation"
```

---

## Task 5: Lanes — grouping + overlap row-stacking

**Files:**
- Modify: `src/components/scheduling/ShiftTimeline/useTimelineModel.ts`
- Modify: `tests/unit/useTimelineModel.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import { buildLanes } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { Employee } from '@/types/scheduling';

const emp = (id: string, name: string, area: string, position: string): Employee =>
  ({ id, restaurant_id: 'r', name, area, position } as Employee);

describe('buildLanes', () => {
  const employees = [emp('e1', 'Ann', 'Front', 'Server'), emp('e2', 'Bob', 'Front', 'Server')];
  const shiftFor = (id: string, eid: string, start: string, end: string) =>
    ({ id, restaurant_id: 'r', employee_id: eid, start_time: start, end_time: end, break_duration: 0,
       position: 'Server', status: 'scheduled', is_published: false, source: 'manual' } as Shift);

  it('groups by area and stacks overlapping shifts onto separate rows', () => {
    const shifts = [
      shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T21:00:00Z'), // Ann 10-16
      shiftFor('s2', 'e2', '2026-07-11T17:00:00Z', '2026-07-11T23:00:00Z'), // Bob 12-18 (overlaps Ann)
    ];
    const lanes = buildLanes(shifts, employees, '2026-07-11', 'America/Chicago', 'area');
    expect(lanes).toHaveLength(1);
    expect(lanes[0].label).toBe('Front');
    expect(lanes[0].bars.map((b) => b.row).sort()).toEqual([0, 1]); // stacked
    expect(lanes[0].hours).toBe(12);
  });

  it('non-overlapping shifts in one lane share row 0', () => {
    const shifts = [
      shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'), // 10-13
      shiftFor('s2', 'e2', '2026-07-11T19:00:00Z', '2026-07-11T22:00:00Z'), // 14-17
    ];
    const lanes = buildLanes(shifts, employees, '2026-07-11', 'America/Chicago', 'area');
    expect(lanes[0].bars.every((b) => b.row === 0)).toBe(true);
  });

  it('groups by position when mode is position', () => {
    const lanes = buildLanes(
      [shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')],
      employees, '2026-07-11', 'America/Chicago', 'position',
    );
    expect(lanes[0].label).toBe('Server');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/useTimelineModel.test.ts`
Expected: FAIL — `buildLanes` not exported.

- [ ] **Step 3: Implement `buildLanes`** (reuse `buildRosterDay` for grouping/sort/hours; add geometry + stacking)

```ts
import { buildRosterDay, type RosterRow } from '@/lib/scheduleRoster';
import { getPositionColors } from '@/lib/positionColors';
import { ShiftInterval } from '@/lib/shiftInterval';
import { minutesToCompact } from '@/lib/shiftCoverage';
import type { Employee, GroupByMode } from ...; // import GroupByMode from '@/lib/scheduleGrouping'

function assignRows(rows: RosterRow[], dateStr: string, tz: string): TimelineBar[] {
  const rowEnds: number[] = []; // last endMin per row
  return rows.map((r) => {
    const leftMin = isoToLocalMinutes(r.shift.start_time, dateStr, tz);
    let endMin = isoToLocalMinutes(r.shift.end_time, dateStr, tz);
    if (endMin <= leftMin) endMin += 1440;
    let row = rowEnds.findIndex((end) => leftMin >= end);
    if (row === -1) { row = rowEnds.length; rowEnds.push(endMin); } else { rowEnds[row] = endMin; }
    const name = r.employee.name;
    const start12 = minutesToCompact(leftMin);
    const end12 = minutesToCompact(endMin % 1440);
    return {
      shift: r.shift, row, leftMin, endMin,
      label: name,
      ariaLabel: `${name}, ${r.shift.position}, ${start12} to ${end12}, ${r.hours} hours`,
      color: getPositionColors(r.shift.position),
    };
  });
}

export function buildLanes(
  shifts: Shift[], employees: Employee[], dateStr: string, tz: string, groupBy: GroupByMode,
): TimelineLane[] {
  const roster = buildRosterDay(shifts, employees, dateStr, 'startTime', groupBy);
  return roster.sections.map((sec) => ({
    key: sec.label || 'unassigned',
    label: sec.label || 'Unassigned',
    hours: sec.rows.reduce((sum, r) => sum + r.hours, 0),
    bars: assignRows(sec.rows, dateStr, tz),
  }));
}
```

> Note: `buildRosterDay` sorts rows by `startTime`, so the first-fit `assignRows` sweep is deterministic. `ShiftInterval` is imported for future use but the minute-based first-fit above is sufficient; do NOT add unused imports — drop the `ShiftInterval` import if the linter flags it.

- [ ] **Step 4: Run under both timezones**

Run: `TZ=UTC npm run test -- tests/unit/useTimelineModel.test.ts && TZ=Asia/Tokyo npm run test -- tests/unit/useTimelineModel.test.ts`
Expected: PASS in both.

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/ShiftTimeline/useTimelineModel.ts tests/unit/useTimelineModel.test.ts
git commit -m "feat(scheduling): timeline lanes via buildRosterDay + overlap row-stacking"
```

---

## Task 6: Coverage, demand expansion, gaps + the `useTimelineModel` hook

**Files:**
- Modify: `src/components/scheduling/ShiftTimeline/useTimelineModel.ts`
- Modify: `tests/unit/useTimelineModel.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import { expandDemand, computeGaps } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { HourlyStaffingRecommendation } from '@/types/scheduling';

const rec = (hour: number, staff: number): HourlyStaffingRecommendation =>
  ({ hour, recommendedStaff: staff, projectedSales: 0, estimatedLaborCost: 0, laborPct: 0, overTarget: false });

describe('expandDemand', () => {
  it('expands hourly recs to a 15-min step grid aligned to the window', () => {
    const demand = expandDemand([rec(10, 2), rec(11, 3)], 600, 720, 15);
    expect(demand!.find((d) => d.min === 600)!.target).toBe(2);  // 10:00
    expect(demand!.find((d) => d.min === 645)!.target).toBe(2);  // 10:45 → hour 10
    expect(demand!.find((d) => d.min === 660)!.target).toBe(3);  // 11:00 → hour 11
  });
  it('returns null when there are no recommendations', () => {
    expect(expandDemand([], 600, 720, 15)).toBeNull();
  });
});

describe('computeGaps', () => {
  it('finds contiguous windows where coverage < demand', () => {
    const coverage = [{ min: 600, count: 1 }, { min: 615, count: 1 }, { min: 630, count: 3 }];
    const demand = [{ min: 600, target: 2 }, { min: 615, target: 2 }, { min: 630, target: 2 }];
    expect(computeGaps(coverage, demand)).toEqual([{ startMin: 600, endMin: 630 }]);
  });
  it('returns no gaps when demand is null', () => {
    expect(computeGaps([{ min: 600, count: 0 }], null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/useTimelineModel.test.ts`
Expected: FAIL — `expandDemand` / `computeGaps` not exported.

- [ ] **Step 3: Implement the helpers + the hook**

```ts
import { useMemo } from 'react';
import { computeDayCoverage } from '@/lib/shiftCoverage';
import type { HourlyStaffingRecommendation } from '@/types/scheduling';

const STEP_MIN = 15;

export function expandDemand(
  recs: HourlyStaffingRecommendation[], startMin: number, endMin: number, step = STEP_MIN,
): { min: number; target: number }[] | null {
  if (recs.length === 0) return null;
  const byHour = new Map(recs.map((r) => [r.hour, r.recommendedStaff]));
  const out: { min: number; target: number }[] = [];
  for (let m = startMin; m <= endMin; m += step) {
    const hour = Math.floor((m % 1440) / 60);
    out.push({ min: m, target: byHour.get(hour) ?? 0 });
  }
  return out;
}

export function computeGaps(
  coverage: { min: number; count: number }[],
  demand: { min: number; target: number }[] | null,
): TimelineGap[] {
  if (!demand) return [];
  const targetAt = new Map(demand.map((d) => [d.min, d.target]));
  const gaps: TimelineGap[] = [];
  let open: TimelineGap | null = null;
  for (const c of coverage) {
    const short = c.count < (targetAt.get(c.min) ?? 0);
    if (short) { if (open) open.endMin = c.min; else open = { startMin: c.min, endMin: c.min }; }
    else if (open) { gaps.push(open); open = null; }
  }
  if (open) gaps.push(open);
  return gaps;
}

export function useTimelineModel(
  shifts: Shift[], employees: Employee[], dateStr: string, tz: string,
  groupBy: GroupByMode, recommendations: HourlyStaffingRecommendation[],
): TimelineModel {
  return useMemo(() => {
    const dayShifts = shifts.filter((s) => s.status !== 'cancelled');
    const window = deriveWindow(dayShifts, dateStr, tz);
    const lanes = buildLanes(dayShifts, employees, dateStr, tz, groupBy);
    const coverage = computeDayCoverage(dayShifts as never, dateStr, tz, STEP_MIN, window.startMin, window.endMin);
    const demand = expandDemand(recommendations, window.startMin, window.endMin);
    const gaps = computeGaps(coverage, demand);
    return { window, lanes, coverage, demand, gaps };
  }, [shifts, employees, dateStr, tz, groupBy, recommendations]);
}
```

> `computeDayCoverage` takes `CoverageShift[]`; `Shift` structurally satisfies the fields it reads (`start_time`, `end_time`, `status`). If typecheck complains, add a small `toCoverageShift(shift)` mapper rather than `as never`.

- [ ] **Step 4: Run under both timezones + typecheck**

Run: `TZ=UTC npm run test -- tests/unit/useTimelineModel.test.ts && TZ=Asia/Tokyo npm run test -- tests/unit/useTimelineModel.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/ShiftTimeline/useTimelineModel.ts tests/unit/useTimelineModel.test.ts
git commit -m "feat(scheduling): timeline coverage sampling, hourly->15min demand, gap detection"
```

---

## Task 7: Axis + coverage curve + gap list (presentational SVG)

**Files:**
- Create: `src/components/scheduling/ShiftTimeline/TimelineAxis.tsx`
- Create: `src/components/scheduling/ShiftTimeline/CoverageCurve.tsx`
- Create: `src/components/scheduling/ShiftTimeline/CoverageGapList.tsx`
- Test: `tests/unit/coverageGapList.test.tsx` (the only one with logic worth a test)

- [ ] **Step 1: Write the failing test for the gap list**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageGapList } from '@/components/scheduling/ShiftTimeline/CoverageGapList';

describe('CoverageGapList', () => {
  it('lists each understaffed window as text', () => {
    render(<CoverageGapList gaps={[{ startMin: 600, endMin: 690 }]} />);
    expect(screen.getByText(/10:00a/i)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /understaffed/i })).toBeInTheDocument();
  });
  it('renders nothing when there are no gaps', () => {
    const { container } = render(<CoverageGapList gaps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/coverageGapList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the three components.** `CoverageGapList` (uses `minutesToCompact`):

```tsx
import { minutesToCompact } from '@/lib/shiftCoverage';
import type { TimelineGap } from './useTimelineModel';

export function CoverageGapList({ gaps }: { gaps: TimelineGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <ul aria-label="Understaffed windows" className="mt-3 space-y-1">
      {gaps.map((g) => (
        <li key={g.startMin} className="text-[13px] text-muted-foreground flex items-center gap-2">
          <span aria-hidden className="h-2 w-2 rounded-sm bg-destructive" />
          Below demand {minutesToCompact(g.startMin)}–{minutesToCompact(g.endMin % 1440)}
        </li>
      ))}
    </ul>
  );
}
```

`TimelineAxis` renders hour tick lines/labels; `CoverageCurve` renders one SVG (`role="img"` + `<title>`/`<desc>`) with: a light area path for `coverage`, a dashed `stroke-muted-foreground` step line for `demand` (skip if null), and `bg-destructive/…` rects under `gaps`. Both take `window` + a shared `minToPct(min)` helper `(min - startMin) / (endMin - startMin) * 100`. Use `text-foreground`/`text-muted-foreground` and `hsl(var(--...))`-backed classes — no raw hex, no direct colors.

```tsx
// CoverageCurve desc example
<desc>{`Peak coverage ${peak} staff. ${gaps.length} understaffed window(s).`}</desc>
```

- [ ] **Step 4: Run test + lint**

Run: `npm run test -- tests/unit/coverageGapList.test.tsx && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/ShiftTimeline/TimelineAxis.tsx src/components/scheduling/ShiftTimeline/CoverageCurve.tsx src/components/scheduling/ShiftTimeline/CoverageGapList.tsx tests/unit/coverageGapList.test.tsx
git commit -m "feat(scheduling): timeline axis, coverage curve SVG, and gap list"
```

---

## Task 8: Bars, lanes, shift popover, now-line

**Files:**
- Create: `src/components/scheduling/ShiftTimeline/TimelineBar.tsx`
- Create: `src/components/scheduling/ShiftTimeline/TimelineLane.tsx`
- Create: `src/components/scheduling/ShiftTimeline/TimelineShiftPopover.tsx`
- Create: `src/components/scheduling/ShiftTimeline/NowIndicator.tsx`

- [ ] **Step 1: `TimelineBar`** — a `<button>` positioned via `left`/`width` percent from `minToPct`, colored via `bar.color` (`cn(color.bg, color.border, color.text)`), showing `bar.label`, with `aria-label={bar.ariaLabel}`, `onClick={() => onSelect(bar.shift)}`. Truncate label with `truncate`.

- [ ] **Step 2: `TimelineLane`** — sticky-left label (`{label} · {rows} · {hours}h` using the CLAUDE.md `text-[13px]`/`text-[11px]` scale), then a relative-positioned band of height `(maxRow+1) * 28px` containing the lane's `TimelineBar`s at `top: row*28`.

- [ ] **Step 3: `TimelineShiftPopover`** — a single shadcn `Popover` (controlled by `activeShift` state passed from the tab) showing name, position, area, start–end, hours, status. Read-only. One instance, per CLAUDE.md single-dialog pattern.

- [ ] **Step 4: `NowIndicator`** — owns its own tick so the 60 s repaint is scoped:

```tsx
import { useEffect, useState } from 'react';
import { isoToLocalMinutes } from '@/lib/shiftCoverage';

export function NowIndicator({ dateStr, tz, window, minToPct }: {
  dateStr: string; tz: string; window: { startMin: number; endMin: number };
  minToPct: (min: number) => number;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMin = isoToLocalMinutes(now.toISOString(), dateStr, tz);
  if (nowMin < window.startMin || nowMin > window.endMin) return null;
  return <div aria-hidden className="absolute top-0 bottom-0 w-px bg-destructive/70" style={{ left: `${minToPct(nowMin)}%` }} />;
}
```

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`

```bash
git add src/components/scheduling/ShiftTimeline/TimelineBar.tsx src/components/scheduling/ShiftTimeline/TimelineLane.tsx src/components/scheduling/ShiftTimeline/TimelineShiftPopover.tsx src/components/scheduling/ShiftTimeline/NowIndicator.tsx
git commit -m "feat(scheduling): timeline bars, lanes, read-only shift popover, now-line"
```

---

## Task 9: `ShiftTimelineTab` container (assembles the view)

**Files:**
- Create: `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`

- [ ] **Step 1: Implement the container.** Props: `{ shifts, employees, weekDays, restaurantId, tz, loading, error }`. Local state: `selectedDay` (default today-in-week or `weekDays[0]`), `groupBy: 'area' | 'position'` (default `'area'`), `activeShift: Shift | null`.
  - Call `useWeekStaffingSuggestions(restaurantId, weekDays, /* settings */)` and select the selected day's `HourlyStaffingRecommendation[]` (empty array if none).
  - Call `useTimelineModel(dayShifts, employees, selectedDay, tz, groupBy, recommendations)`.
  - Compute `minToPct(min) = (min - window.startMin) / (window.endMin - window.startMin) * 100`.
  - Render states: `loading` → skeleton bands; `error` → inline message; `lanes.length === 0` → empty state "No shifts scheduled — switch to Plan to add coverage."
  - Layout: day selector row + group-by `ToggleGroup` (Area/Position) → a horizontally-scrollable plot wrapper (`overflow-x-auto`) whose inner width is `max(100%, span/60 * MIN_PX_PER_HOUR)`, containing (top→bottom) `CoverageCurve`, `TimelineAxis`, `TimelineLane[]` with an absolutely-positioned `NowIndicator` overlay, then `CoverageGapList` and the single `TimelineShiftPopover`.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx
git commit -m "feat(scheduling): ShiftTimelineTab container with day selector, group-by, states"
```

---

## Task 10: Wire `Plan | Timeline` toggle into `ShiftPlannerTab`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

- [ ] **Step 1: Add view state + toggle.** After the loading/error/empty early returns (~line 494-530), add `const [view, setView] = useState<'plan' | 'timeline'>('plan');` and render a shadcn `ToggleGroup type="single"` in the header row (near `PlannerHeader`), Plan/Timeline options.

- [ ] **Step 2: Branch the body.** When `view === 'timeline'`, render `<ShiftTimelineTab shifts={shifts} employees={employees} weekDays={weekDays} restaurantId={restaurantId} tz={restaurantTimezone} loading={loading} error={error} />` **instead of** the `DndContext` / `EmployeeSidebar` / `TemplateGrid` / `StaffingOverlay` subtree — so the editing tree is not mounted in Timeline mode. Keep `PlannerHeader` (week nav) shared above the branch.

- [ ] **Step 3: Hide the mobile add-shift FAB** when `view === 'timeline'` (read-only view).

- [ ] **Step 4: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat(scheduling): mount Plan|Timeline toggle; Timeline unmounts editing tree"
```

---

## Task 11: Mobile layout pass + final verification

**Files:**
- Modify: `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`, `TimelineLane.tsx` (as needed)

- [ ] **Step 1: Sticky lane labels + shared horizontal scroll.** Ensure lane labels are `sticky left-0 z-10 bg-background` and the curve/axis/lanes share one `overflow-x-auto` wrapper so they stay aligned when scrolled. Verify no nested vertical scroll.

- [ ] **Step 2: Manual viewport check.** Use the app-run skill / preview at 375×667: confirm the plot scrolls horizontally, labels stay pinned, the curve aligns with bars, and the FAB is hidden in Timeline mode.

- [ ] **Step 3: Full local verification (Phase 8 gate)**

Run: `npm run typecheck && npm run lint && TZ=UTC npm run test && npm run build`
Expected: all PASS. (E2E only if a scheduling spec exists that this touches.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(scheduling): timeline mobile layout — sticky labels, shared horizontal scroll"
```

---

## Self-review notes

- **Spec coverage:** window/lanes/coverage/demand/gaps (Tasks 4-6), TZ via `isoToLocalMinutes` (Task 2), grouping via `buildRosterDay` (Task 5), overnight (+1440) (Tasks 2,4,5), colors (Task 1), demand via extracted hook (Task 3), curve+gap-text a11y (Task 7), bars/popover/now-line (Task 8), container+states+ToggleGroup (Task 9), mount/unmount + FAB (Task 10), mobile (Task 11). All spec sections map to a task.
- **No new DB/edge/migration** — pure frontend; no Supabase phase.
- **Sonar:** condition-heavy code is in Tasks 4-6, each with multi-branch fixtures (empty day, overnight, demand-null, gap open/close) to keep new-code condition coverage ≥80%.
- **Type consistency:** `TimelineModel`/`TimelineBar`/`TimelineLane`/`TimelineGap` defined in Task 4 and reused verbatim in Tasks 5-9; `getPositionColors`/`PositionColors` (Task 1), `computeDayCoverage`/`isoToLocalMinutes` (Task 2), `buildRosterDay`/`RosterRow` (Task 5) all match their source signatures.
