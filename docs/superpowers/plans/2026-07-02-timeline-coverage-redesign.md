# Timeline Coverage Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Timeline's coverage panel answer "are we meeting demand?" at a glance — a plain-language verdict, a chart whose red shortfall wedge is the loudest mark, a +/− bars toggle, and a per-hour status strip.

**Architecture:** One pure hourly summary (`src/lib/coverageSummary.ts`) feeds `CoverageVerdict`, `CoverageChart` (area + delta views), and `CoverageStatusStrip`. Presentation-only over existing `model.coverage` / `model.demand` / `model.window`. Replaces `CoverageCurve` + `CoverageGapList`.

**Tech Stack:** React 18 + TS, Vitest, Tailwind, SVG.

**Spec:** `docs/superpowers/specs/2026-07-02-timeline-coverage-redesign-design.md`

**Conventions:** semantic tokens + CLAUDE.md type scale; single-series data-viz status colors (covered vs short); `npm run test -- <file>` for one suite.

---

## Task 1: Pure hourly summary + verdict

**Files:**
- Create: `src/lib/coverageSummary.ts`
- Test: `tests/unit/coverageSummary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { summarizeCoverageHours, buildVerdict } from '@/lib/coverageSummary';

// window 10:00–13:00 (600–780), 15-min samples
const win = { startMin: 600, endMin: 780 };
const coverage = [
  { min: 600, count: 2 }, { min: 615, count: 2 }, { min: 630, count: 1 }, { min: 645, count: 2 }, // hr10 min=1
  { min: 660, count: 3 }, { min: 675, count: 3 }, { min: 690, count: 3 }, { min: 705, count: 3 }, // hr11 min=3
  { min: 720, count: 2 }, { min: 735, count: 2 }, { min: 750, count: 2 }, { min: 765, count: 2 }, // hr12 min=2
  { min: 780, count: 2 },
];
const demand = [
  { min: 600, target: 1 }, { min: 660, target: 3 }, { min: 720, target: 4 },
];

describe('summarizeCoverageHours', () => {
  it('aggregates scheduled as the per-hour minimum and aligns needed', () => {
    const hrs = summarizeCoverageHours(coverage, demand, win);
    expect(hrs.map((h) => h.hour)).toEqual([10, 11, 12]);
    expect(hrs[0]).toMatchObject({ scheduled: 1, needed: 1, delta: 0 });   // covered (met)
    expect(hrs[1]).toMatchObject({ scheduled: 3, needed: 3, delta: 0 });
    expect(hrs[2]).toMatchObject({ scheduled: 2, needed: 4, delta: -2 });  // short 2
  });
  it('yields null needed/delta when demand is null', () => {
    const hrs = summarizeCoverageHours(coverage, null, win);
    expect(hrs[0].needed).toBeNull();
    expect(hrs[0].delta).toBeNull();
    expect(hrs[0].scheduled).toBe(1);
  });
});

describe('buildVerdict', () => {
  it('counts short hours and picks the worst', () => {
    const hrs = summarizeCoverageHours(coverage, demand, win);
    const v = buildVerdict(hrs);
    expect(v.metAll).toBe(false);
    expect(v.shortHours).toBe(1);
    expect(v.worst).toEqual({ hour: 12, delta: -2 });
  });
  it('reports metAll when nothing is short', () => {
    const hrs = summarizeCoverageHours(
      [{ min: 600, count: 5 }, { min: 660, count: 5 }], [{ min: 600, target: 1 }], { startMin: 600, endMin: 720 },
    );
    expect(buildVerdict(hrs).metAll).toBe(true);
    expect(buildVerdict(hrs).worst).toBeNull();
  });
  it('metAll is false-ish / worst null when demand absent', () => {
    const hrs = summarizeCoverageHours([{ min: 600, count: 2 }], null, { startMin: 600, endMin: 660 });
    const v = buildVerdict(hrs);
    expect(v.hasDemand).toBe(false);
    expect(v.shortHours).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npm run test -- tests/unit/coverageSummary.test.ts`)

- [ ] **Step 3: Implement**

