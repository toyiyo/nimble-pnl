# SPLH Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visualize actual sales-per-labor-hour (SPLH) across the dashboard and Scheduling so an owner can see over/under-staffing, historical trend, and which hours to hire/trim.

**Architecture:** Pure, TZ-aware transforms in `src/lib/splhAnalytics.ts` (measured dir, unit-tested); labor hours come from the existing `timePunchProcessing.identifyWorkSessions` (break-aware, anomaly-tolerant); two React-Query hooks (`useSplhSummary` for the dashboard card, `useSplhAnalytics` for the Scheduling panel) fetch paginated `unified_sales` + `time_punches` and delegate all math to the lib. UI: a Recharts timeline + a CSS-grid diverging heatmap.

**Tech Stack:** React 18 + TS, React Query, Recharts, TailwindCSS/shadcn, Vitest.

**Reference:** Design doc `docs/superpowers/specs/2026-07-13-splh-visualization-design.md`.

---

## File Structure

- Create `src/lib/splhAnalytics.ts` — types + pure transforms (`validateTimeZone`, `distributeWorkedHours`, `buildSplhGrid`, `buildSplhTimeseries`, `summarizeSplh`).
- Create `tests/unit/splhAnalytics.test.ts` — unit tests for the lib.
- Create `src/hooks/useSplhData.ts` — shared paginated fetch of sales + punches (internal to the two hooks).
- Create `src/hooks/useSplhAnalytics.ts` — full hook (grid + daily + weekly + summary).
- Create `src/hooks/useSplhSummary.ts` — summary hook (headline + daily sparkline).
- Create `src/components/scheduling/ShiftPlanner/SplhHeatmap.tsx`.
- Create `src/components/scheduling/ShiftPlanner/SplhTimelineChart.tsx`.
- Create `src/components/scheduling/ShiftPlanner/LaborEfficiencyPanel.tsx` — heatmap + callout + timeline + day/week toggle.
- Create `src/components/dashboard/LaborEfficiencyCard.tsx`.
- Modify `src/index.css` — add `--splh-lean`, `--splh-slack`, `--splh-balanced` tokens (light + dark).
- Modify `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` — mount `LaborEfficiencyPanel`.
- Modify `src/pages/Index.tsx` — mount collapsible `LaborEfficiencyCard`.
- Modify `src/hooks/useWeekStaffingSuggestions.ts` — fix dead `punch_type` filter (bundled bug).
- Modify `tests/unit/useWeekStaffingSuggestions.test.ts` (or create) — regression test for real punch_type.

---

## Task 1: Heatmap color tokens

**Files:**
- Modify: `src/index.css` (`:root` light block and the `.dark` block)

- [ ] **Step 1: Add tokens to the light `:root` block** (alongside the existing `--chart-*` vars)

```css
    --splh-lean: 0 72% 51%;       /* red — above target, likely understaffed */
    --splh-slack: 211 72% 53%;    /* blue — below target, likely overstaffed */
    --splh-balanced: 240 5% 65%;  /* neutral gray — on target */
```

- [ ] **Step 2: Add dark-mode overrides to the `.dark` block**

```css
    --splh-lean: 0 72% 58%;
    --splh-slack: 211 78% 62%;
    --splh-balanced: 240 5% 55%;
```

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(splh): add diverging heatmap color tokens (light + dark)"
```

---

## Task 2: Lib types + `validateTimeZone`

**Files:**
- Create: `src/lib/splhAnalytics.ts`
- Test: `tests/unit/splhAnalytics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateTimeZone } from '@/lib/splhAnalytics';

