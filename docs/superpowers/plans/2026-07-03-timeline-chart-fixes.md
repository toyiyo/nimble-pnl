# Coverage Chart Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the coverage chart span the full hour grid (aligned with axis/lanes via the shared `minToPct` scale) and give every hour a hover/focus tooltip that explains scheduled vs needed with the projected-sales ÷ SPLH math. (#569 recovery is already committed on this branch — merge `1c470b95`.)

**Architecture:** Replace the fixed-viewBox SVG `CoverageChart` with per-hour absolutely-positioned HTML columns using `minToPct` (same as `TimelineBar`). Thread `projectedSales`/`laborPct` through `summarizeCoverageHours`; pass `targetSplh` from `activeSettings`. shadcn `Tooltip` per column.

**Spec:** `docs/superpowers/specs/2026-07-03-timeline-chart-fixes-design.md`

**Conventions:** semantic tokens + CLAUDE.md scale; `CRITICAL:` prefix on core-logic tests; TZ-portable tests run under UTC + Asia/Tokyo where time math is involved (none new here — hour columns consume pre-computed minutes).

---

## Task 1: Thread sales context through `summarizeCoverageHours`

**Files:**
- Modify: `src/lib/coverageSummary.ts`
- Modify: `tests/unit/coverageSummary.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import type { HourlyStaffingRecommendation } from '@/types/scheduling';
const recFull = (hour: number, staff: number, sales: number, laborPct: number): HourlyStaffingRecommendation =>
  ({ hour, recommendedStaff: staff, projectedSales: sales, estimatedLaborCost: 0, laborPct, overTarget: false });

describe('summarizeCoverageHours — sales context', () => {
  it('CRITICAL: carries projectedSales and laborPct from recommendations per hour', () => {
    const hrs = summarizeCoverageHours(coverage, demand, win, [recFull(10, 1, 480, 22.5), recFull(11, 3, 900, 30)]);
    expect(hrs[0]).toMatchObject({ hour: 10, projectedSales: 480, laborPct: 22.5 });
    expect(hrs[1]).toMatchObject({ hour: 11, projectedSales: 900 });
    expect(hrs[2].projectedSales).toBeNull(); // hour 12 has no rec
  });
  it('CRITICAL: projectedSales/laborPct are null when recs omitted (back-compat)', () => {
    const hrs = summarizeCoverageHours(coverage, demand, win);
    expect(hrs[0].projectedSales).toBeNull();
    expect(hrs[0].laborPct).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL** (`npm run test -- tests/unit/coverageSummary.test.ts`).

- [ ] **Step 3: Implement** — extend the interface and signature:

```ts
export interface CoverageHour {
  hour: number;
  startMin: number;
  scheduled: number;
  needed: number | null;
  delta: number | null;
  /** Projected sales for this hour from staffing recommendations (null when unavailable). */
  projectedSales: number | null;
  /** Estimated labor % for this hour (null when unavailable). */
  laborPct: number | null;
}

export function summarizeCoverageHours(
  coverage: { min: number; count: number }[],
  demand: { min: number; target: number }[] | null,
  window: { startMin: number; endMin: number },
  recs?: HourlyStaffingRecommendation[],
): CoverageHour[] {
  // ...existing body; build recByHour = new Map(recs?.map((r) => [r.hour, r]) ?? []);
  // in the per-hour push:
  //   const rec = recByHour.get(Math.floor(start / HOUR) % 24) ?? null;
  //   projectedSales: rec ? rec.projectedSales : null,
  //   laborPct: rec ? rec.laborPct : null,
}
```

Update `summarizeAreaCoverage`'s internal call (scheduled-only → no recs → nulls flow automatically). Fix any object-literal test fixtures of `CoverageHour` across suites to include the two new fields (or use `toMatchObject`).

- [ ] **Step 4: Run full coverage-related suites — PASS. Typecheck.**
- [ ] **Step 5: Commit** — `feat(scheduling): thread projectedSales/laborPct into CoverageHour`.

---

## Task 2: Rebuild `CoverageChart` as grid-aligned HTML columns

**Files:**
- Rewrite: `src/components/scheduling/ShiftTimeline/CoverageChart.tsx`
- Rewrite selectors: `tests/unit/coverageChart.test.tsx`

- [ ] **Step 1: Update tests first** (contracts preserved, selectors change)

```tsx
const minToPct = (min: number) => ((min - 600) / 240) * 100; // 10:00–14:00 window
const hours = [
  { hour: 10, startMin: 600, scheduled: 3, needed: 5, delta: -2, projectedSales: 480, laborPct: 22 },
  { hour: 11, startMin: 660, scheduled: 5, needed: 5, delta: 0, projectedSales: 900, laborPct: 30 },
];