```ts
export interface CoverageHour {
  hour: number;         // 0–23 (may exceed via overnight window, use floor(min/60)%24 for label)
  startMin: number;     // window minute where the hour begins
  scheduled: number;    // per-hour minimum headcount
  needed: number | null;
  delta: number | null; // scheduled - needed, or null when no demand
}

export interface CoverageVerdict {
  hasDemand: boolean;
  metAll: boolean;
  shortHours: number;
  totalHours: number;
  worst: { hour: number; delta: number } | null; // most-negative delta
}

const HOUR = 60;

export function summarizeCoverageHours(
  coverage: { min: number; count: number }[],
  demand: { min: number; target: number }[] | null,
  window: { startMin: number; endMin: number },
): CoverageHour[] {
  if (coverage.length === 0) return [];
  const demandAt = demand ? new Map(demand.map((d) => [d.min, d.target])) : null;
  // nearest hourly demand target at or before a minute
  const needForMin = (m: number): number | null => {
    if (!demandAt) return null;
    const hourStart = Math.floor(m / HOUR) * HOUR;
    return demandAt.get(hourStart) ?? demandAt.get(m) ?? 0;
  };

  const out: CoverageHour[] = [];
  for (let start = Math.floor(window.startMin / HOUR) * HOUR; start < window.endMin; start += HOUR) {
    const inHour = coverage.filter((c) => c.min >= start && c.min < start + HOUR);
    if (inHour.length === 0) continue;
    const scheduled = Math.min(...inHour.map((c) => c.count));
    const needed = needForMin(start);
    out.push({
      hour: Math.floor(start / HOUR) % 24,
      startMin: start,
      scheduled,
      needed,
      delta: needed === null ? null : scheduled - needed,
    });
  }
  return out;
}

export function buildVerdict(hours: CoverageHour[]): CoverageVerdict {
  const hasDemand = hours.some((h) => h.needed !== null);
  const shorts = hours.filter((h) => h.delta !== null && h.delta < 0);
  let worst: { hour: number; delta: number } | null = null;
  for (const h of shorts) {
    if (worst === null || (h.delta as number) < worst.delta) worst = { hour: h.hour, delta: h.delta as number };
  }
  return {
    hasDemand,
    metAll: hasDemand && shorts.length === 0,
    shortHours: shorts.length,
    totalHours: hours.length,
    worst,
  };
}
```

- [ ] **Step 4: Run — expect PASS** (UTC + `TZ=Asia/Tokyo`; the function is TZ-agnostic — it consumes minute samples — but run both to prove it).

- [ ] **Step 5: Commit** — `git add src/lib/coverageSummary.ts tests/unit/coverageSummary.test.ts && git commit -m "feat(scheduling): pure hourly coverage summary + verdict"`

---

## Task 2: `CoverageVerdict` component

**Files:** Create `src/components/scheduling/ShiftTimeline/CoverageVerdict.tsx`

- [ ] **Step 1: Implement** — takes `verdict: CoverageVerdict` + a `formatHour(hour)` helper. Renders a status dot + sentence:
  - `!hasDemand` → neutral dot (`bg-muted-foreground`), "Add staffing targets to see demand."
  - `metAll` → `bg-emerald-500` dot (or `text-success`), "Meeting demand all day."
  - else → `bg-destructive` dot, `Short-staffed {shortHours} of {totalHours} hours today` + a `text-[13px] text-muted-foreground` subline naming `worst` (e.g. "Biggest gap: 5 PM — short 2").
  Use the CLAUDE.md type scale (`text-[15px] font-medium`, `text-[13px] text-muted-foreground`).

- [ ] **Step 2: Typecheck + lint + commit.**

---

## Task 3: `CoverageChart` (area + delta views) — replaces `CoverageCurve`

**Files:**
- Create: `src/components/scheduling/ShiftTimeline/CoverageChart.tsx`
- Test: `tests/unit/coverageChart.test.tsx`

- [ ] **Step 1: Failing render test**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CoverageChart } from '@/components/scheduling/ShiftTimeline/CoverageChart';