describe('validateTimeZone', () => {
  it('passes through a valid IANA zone', () => {
    expect(validateTimeZone('America/New_York')).toBe('America/New_York');
  });
  it('falls back to UTC for an invalid zone', () => {
    expect(validateTimeZone('Not/AZone')).toBe('UTC');
    expect(validateTimeZone('')).toBe('UTC');
    expect(validateTimeZone(undefined)).toBe('UTC');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- splhAnalytics`
Expected: FAIL (module not found / export missing)

- [ ] **Step 3: Write minimal implementation**

```ts
import type { WorkSession } from '@/utils/timePunchProcessing';

export type SplhCellState = 'lean' | 'balanced' | 'slack' | 'no-labor' | 'closed';

export interface HourContribution {
  localDate: string; // YYYY-MM-DD in tz
  dow: number;       // 0=Sun..6=Sat (UTC-derived from localDate)
  hour: number;      // 0..23 local
  hours: number;
}

export interface SplhGridCell {
  dow: number;
  hour: number;
  totalSales: number;
  totalHours: number;
  splh: number | null;
  state: SplhCellState;
}

export interface SplhPoint {
  bucketStart: string; // local YYYY-MM-DD (Monday for week)
  label: string;
  totalSales: number;
  totalHours: number;
  splh: number | null;
}

export interface SplhSummary {
  actualSplh: number | null;
  target: number;
  laborPct: number | null;
  verdict: string;
  verdictTone: 'lean' | 'balanced' | 'slack' | 'none';
  hireHours: { dow: number; hour: number }[];
  trimHours: { dow: number; hour: number }[];
}

export interface SplhSaleRow {
  sale_date: string;
  sale_time: string | null;
  sold_at?: string | null;
  total_price: number;
}

/** ±band around target counts as "balanced". */
export const BALANCED_BAND = 0.15;

const _fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = _fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    _fmtCache.set(tz, f);
  }
  return f;
}

export function validateTimeZone(tz: string | undefined | null): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- splhAnalytics`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/splhAnalytics.ts tests/unit/splhAnalytics.test.ts
git commit -m "feat(splh): lib scaffold + validateTimeZone"
```

---

## Task 3: `distributeWorkedHours` (break-aware, tz-correct hour buckets)

**Files:**
- Modify: `src/lib/splhAnalytics.ts`
- Test: `tests/unit/splhAnalytics.test.ts`

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { distributeWorkedHours } from '@/lib/splhAnalytics';
import type { WorkSession } from '@/utils/timePunchProcessing';

function session(partial: Partial<WorkSession>): WorkSession {
  return {
    sessionId: 's', employee_id: 'e', employee_name: 'n',
    clock_in: new Date(), clock_out: undefined, breaks: [],
    total_minutes: 0, break_minutes: 0, worked_minutes: 0,
    is_complete: false, has_anomalies: false, anomalies: [],
    ...partial,
  };
}

describe('distributeWorkedHours', () => {
  const tz = 'America/New_York'; // UTC-4 in July (DST)

  it('returns [] for an incomplete session', () => {
    expect(distributeWorkedHours(session({ clock_in: new Date(Date.UTC(2026,6,1,20,0)) }), tz)).toEqual([]);
  });

  it('buckets a 2h15m single-day session by local hour', () => {
    // 17:00–19:15 local EDT = 21:00Z–23:15Z on 2026-07-01
    const s = session({
      clock_in: new Date(Date.UTC(2026,6,1,21,0)),
      clock_out: new Date(Date.UTC(2026,6,1,23,15)),
      is_complete: true,
    });
    const c = distributeWorkedHours(s, tz);
    expect(c.map(x => [x.hour, Math.round(x.hours*100)/100])).toEqual([[17,1],[18,1],[19,0.25]]);
    expect(c.every(x => x.localDate === '2026-07-01')).toBe(true);
    expect(c[0].dow).toBe(3); // 2026-07-01 is a Wednesday
  });

  it('excludes a complete break from the buckets', () => {
    // 17:00–19:00 local, 30-min break 17:30–18:00 → worked hour17=0.5, hour18=1
    const s = session({
      clock_in: new Date(Date.UTC(2026,6,1,21,0)),
      clock_out: new Date(Date.UTC(2026,6,1,23,0)),
      breaks: [{ break_start: new Date(Date.UTC(2026,6,1,21,30)), break_end: new Date(Date.UTC(2026,6,1,22,0)), duration_minutes: 30, is_complete: true }],
      is_complete: true,
    });
    const c = distributeWorkedHours(s, tz);
    const byHour = Object.fromEntries(c.map(x => [x.hour, Math.round(x.hours*100)/100]));
    expect(byHour).toEqual({ 17: 0.5, 18: 1 });
  });

  it('splits an overnight shift across two dates/dows', () => {
    // 22:00 Wed → 02:00 Thu local = 02:00Z Thu → 06:00Z Thu
    const s = session({
      clock_in: new Date(Date.UTC(2026,6,2,2,0)),
      clock_out: new Date(Date.UTC(2026,6,2,6,0)),
      is_complete: true,
    });
    const c = distributeWorkedHours(s, tz);
    const dates = new Set(c.map(x => x.localDate));
    expect(dates.has('2026-07-01')).toBe(true); // 22:00,23:00 Wed
    expect(dates.has('2026-07-02')).toBe(true); // 00:00,01:00 Thu
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- splhAnalytics`
Expected: FAIL (distributeWorkedHours not exported)

- [ ] **Step 3: Implement** (append to `src/lib/splhAnalytics.ts`)

```ts
interface LocalParts { date: string; dow: number; hour: number; minuteOfHour: number; }

function localParts(ms: number, tz: string): LocalParts {
  const p = partsFormatter(tz).formatToParts(new Date(ms));
  const get = (t: string) => p.find(x => x.type === t)!.value;
  const y = +get('year'), mo = +get('month'), d = +get('day');
  const hour = +get('hour') % 24;
  const minuteOfHour = +get('minute') + +get('second') / 60;
  const date = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { date, dow, hour, minuteOfHour };
}

/** [start,end) minus complete breaks → contiguous worked sub-intervals (ms pairs). */
function workedIntervals(session: WorkSession): [number, number][] {
  if (!session.clock_out) return [];
  const start = session.clock_in.getTime();
  const end = session.clock_out.getTime();
  if (end <= start) return [];
  const breaks = session.breaks
    .filter(b => b.is_complete && b.break_end)
    .map(b => [b.break_start.getTime(), b.break_end!.getTime()] as [number, number])
    .filter(([bs, be]) => be > bs)
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cursor = start;
  for (const [bs, be] of breaks) {
    const s = Math.max(cursor, bs);
    if (s > cursor) out.push([cursor, Math.min(s, end)]);
    cursor = Math.max(cursor, Math.min(be, end));
    if (cursor >= end) break;
  }
  if (cursor < end) out.push([cursor, end]);
  return out.filter(([a, b]) => b > a);
}

export function distributeWorkedHours(session: WorkSession, tz: string): HourContribution[] {
  const out: HourContribution[] = [];
  for (const [start, end] of workedIntervals(session)) {
    let cursor = start;
    while (cursor < end) {
      const { date, dow, hour, minuteOfHour } = localParts(cursor, tz);
      const minsLeft = 60 - minuteOfHour;
      const chunkMs = Math.min(end - cursor, minsLeft * 60000);
      out.push({ localDate: date, dow, hour, hours: chunkMs / 3600000 });
      cursor += chunkMs;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- splhAnalytics`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/splhAnalytics.ts tests/unit/splhAnalytics.test.ts
git commit -m "feat(splh): distributeWorkedHours — break-aware, tz-correct hour buckets"
```

---

## Task 4: `buildSplhGrid`

**Files:**
- Modify: `src/lib/splhAnalytics.ts`
- Test: `tests/unit/splhAnalytics.test.ts`

- [ ] **Step 1: Write failing tests** (append)

```ts
import { buildSplhGrid, classifySplh } from '@/lib/splhAnalytics';

describe('classifySplh', () => {
  it('classifies vs target with ±15% band', () => {
    expect(classifySplh(60, 60)).toBe('balanced');
    expect(classifySplh(80, 60)).toBe('lean');   // above target
    expect(classifySplh(40, 60)).toBe('slack');  // below target
  });
});

describe('buildSplhGrid', () => {
  const tz = 'UTC';
  it('computes cell SPLH = sales/hours and state', () => {
    const sales = [{ sale_date: '2026-07-01', sale_time: null, sold_at: '2026-07-01T17:00:00Z', total_price: 300 }];
    const sessions = [session({
      clock_in: new Date(Date.UTC(2026,6,1,17,0)),
      clock_out: new Date(Date.UTC(2026,6,1,20,0)),
      is_complete: true,
    })];
    const grid = buildSplhGrid(sales, sessions, tz, 60);
    const cell = grid.find(c => c.hour === 17 && c.dow === 3)!; // Wed 17:00
    expect(cell.totalSales).toBe(300);
    expect(cell.totalHours).toBeCloseTo(1, 5);
    expect(cell.splh).toBe(300);
    expect(cell.state).toBe('lean');
  });

  it('marks sales-without-labor as no-labor (never Infinity)', () => {
    const sales = [{ sale_date: '2026-07-01', sale_time: null, sold_at: '2026-07-01T17:00:00Z', total_price: 100 }];
    const grid = buildSplhGrid(sales, [], tz, 60);
    const cell = grid.find(c => c.hour === 17)!;
    expect(cell.splh).toBeNull();
    expect(cell.state).toBe('no-labor');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm run test -- splhAnalytics` — Expected: FAIL

- [ ] **Step 3: Implement** (append)

```ts
export function classifySplh(splh: number, target: number): 'lean' | 'balanced' | 'slack' {
  if (target <= 0) return 'balanced';
  if (splh > target * (1 + BALANCED_BAND)) return 'lean';
  if (splh < target * (1 - BALANCED_BAND)) return 'slack';
  return 'balanced';
}

function hourOfSale(sale: SplhSaleRow, tz: string): number | null {
  if (sale.sold_at) {
    const h = localParts(new Date(sale.sold_at).getTime(), tz).hour;
    return Number.isNaN(h) ? null : h;
  }
  if (sale.sale_time) {
    const h = parseInt(sale.sale_time.split(':')[0], 10);
    return Number.isNaN(h) ? null : h;
  }
  return null;
}

function dowOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function buildSplhGrid(
  sales: SplhSaleRow[], sessions: WorkSession[], tz: string, target: number,
): SplhGridCell[] {
  const key = (dow: number, hour: number) => dow * 24 + hour;
  const salesMap = new Map<number, number>();
  const hoursMap = new Map<number, number>();

  for (const sale of sales) {
    const hour = hourOfSale(sale, tz);
    if (hour === null) continue;
    const dow = dowOfDate(sale.sale_date);
    salesMap.set(key(dow, hour), (salesMap.get(key(dow, hour)) ?? 0) + Number(sale.total_price));
  }
  for (const s of sessions) {
    for (const c of distributeWorkedHours(s, tz)) {
      hoursMap.set(key(c.dow, c.hour), (hoursMap.get(key(c.dow, c.hour)) ?? 0) + c.hours);
    }
  }

  const cells: SplhGridCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const totalSales = salesMap.get(key(dow, hour)) ?? 0;
      const totalHours = hoursMap.get(key(dow, hour)) ?? 0;
      let splh: number | null = null;
      let state: SplhCellState;
      if (totalSales === 0 && totalHours < 0.01) { state = 'closed'; }
      else if (totalHours < 0.01) { state = 'no-labor'; }
      else { splh = Math.round(totalSales / totalHours); state = classifySplh(splh, target); }
      cells.push({ dow, hour, totalSales: Math.round(totalSales * 100) / 100, totalHours: Math.round(totalHours * 100) / 100, splh, state });
    }
  }
  return cells;
}
```

- [ ] **Step 4: Run to verify it passes** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(splh): buildSplhGrid + classifySplh"`

---

## Task 5: `buildSplhTimeseries` (day + Monday-start week)

**Files:** Modify `src/lib/splhAnalytics.ts`; Test `tests/unit/splhAnalytics.test.ts`

- [ ] **Step 1: Failing tests** (append)

```ts
import { buildSplhTimeseries } from '@/lib/splhAnalytics';

describe('buildSplhTimeseries', () => {
  const tz = 'UTC';
  const sales = [
    { sale_date: '2026-07-01', sale_time: null, sold_at: '2026-07-01T17:00:00Z', total_price: 200 },
    { sale_date: '2026-07-02', sale_time: null, sold_at: '2026-07-02T17:00:00Z', total_price: 400 },
  ];
  const sessions = [
    session({ clock_in: new Date(Date.UTC(2026,6,1,17,0)), clock_out: new Date(Date.UTC(2026,6,1,21,0)), is_complete: true }),
    session({ clock_in: new Date(Date.UTC(2026,6,2,17,0)), clock_out: new Date(Date.UTC(2026,6,2,21,0)), is_complete: true }),
  ];
  it('daily buckets: one point per date with splh = sales/hours', () => {
    const pts = buildSplhTimeseries(sales, sessions, tz, 'day');
    const p1 = pts.find(p => p.bucketStart === '2026-07-01')!;
    expect(p1.totalSales).toBe(200);
    expect(p1.totalHours).toBeCloseTo(4, 5);
    expect(p1.splh).toBe(50);
  });
  it('weekly buckets group by Monday-start week', () => {
    const pts = buildSplhTimeseries(sales, sessions, tz, 'week');
    // 2026-06-29 is the Monday of the week containing Jul 1–2
    expect(pts).toHaveLength(1);
    expect(pts[0].bucketStart).toBe('2026-06-29');
    expect(pts[0].totalSales).toBe(600);
    expect(pts[0].splh).toBe(75); // 600 / 8h
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL

- [ ] **Step 3: Implement** (append)

```ts
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun
  const diff = (dow + 6) % 7; // days since Monday
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().slice(0, 10);
}

export function buildSplhTimeseries(
  sales: SplhSaleRow[], sessions: WorkSession[], tz: string, granularity: 'day' | 'week',
): SplhPoint[] {
  const bucketOf = (localDate: string) => granularity === 'week' ? mondayOf(localDate) : localDate;
  const salesMap = new Map<string, number>();
  const hoursMap = new Map<string, number>();

  for (const sale of sales) {
    const bucket = bucketOf(sale.sale_date);
    salesMap.set(bucket, (salesMap.get(bucket) ?? 0) + Number(sale.total_price));
  }
  for (const s of sessions) {
    for (const c of distributeWorkedHours(s, tz)) {
      const bucket = bucketOf(c.localDate);
      hoursMap.set(bucket, (hoursMap.get(bucket) ?? 0) + c.hours);
    }
  }

  const buckets = Array.from(new Set([...salesMap.keys(), ...hoursMap.keys()])).sort();
  return buckets.map((bucketStart) => {
    const totalSales = salesMap.get(bucketStart) ?? 0;
    const totalHours = hoursMap.get(bucketStart) ?? 0;
    const splh = totalHours >= 0.01 ? Math.round(totalSales / totalHours) : null;
    return { bucketStart, label: bucketStart, totalSales: Math.round(totalSales * 100) / 100, totalHours: Math.round(totalHours * 100) / 100, splh };
  });
}
```

- [ ] **Step 4: Run to verify it passes** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(splh): buildSplhTimeseries (day + Monday-start week)"`

---

## Task 6: `summarizeSplh`

**Files:** Modify `src/lib/splhAnalytics.ts`; Test `tests/unit/splhAnalytics.test.ts`

- [ ] **Step 1: Failing tests** (append)

```ts
import { summarizeSplh } from '@/lib/splhAnalytics';

describe('summarizeSplh', () => {
  it('headline SPLH, verdict tone, and labor% when wage provided', () => {
    const grid = [
      { dow: 5, hour: 18, totalSales: 900, totalHours: 10, splh: 90, state: 'lean' as const },
      { dow: 5, hour: 19, totalSales: 900, totalHours: 10, splh: 90, state: 'lean' as const },
    ];
    const s = summarizeSplh(grid, 60, 1500);
    expect(s.actualSplh).toBe(90);
    expect(s.verdictTone).toBe('lean');
    // labor% = (20h * $15) / $1800 = 16.67%
    expect(s.laborPct).toBeCloseTo(16.67, 1);
    expect(s.hireHours).toContainEqual({ dow: 5, hour: 18 });
  });
  it('labor% is null with no wage', () => {
    const s = summarizeSplh([{ dow: 1, hour: 12, totalSales: 60, totalHours: 1, splh: 60, state: 'balanced' }], 60, null);
    expect(s.laborPct).toBeNull();
    expect(s.verdictTone).toBe('balanced');
  });
  it('empty grid → null actualSplh, none tone', () => {
    const s = summarizeSplh([], 60, 1500);
    expect(s.actualSplh).toBeNull();
    expect(s.verdictTone).toBe('none');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL

- [ ] **Step 3: Implement** (append)

```ts
export function summarizeSplh(
  grid: SplhGridCell[], target: number, avgHourlyRateCents: number | null,
): SplhSummary {
  let totalSales = 0, totalHours = 0;
  const hireHours: { dow: number; hour: number }[] = [];
  const trimHours: { dow: number; hour: number }[] = [];
  for (const c of grid) {
    totalSales += c.totalSales;
    totalHours += c.totalHours;
    if (c.state === 'lean') hireHours.push({ dow: c.dow, hour: c.hour });
    else if (c.state === 'slack') trimHours.push({ dow: c.dow, hour: c.hour });
  }
  const actualSplh = totalHours >= 0.01 ? Math.round(totalSales / totalHours) : null;
  const laborPct = avgHourlyRateCents && totalSales > 0
    ? Math.round(((totalHours * (avgHourlyRateCents / 100)) / totalSales) * 10000) / 100
    : null;

  let verdictTone: SplhSummary['verdictTone'] = 'none';
  let verdict = 'Not enough data to assess staffing yet.';
  if (actualSplh !== null) {
    const tone = classifySplh(actualSplh, target);
    verdictTone = tone;
    const pct = Math.round(Math.abs(actualSplh - target) / target * 100);
    if (tone === 'lean') verdict = `Running lean — ${pct}% above your $${target} target. You may be understaffed at peak.`;
    else if (tone === 'slack') verdict = `Running slack — ${pct}% below your $${target} target. You may be overstaffed.`;
    else verdict = `On target — right around your $${target} SPLH goal.`;
  }
  return { actualSplh, target, laborPct, verdict, verdictTone, hireHours, trimHours };
}
```

- [ ] **Step 4: Run to verify it passes** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(splh): summarizeSplh — headline, verdict, hire/trim"`

---

## Task 7: Shared paginated fetch `useSplhData`

**Files:** Create `src/hooks/useSplhData.ts`

- [ ] **Step 1: Implement** (no dedicated unit test — thin fetch wrapper covered via hook usage; keep logic minimal)

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { SplhSaleRow } from '@/lib/splhAnalytics';
import type { TimePunch } from '@/types/timeTracking';

const PAGE = 1000;
const MAX_PAGES = 20; // hard cap (§5)

async function fetchAllSales(restaurantId: string, startStr: string, endStr: string): Promise<{ rows: SplhSaleRow[]; capped: boolean }> {
  const rows: SplhSaleRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from('unified_sales')
      .select('sale_date, sale_time, sold_at, total_price')
      .eq('restaurant_id', restaurantId)
      .eq('item_type', 'sale')
      .is('parent_sale_id', null)
      .gte('sale_date', startStr)
      .lte('sale_date', endStr)
      .order('sale_date').order('created_at').order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as SplhSaleRow[]));
    if (!data || data.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

async function fetchAllPunches(restaurantId: string, startStr: string, endStr: string): Promise<{ rows: TimePunch[]; capped: boolean }> {
  const rows: TimePunch[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from('time_punches')
      .select('id, restaurant_id, employee_id, punch_type, punch_time')
      .eq('restaurant_id', restaurantId)
      .gte('punch_time', startStr)
      .lte('punch_time', endStr + 'T23:59:59')
      .order('employee_id').order('punch_time').order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as TimePunch[]));
    if (!data || data.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

/** Window boundaries from restaurant-local "today" (§5). */
function localWindow(tz: string, weeks: number): { startStr: string; endStr: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const endStr = fmt.format(now); // YYYY-MM-DD in tz
  const [y, m, d] = endStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  start.setUTCDate(start.getUTCDate() - weeks * 7);
  return { startStr: start.toISOString().slice(0, 10), endStr };
}

export function useSplhData(restaurantId: string | null, tz: string, weeks: number) {
  return useQuery({
    queryKey: ['splh-data', restaurantId, tz, weeks],
    queryFn: async () => {
      const { startStr, endStr } = localWindow(tz, weeks);
      const [sales, punches] = await Promise.all([
        fetchAllSales(restaurantId!, startStr, endStr),
        fetchAllPunches(restaurantId!, startStr, endStr),
      ]);
      return { sales: sales.rows, punches: punches.rows, capped: sales.capped || punches.capped };
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });
}
```

- [ ] **Step 2: Commit** — `git add src/hooks/useSplhData.ts && git commit -m "feat(splh): paginated sales+punches fetch (split-guard, deterministic order, cap)"`

---

## Task 8: `useSplhAnalytics` + `useSplhSummary`

**Files:** Create `src/hooks/useSplhAnalytics.ts`, `src/hooks/useSplhSummary.ts`

- [ ] **Step 1: Implement `useSplhAnalytics.ts`**

```ts
import { useMemo } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { validateTimeZone, buildSplhGrid, buildSplhTimeseries, summarizeSplh } from '@/lib/splhAnalytics';
import { useSplhData } from '@/hooks/useSplhData';

const WEEKS = 12; // covers weekly timeline; grid uses same rows

export function useSplhAnalytics(restaurantId: string | null) {
  const { selectedRestaurant } = useRestaurantContext();
  const tz = validateTimeZone(selectedRestaurant?.restaurant?.timezone);
  const { effectiveSettings } = useStaffingSettings(restaurantId);
  const { employees } = useEmployees(restaurantId);
  const target = effectiveSettings.target_splh;
  const avgRate = useMemo(() => computeAvgHourlyRateCents(employees), [employees]);

  const { data, isLoading, isError, error, refetch } = useSplhData(restaurantId, tz, WEEKS);

  const sessions = useMemo(
    () => (data?.punches?.length ? identifyWorkSessions(normalizePunches(data.punches)) : []),
    [data?.punches],
  );
  const grid = useMemo(() => data ? buildSplhGrid(data.sales, sessions, tz, target) : [], [data, sessions, tz, target]);
  const daily = useMemo(() => data ? buildSplhTimeseries(data.sales, sessions, tz, 'day') : [], [data, sessions, tz]);
  const weekly = useMemo(() => data ? buildSplhTimeseries(data.sales, sessions, tz, 'week') : [], [data, sessions, tz]);
  const summary = useMemo(() => summarizeSplh(grid, target, avgRate), [grid, target, avgRate]);
  const hasHourlyBreakdown = useMemo(() => (data?.sales ?? []).some(s => !!s.sold_at), [data?.sales]);

  return {
    grid, daily, weekly, summary, target, tz,
    hasHourlyBreakdown,
    capped: data?.capped ?? false,
    hasData: (data?.sales?.length ?? 0) > 0,
    isLoading, isError, error, refetch,
  };
}
```

- [ ] **Step 2: Implement `useSplhSummary.ts`** (dashboard — skips grid/weekly)

```ts
import { useMemo } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { validateTimeZone, buildSplhGrid, buildSplhTimeseries, summarizeSplh } from '@/lib/splhAnalytics';
import { useSplhData } from '@/hooks/useSplhData';

const WEEKS = 4; // dashboard summary + ~30-day sparkline

export function useSplhSummary(restaurantId: string | null) {
  const { selectedRestaurant } = useRestaurantContext();
  const tz = validateTimeZone(selectedRestaurant?.restaurant?.timezone);
  const { effectiveSettings } = useStaffingSettings(restaurantId);
  const { employees } = useEmployees(restaurantId);
  const target = effectiveSettings.target_splh;
  const avgRate = useMemo(() => computeAvgHourlyRateCents(employees), [employees]);

  const { data, isLoading, isError } = useSplhData(restaurantId, tz, WEEKS);
  const sessions = useMemo(
    () => (data?.punches?.length ? identifyWorkSessions(normalizePunches(data.punches)) : []),
    [data?.punches],
  );
  const grid = useMemo(() => data ? buildSplhGrid(data.sales, sessions, tz, target) : [], [data, sessions, tz, target]);
  const summary = useMemo(() => summarizeSplh(grid, target, avgRate), [grid, target, avgRate]);
  const sparkline = useMemo(() => data ? buildSplhTimeseries(data.sales, sessions, tz, 'day') : [], [data, sessions, tz]);

  return { summary, sparkline, target, isLoading, isError, hasData: (data?.sales?.length ?? 0) > 0 };
}
```

- [ ] **Step 3: Typecheck** — Run: `npm run typecheck` — Expected: no errors
- [ ] **Step 4: Commit** — `git commit -m "feat(splh): useSplhAnalytics + useSplhSummary hooks"`

---

## Task 9: Fix `useWeekStaffingSuggestions` punch_type bug (bundled)

**Files:** Modify `src/hooks/useWeekStaffingSuggestions.ts`; Test `tests/unit/useWeekStaffingSuggestions.actualSplh.test.ts`

- [ ] **Step 1: Write a failing regression test** proving real punch_type strings produce a non-null actualSplh. Test the extracted pure helper (extract the pairing into `computeActualSplh(sales, punches)` in the hook file's module scope, or reuse `identifyWorkSessions`).

```ts
import { describe, it, expect } from 'vitest';
import { computeActualSplh } from '@/hooks/useWeekStaffingSuggestions';

it('computes actual SPLH from clock_in/clock_out punches', () => {
  const sales = [{ total_price: 600 }];
  const punches = [
    { employee_id: 'e1', punch_type: 'clock_in', punch_time: '2026-07-01T17:00:00Z' },
    { employee_id: 'e1', punch_type: 'clock_out', punch_time: '2026-07-01T21:00:00Z' },
  ];
  expect(computeActualSplh(sales as any, punches as any)).toBe(150); // 600 / 4h
});
it('returns null when punches use no recognized types', () => {
  expect(computeActualSplh([{ total_price: 100 }] as any, [{ employee_id: 'e', punch_type: 'in', punch_time: '2026-07-01T17:00:00Z' }] as any)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (export missing / still filters 'in'/'out')

- [ ] **Step 3: Refactor the hook** — extract `export function computeActualSplh(...)` using `identifyWorkSessions(normalizePunches(...))` for hours (or a minimal clock_in/clock_out pairing), and change the query filter from `.in('punch_type', ['in','out'])` to `.in('punch_type', ['clock_in','clock_out','break_start','break_end'])`. Update the inline pairing (lines 129-140) to the real types.

- [ ] **Step 4: Run to verify it passes** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "fix(scheduling): useWeekStaffingSuggestions actualSplh was always null (wrong punch_type)"`

---

## Task 10: `SplhTimelineChart` component

**Files:** Create `src/components/scheduling/ShiftPlanner/SplhTimelineChart.tsx`

- [ ] **Step 1: Implement** — Recharts `LineChart` over `SplhPoint[]`, single y-axis, `ReferenceLine y={target}` dashed with label `Target $${target}`, tooltip formatting `$X/labor-hr`, x-axis label from `bucketStart` (`format(parseISO(...), granularity==='week' ? "MMM d" : "MMM d")`), ticks `hsl(var(--muted-foreground))`, `tickLine/axisLine={false}`. Skip points where `splh === null` (use `connectNulls={false}`). `chartData` via `useMemo`. Mirror styling of `src/components/budget/SalesVsBreakEvenChart.tsx`. Props: `{ points: SplhPoint[]; target: number; granularity: 'day'|'week' }`. Handle empty via a caller-level guard.

- [ ] **Step 2: Typecheck + commit** — `git commit -m "feat(splh): SplhTimelineChart"`

---

## Task 11: `SplhHeatmap` component (a11y grid)

**Files:** Create `src/components/scheduling/ShiftPlanner/SplhHeatmap.tsx`

- [ ] **Step 1: Implement** per design §7.1/§7.2:
  - Props `{ cells: SplhGridCell[]; target: number; estimated: boolean }`.
  - Derive active hours (columns where any cell has sales or hours) via `useMemo`; trim dead columns.
  - Outer `role="grid"`, header row of hour labels, one `role="row"` per dow (Mon-first order for readability; label via `['Mon',...]`). Day-label cell `sticky left-0 z-10 bg-background`.
  - Each data cell: `role="gridcell"`, `tabIndex={0}`, `min-w-10 min-h-10`, `aria-label` = ``${dayName} ${hourLabel}: ${state==='closed'?'closed':state==='no-labor'?'sales but no labor logged':`$${splh} per labor hour, ${state}`}``, background color:
    - lean → `hsl(var(--splh-lean) / <opacity by distance>)`
    - slack → `hsl(var(--splh-slack) / <opacity>)`
    - balanced → `hsl(var(--splh-balanced) / 0.35)`
    - no-labor/closed → `bg-muted`
    - text shows `$${splh}` (or blank for closed) using `text-[11px]`, `text-foreground`/`text-muted-foreground`.
  - Legend row (swatch + label for lean/balanced/slack/closed). `overflow-x-auto` wrapper.
  - `estimated` → an "Estimated" badge + one-line note (uses `bg-muted` badge; text explains hours are spread when POS lacks timestamps).

- [ ] **Step 2: Typecheck + commit** — `git commit -m "feat(splh): SplhHeatmap — diverging grid, a11y, sticky labels"`

---

## Task 12: `LaborEfficiencyPanel` (Scheduling)

**Files:** Create `src/components/scheduling/ShiftPlanner/LaborEfficiencyPanel.tsx`

- [ ] **Step 1: Implement**:
  - Props `{ restaurantId: string }`; call `useSplhAnalytics(restaurantId)`.
  - Three states: `isLoading` → layout-shaped skeletons; `isError` → inline error; `!hasData` → `EmptyState` (invite POS/time-tracking).
  - Header card (`rounded-xl border border-border/40`): title "Labor efficiency", subtitle actual SPLH vs target + verdict line (tone-colored via `verdictTone`).
  - `SplhHeatmap` with `estimated={!hasHourlyBreakdown}`.
  - Hire/trim callout: neutral `bg-muted/30 border border-border/40 rounded-lg p-3`, summarizing top persistent `hireHours`/`trimHours` grouped into human ranges (e.g., "Fri 6–9pm"). Only render when non-empty.
  - Timeline section with a day/week `ToggleGroup` (`aria-label="Timeline granularity"`, `aria-pressed`), rendering `SplhTimelineChart` with `daily`/`weekly` + `target`.
  - If `capped`, show a small muted note: "Showing a partial window — narrow your date range for full accuracy."
  - Styling per CLAUDE.md tokens.

- [ ] **Step 2: Typecheck + commit** — `git commit -m "feat(splh): LaborEfficiencyPanel (heatmap + callout + timeline)"`

---

## Task 13: `LaborEfficiencyCard` (Dashboard)

**Files:** Create `src/components/dashboard/LaborEfficiencyCard.tsx`

- [ ] **Step 1: Implement**:
  - Props `{ restaurantId: string | null }`; call `useSplhSummary(restaurantId)`.
  - Three states as above (compact skeleton; error; empty invite).
  - Body: hero SPLH number (`text-[28px] font-semibold`), `vs $${target} target`, labor-% (when non-null), verdict line (tone-colored), a compact Recharts mini `<LineChart>` sparkline over `sparkline` points (no axes, `height 48`), and a `useNavigate()('/scheduling')` "View in Scheduling" ghost link.
  - Styling per CLAUDE.md tokens.

- [ ] **Step 2: Typecheck + commit** — `git commit -m "feat(splh): LaborEfficiencyCard (dashboard)"`

---

## Task 14: Wire into Scheduling Planner

**Files:** Modify `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

- [ ] **Step 1** Import `LaborEfficiencyPanel`; add collapsible state `const [laborEffOpen, setLaborEffOpen] = useState(false)` (default collapsed).
- [ ] **Step 2** Render a `<Collapsible open={laborEffOpen} onOpenChange={setLaborEffOpen}>` block near the `StaffingOverlay` mount (~line 674): `<h2>`-style header "Labor efficiency" + ghost chevron trigger with `aria-label={laborEffOpen ? "Collapse Labor efficiency" : "Expand Labor efficiency"}`, `CollapsibleContent` → `<LaborEfficiencyPanel restaurantId={restaurantId} />`.
- [ ] **Step 3** Typecheck + commit — `git commit -m "feat(splh): mount LaborEfficiencyPanel in Planner"`

---

## Task 15: Wire into Dashboard

**Files:** Modify `src/pages/Index.tsx`

- [ ] **Step 1** Import `LaborEfficiencyCard`; add `const [laborEfficiencyOpen, setLaborEfficiencyOpen] = useState(false)`.
- [ ] **Step 2** Add a `<Collapsible open={laborEfficiencyOpen} onOpenChange={setLaborEfficiencyOpen}>` section (mirroring the Cashflow block at ~line 853) with `<h2>Labor efficiency</h2>` + ghost chevron trigger (`aria-label` toggle text) → `<LaborEfficiencyCard restaurantId={restaurantId} />`. Place it after the Performance Overview / near Operations Health.
- [ ] **Step 3** Typecheck + commit — `git commit -m "feat(splh): mount LaborEfficiencyCard on dashboard"`

---

## Task 16: Coverage config + full verify

**Files:** Possibly modify `sonar-project.properties` / `vitest.config.ts` (only if new `.ts` non-component files need exclusion alignment — `src/lib/splhAnalytics.ts` is tested so it stays measured; `src/hooks/useSplhData.ts`, `useSplhAnalytics.ts`, `useSplhSummary.ts` are `use*.ts?` — confirm they match the existing `src/hooks/use*.tsx` exclusion or add `.ts` variants to BOTH lists per the SonarCloud lesson).

- [ ] **Step 1** Confirm hook files are `.ts`; check whether `vitest.config.ts coverage.exclude` and `sonar.coverage.exclusions` already cover `src/hooks/use*.ts`. If not, mirror the pattern in BOTH files (SonarCloud lesson 2026-05-16).
- [ ] **Step 2** Run full suite: `npm run test && npm run typecheck && npm run lint && npm run build`. Fix until green.
- [ ] **Step 3** Commit any config alignment — `git commit -m "chore(splh): align coverage excludes for new hooks"`

---

## Self-review notes

- Spec coverage: heatmap (T11), timeline day/week (T5,T10,T12), dashboard card (T13,T15), shared hooks split (T8), labor via `identifyWorkSessions` (T3,T8), split-sale guard + deterministic pagination + cap (T7), punch_type fix (T9), colors/a11y/sticky/collapsed-default (T1,T11,T12,T14,T15), TZ-portable tests (T2–T6). ✅
- Types consistent across tasks: `SplhSaleRow`, `SplhGridCell`, `SplhPoint`, `SplhSummary`, `HourContribution` all defined in T2 and reused.
- `operations_manager` RLS SELECT gap is intentionally out of scope (separate task filed).