it('renders one positioned column per hour, aligned to minToPct', () => {
  const { container } = render(<CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />);
  const cols = container.querySelectorAll('[data-hour-col]');
  expect(cols).toHaveLength(2);
  expect((cols[0] as HTMLElement).style.left).toBe('0%');
  expect((cols[0] as HTMLElement).style.width).toBe('25%'); // 60min of a 240min window
});
it('renders a shortfall block only for short hours', () => {
  const { container } = render(<CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />);
  expect(container.querySelectorAll('[data-shortfall]')).toHaveLength(1);
});
it('renders diverging bars with signed labels in delta view', () => {
  const { container, getByText } = render(<CoverageChart hours={hours} view="delta" minToPct={minToPct} targetSplh={95} />);
  expect(container.querySelectorAll('[data-bar="short"]')).toHaveLength(1);
  expect(getByText('-2')).toBeInTheDocument();
});
it('scales no-demand bars by headcount peak (delta view)', () => {
  const nd = [
    { hour: 10, startMin: 600, scheduled: 1, needed: null, delta: null, projectedSales: null, laborPct: null },
    { hour: 11, startMin: 660, scheduled: 4, needed: null, delta: null, projectedSales: null, laborPct: null },
  ];
  const { container } = render(<CoverageChart hours={nd} view="delta" minToPct={minToPct} targetSplh={null} />);
  const bars = Array.from(container.querySelectorAll('[data-bar="no-demand"]')) as HTMLElement[];
  const h = (el: HTMLElement) => parseFloat(el.style.height);
  expect(h(bars[1])).toBeGreaterThan(h(bars[0]) * 3); // 4 vs 1, proportional not pegged
});
```

- [ ] **Step 2: Run — FAIL** (new props/selectors don't exist).

- [ ] **Step 3: Implement.** New props:
  `{ hours, view, minToPct, targetSplh, height = 120 }`. Structure:

```tsx
<div className="relative" style={{ height }} role="img" aria-label={descText}>
  {/* y-gutter reference values: absolute left, text-[9px] text-muted-foreground */}
  {/* gridlines: absolute full-width border-t border-border/30 at value steps */}
  {hours.map((h) => (
    <HourColumn key={h.startMin} h={h} left={minToPct(h.startMin)} width={minToPct(h.startMin + 60) - minToPct(h.startMin)} ... />
  ))}