const hours = [
  { hour: 16, startMin: 960, scheduled: 3, needed: 5, delta: -2 },
  { hour: 17, startMin: 1020, scheduled: 5, needed: 5, delta: 0 },
];
describe('CoverageChart', () => {
  it('renders an accessible chart with a legend and a shortfall mark', () => {
    const { container, getByRole } = render(<CoverageChart hours={hours} view="area" />);
    expect(getByRole('img')).toBeInTheDocument();
    // shortfall wedge uses the destructive fill
    expect(container.querySelector('[data-shortfall]')).toBeTruthy();
  });
  it('renders diverging bars in delta view', () => {
    const { container } = render(<CoverageChart hours={hours} view="delta" />);
    expect(container.querySelectorAll('[data-bar]').length).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `CoverageChart`.** Props: `{ hours: CoverageHour[]; view: 'area' | 'delta'; height?: number }`. Build a real coordinate system (proper `viewBox`, NO `preserveAspectRatio="none"`).
  - Shared: y-gridlines + numeric labels; x hour labels; `role="img"` + `<title>`/`<desc>` = verdict summary.
  - **Area view:** stepped `scheduled` area (`fill-primary/15` + `stroke-primary`), stepped `needed` dashed line (`stroke-muted-foreground`, direct "Needed" label at end), and for each hour with `delta < 0` a `<rect data-shortfall className="fill-destructive/85">` spanning **between** `needed` and `scheduled` (height = deficit). Label the worst hour's deficit in white inside its wedge.
  - **Delta view:** one `<rect data-bar>` per hour from a zero baseline; `delta < 0` → `fill-destructive`, `delta === 0` → muted, `delta > 0` → `fill-primary` (or emerald); signed number label.
  - When a row's `needed` is null (no demand): render scheduled only; no wedge/needed line.

- [ ] **Step 4: Run tests + lint. Commit.**

---

## Task 4: `CoverageStatusStrip` — replaces `CoverageGapList`

**Files:**
- Create: `src/components/scheduling/ShiftTimeline/CoverageStatusStrip.tsx`
- Test: `tests/unit/coverageStatusStrip.test.tsx`

- [ ] **Step 1: Failing test** — renders one labelled cell per hour; covered vs short via color AND `aria-label`; a visually-hidden list enumerates short windows.

```tsx
import { render, screen } from '@testing-library/react';
import { CoverageStatusStrip } from '@/components/scheduling/ShiftTimeline/CoverageStatusStrip';
const hours = [
  { hour: 16, startMin: 960, scheduled: 3, needed: 5, delta: -2 },
  { hour: 17, startMin: 1020, scheduled: 5, needed: 5, delta: 0 },
];
it('labels each hour and enumerates short windows for screen readers', () => {
  render(<CoverageStatusStrip hours={hours} />);
  expect(screen.getByLabelText(/short 2/i)).toBeInTheDocument();
  expect(screen.getByRole('list', { name: /understaffed/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement.** Cells: `delta < 0` → red tint bg + `text-destructive`; else → teal/emerald tint. Each cell `aria-label={\`${hourLabel}, ${delta<0? 'short '+(-delta): 'covered'}\`}`. Below, a `sr-only` `<ul aria-label="Understaffed windows">` listing each short hour. Keep `minutesToCompact`/hour formatting consistent with the rest of the timeline.

- [ ] **Step 4: Tests + lint. Commit.**

---

## Task 5: Wire into `ShiftTimelineTab`; remove old components

**Files:**
- Modify: `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`
- Delete: `src/components/scheduling/ShiftTimeline/CoverageCurve.tsx`, `CoverageGapList.tsx`
- Delete/replace tests: `tests/unit/coverageGapList.test.tsx` → covered by `coverageStatusStrip.test.tsx`

- [ ] **Step 1:** Add `const hourlySummary = useMemo(() => summarizeCoverageHours(model.coverage, model.demand, model.window), [model])` and `const verdict = useMemo(() => buildVerdict(hourlySummary), [hourlySummary])`. Add `const [coverageView, setCoverageView] = useState<'area'|'delta'>('area')`.

- [ ] **Step 2:** Replace the `CoverageCurve` + `CoverageGapList` block with: `<CoverageVerdict verdict={verdict} />`, a small `Chart | +/− bars` toggle (shadcn `ToggleGroup type="single"`, `aria-label="Coverage chart view"`), `<CoverageChart hours={hourlySummary} view={coverageView} />` (kept inside the same `pl-[120px]` aligned wrapper), then `<CoverageStatusStrip hours={hourlySummary} />`. Remove the `CoverageCurve`/`CoverageGapList` imports.

- [ ] **Step 3:** `git rm` the two old component files; update any barrel/imports; adjust `tests/unit/coverageGapList.test.tsx` (delete — replaced).

- [ ] **Step 4: Full local verify** — `npm run typecheck && npm run lint && TZ=UTC npm run test && npm run build`. Fix until green.

- [ ] **Step 5: Commit** — `feat(scheduling): redesign coverage panel — verdict, shortfall chart, +/- bars, status strip`.

---

## Self-review notes

- **Spec coverage:** hourly summary (T1), verdict (T2), chart+wedge+delta (T3), status strip / gap-list fold (T4), wire-up + removals (T5). All map.
- **Sonar:** condition-heavy logic is in `coverageSummary.ts` (T1) with multi-branch fixtures (met / short / no-demand / worst-selection) to keep new-code condition coverage ≥80%. Components under `src/components` are coverage-excluded by convention; keep logic in `src/lib`.
- **No new data fetching, no DB/edge changes** — presentation over existing model data.
- **Type consistency:** `CoverageHour` / `CoverageVerdict` defined in T1 and consumed unchanged in T2–T5.