</div>
<Legend ... /> {/* unchanged */}
```

  `HourColumn` (internal, `data-hour-col`, `style={{ left: `${left}%`, width: `${width}%` }}`, `absolute inset-y-0`):
  - **area view:** bottom-anchored scheduled block (`data-scheduled`, `bg-primary/15 border-t border-primary`, `height: (scheduled/peak)*100%`); dashed needed tick (`data-needed`, absolute at `bottom: (needed/peak)*100%`, `border-t border-dashed border-muted-foreground`); shortfall block (`data-shortfall`, `bg-destructive/70`, spans between the two heights) when `delta < 0`, with the deficit number centered when tall enough (`text-[9px] text-background font-medium`).
  - **delta view:** zero line at 50%; bar `data-bar={short|covered|no-demand}` positioned above/below with `height: (|delta|/deltaPeak)*50%` (no-demand: `(scheduled/peak)*50%`, `bg-muted/60`); signed label `text-[8px]`.
  - `peak`/`deltaPeak` computed once in the parent exactly as today (preserve the `Math.max(1, …)` floors and the no-demand-scaled-by-peak review fix).

- [ ] **Step 4: Wire the tooltip (Task 3 does content; here just the shell).** Wrap each column in shadcn `Tooltip`/`TooltipTrigger asChild`/`TooltipContent`; `TooltipProvider` once at chart root. Column gets `tabIndex={0}` and `aria-label` (same sentence as tooltip).

- [ ] **Step 5: Update `ShiftTimelineTab` call site** — pass `minToPct` and `targetSplh` (destructure `activeSettings` from `useWeekStaffingSuggestions`; `targetSplh = activeSettings?.target_splh ?? null`); pass `dayRecommendations` into the `summarizeCoverageHours` call. Remove the now-unneeded chart-width assumptions (keep the `pl-[120px]` wrapper).

- [ ] **Step 6: Run chart + tab suites — PASS. Typecheck + lint. Commit** — `feat(scheduling): grid-aligned full-width coverage chart columns`.

---

## Task 3: Tooltip content with the sales ÷ SPLH story

**Files:**
- Modify: `src/components/scheduling/ShiftTimeline/CoverageChart.tsx`
- Modify: `tests/unit/coverageChart.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it('CRITICAL: tooltip explains scheduled, needed, and the sales ÷ SPLH math on focus', async () => {
  const user = userEvent.setup();
  render(<CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />);
  const col = screen.getAllByRole('img', { name: /10.*3 scheduled.*5 needed/i })[0];
  await user.tab(); // or col.focus()
  expect(await screen.findByText(/projected sales \$480/i)).toBeInTheDocument();
  expect(screen.getByText(/\$95.*labor.*hr/i)).toBeInTheDocument();
  expect(screen.getByText(/short 2/i)).toBeInTheDocument();
});
it('tooltip degrades gracefully with no demand/recs', async () => {
  // no-demand hour → "no demand target — set staffing targets…" line, no sales row
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement content** (pure helper `buildHourTooltip(h, targetSplh)` in the same file, returns lines; keeps branching testable):
  - Line 1: `10–11 AM` (via `formatCoverageHour`).
  - Line 2: `3 scheduled · 5 needed` (or `4 scheduled` when needed null).
  - Line 3 (when `projectedSales != null`): `Projected sales $480`.
  - Line 4 (when `targetSplh` and `projectedSales`): `÷ $95/labor-hr target ≈ 5 needed`.
  - Line 5: `Short 2 — add staff` / `Covered · +1 spare` / `Right on target` / (no demand) `No demand target — set staffing targets to see needed staff.`
  - `aria-label` on the column = the same lines joined with commas.
  - Currency via `toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })`.

- [ ] **Step 4: Run — PASS. Lint. Commit** — `feat(scheduling): per-hour tooltip — scheduled/needed + projected sales ÷ SPLH`.

---

## Task 4: Full verification

- [ ] `npm run typecheck && npm run lint && TZ=UTC npm run test && npm run build` — all green (fix forward until they are).
- [ ] Confirm recovered #569 suites still pass (areaCoverageStrips, coverageDemandInfo, coverageStatusStrip, shiftTimelineTab).
- [ ] Commit any stragglers.

---

## Self-review notes

- **Spec coverage:** A→Task 2, B→Task 1, C→Task 3, D already committed (merge `1c470b95`). Verification→Task 4.
- **Sonar:** new branching sits in `summarizeCoverageHours` (Task 1 fixtures hit rec-present/absent) and `buildHourTooltip` (Task 3 hits short/covered/spare/no-demand). Components remain coverage-excluded; keep `buildHourTooltip` pure and exported for direct testing if needed — if Sonar flags it, move it to `src/lib/coverageSummary.ts`.
- **Type consistency:** `CoverageHour` gains `projectedSales`/`laborPct` in Task 1; Tasks 2–3 consume them; all existing fixtures updated in Task 1.
