# Open-shift Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace exact-template-match "needs staff" with time-coverage (per-minute concurrent-minimum) across the banner count, the `get_open_shifts`/`claim_open_shift` RPCs, and the planner grid — and show per-slot coverage (who covers, what %, where the gaps are).

**Architecture:** One pure TS engine (`src/lib/shiftCoverage.ts`) computes a sweep-line concurrent-minimum over overlapping same-position shifts in the restaurant's timezone. A mirror SQL scalar function `shift_slot_min_concurrent` does the same and is shared by both claim RPCs so the offer and the claim guard agree. The planner renders a compact per-cell indicator and one lifted, accessible popover (Drawer on mobile).

**Tech Stack:** React 18 + TS, date-fns-tz, Vitest, Supabase Postgres (plpgsql), pgTAP, shadcn (Popover/Drawer).

**Reference spec:** `docs/superpowers/specs/2026-06-25-open-shift-coverage-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/shiftCoverage.ts` (NEW) | Pure engine: local-minute conversion, clip, sweep, `minConcurrent`, `openSpots`, `coveragePct`, `segments`, `coveringEmployees`. |
| `src/types/scheduling.ts` | `SlotCoverage`, `CoveringEmployee`, `CoverageSegment` types. |
| `src/pages/Scheduling.tsx` | `openShiftCount` uses the engine (drop `buildTemplateGridData`+`computeOpenSpots` there). |
| `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` | Tab-level coverage `Map` (memo + try/catch); single lifted popover/Drawer state. |
| `src/components/scheduling/ShiftPlanner/ShiftCell.tsx` | Compact accessible indicator; `onCoverageClick`; memo includes `coverage`. |
| `src/components/scheduling/ShiftPlanner/CoverageDetail.tsx` (NEW) | Popover/Drawer body: covering employees + gap segments. |
| `src/lib/openShiftHelpers.ts` | Extract `capacityFloor`; remove dead `computeOpenSpots`/`classifyCapacity` after migration. |
| `supabase/migrations/<ts>_open_shift_coverage.sql` (NEW) | `shift_slot_min_concurrent` fn; rewrite `get_open_shifts` + `claim_open_shift`. |
| `supabase/migrations/<ts2>_idx_shifts_coverage.sql` (NEW) | `CREATE INDEX CONCURRENTLY` composite. |
| `tests/unit/shiftCoverage.test.ts` (NEW) | Engine unit tests (TZ-portable). |
| `supabase/tests/open_shift_coverage.test.sql` (NEW) | pgTAP for the fn + RPCs. |

---

## Task 1: Coverage engine — types + minute conversion + min-concurrent core

**Files:**
- Create: `src/lib/shiftCoverage.ts`
- Create: `tests/unit/shiftCoverage.test.ts`
- Modify: `src/types/scheduling.ts` (append types)

- [ ] **Step 1: Add types to `src/types/scheduling.ts`**

```ts
export interface CoverageShift {
  employee_id: string;
  employee_name?: string | null;
  start_time: string; // ISO UTC from Supabase
  end_time: string;   // ISO UTC
  position: string;
  status?: string | null;
}
export interface CoverageSegment { startMin: number; endMin: number; covered: boolean; }
export interface CoveringEmployee { employeeId: string; employeeName?: string | null; startMin: number; endMin: number; }
export interface SlotCoverage {
  minConcurrent: number;
  openSpots: number;
  coveragePct: number;          // 0..100, rounded
  segments: CoverageSegment[];  // contiguous covered/gap runs across the window
  coveringEmployees: CoveringEmployee[];
}
```

- [ ] **Step 2: Write the failing test** (`tests/unit/shiftCoverage.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { capacityFloor, computeSlotCoverage } from '@/lib/shiftCoverage';
import type { CoverageShift } from '@/types/scheduling';

const mk = (emp: string, startIso: string, endIso: string, position = 'Server'): CoverageShift => ({
  employee_id: emp, start_time: startIso, end_time: endIso, position, status: 'scheduled',
});

describe('capacityFloor', () => {
  it('coerces 0/NaN/<1 to 1, passes valid through', () => {
    expect(capacityFloor(0)).toBe(1);
    expect(capacityFloor(Number.NaN)).toBe(1);
    expect(capacityFloor(-3)).toBe(1);
    expect(capacityFloor(3)).toBe(3);
  });
});

describe('computeSlotCoverage — min-concurrent', () => {
  // America/Chicago, 2026-06-27 (CDT, UTC-5). 10:00 local = 15:00Z.
  const tz = 'America/Chicago';
  const D = '2026-06-27';

  it('two fill-ins whose union covers a cap-1 window => 0 open, 100%', () => {
    // window 14:00-18:00 (4h, cap 1). A covers 14-15 (1h), B covers 15-18 (3h).
    const shifts = [
      mk('A', '2026-06-27T19:00:00Z', '2026-06-27T20:00:00Z'), // 14:00-15:00 CDT
      mk('B', '2026-06-27T20:00:00Z', '2026-06-27T23:00:00Z'), // 15:00-18:00 CDT
    ];
    const c = computeSlotCoverage('14:00:00', '18:00:00', 1, D, shifts, 'Server', tz);
    expect(c.minConcurrent).toBe(1);
    expect(c.openSpots).toBe(0);
    expect(c.coveragePct).toBe(100);
  });

  it('same-hour overlap leaves a gap => needs staff', () => {
    // both cover only 14-15 of a 14-18 cap-1 window
    const shifts = [
      mk('A', '2026-06-27T19:00:00Z', '2026-06-27T20:00:00Z'),
      mk('B', '2026-06-27T19:00:00Z', '2026-06-27T20:00:00Z'),
    ];
    const c = computeSlotCoverage('14:00:00', '18:00:00', 1, D, shifts, 'Server', tz);
    expect(c.minConcurrent).toBe(0);
    expect(c.openSpots).toBe(1);
  });

  it('mid-shift fill-in (non-matching window) covers the open template', () => {
    // template 10:00-16:30 cap 1; fill-in works 12:00-17:00 (overlaps fully across 12-16:30)
    // plus a 10:00-16:30 person => min concurrent 1 across whole window
    const shifts = [
      mk('A', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z'), // 10:00-16:30
    ];
    const c = computeSlotCoverage('10:00:00', '16:30:00', 1, D, shifts, 'Server', tz);
    expect(c.openSpots).toBe(0);
  });

  it('distinct-employee dedup: one person, two overlapping shifts counts once', () => {
    const shifts = [
      mk('A', '2026-06-27T19:00:00Z', '2026-06-27T21:00:00Z'), // 14:00-16:00
      mk('A', '2026-06-27T20:00:00Z', '2026-06-27T22:00:00Z'), // 15:00-17:00 (same emp)
    ];
    const c = computeSlotCoverage('14:00:00', '17:00:00', 2, D, shifts, 'Server', tz);
    expect(c.minConcurrent).toBe(1); // not 2
    expect(c.openSpots).toBe(1);
  });

  it('position mismatch is ignored', () => {
    const shifts = [mk('A', '2026-06-27T19:00:00Z', '2026-06-27T23:00:00Z', 'Cook')];
    const c = computeSlotCoverage('14:00:00', '18:00:00', 1, D, shifts, 'Server', tz);
    expect(c.openSpots).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/shiftCoverage.test.ts`
Expected: FAIL — `computeSlotCoverage` / `capacityFloor` not exported.

- [ ] **Step 4: Implement `src/lib/shiftCoverage.ts` core**

```ts
import { toZonedTime } from 'date-fns-tz';
import type { CoverageShift, CoverageSegment, CoveringEmployee, SlotCoverage } from '@/types/scheduling';

export function capacityFloor(capacity: number | undefined | null): number {
  const c = Number(capacity);
  return Number.isFinite(c) && c >= 1 ? Math.floor(c) : 1;
}

const HH = (t: string) => {
  const [h, m, s] = t.split(':').map(Number);
  return h * 60 + m + Math.floor((s || 0) / 60);
};

/** Wall-clock minutes of an ISO instant since local midnight of `dateStr` in `tz`. */
function wallMinutesSinceMidnight(iso: string, dateStr: string, tz: string): number {
  const z = toZonedTime(new Date(iso), tz); // local getters now read tz wall clock
  const mins = z.getHours() * 60 + z.getMinutes();
  const [Y, M, D] = dateStr.split('-').map(Number);
  const dayDiff = Math.round(
    (new Date(z.getFullYear(), z.getMonth(), z.getDate()).getTime() - new Date(Y, M - 1, D).getTime()) / 86_400_000,
  );
  return mins + dayDiff * 1440;
}

interface Clip { employeeId: string; employeeName?: string | null; cs: number; ce: number; }

export function computeSlotCoverage(
  windowStart: string, windowEnd: string, capacity: number,
  dateStr: string, shifts: CoverageShift[], position: string, tz: string,
): SlotCoverage {
  const cap = capacityFloor(capacity);
  const w0 = HH(windowStart);
  const w1raw = HH(windowEnd);
  const w1 = w1raw <= w0 ? w1raw + 1440 : w1raw; // overnight window

  const clips: Clip[] = [];
  for (const s of shifts) {
    if (s.position !== position) continue;
    if (s.status === 'cancelled') continue;
    const ds = wallMinutesSinceMidnight(s.start_time, dateStr, tz);
    let de = wallMinutesSinceMidnight(s.end_time, dateStr, tz);
    if (de <= ds) de += 1440; // overnight shift
    const cs = Math.max(w0, ds);
    const ce = Math.min(w1, de);
    if (cs < ce) clips.push({ employeeId: s.employee_id, employeeName: s.employee_name, cs, ce });
  }

  const bps = Array.from(new Set<number>([w0, w1, ...clips.flatMap((c) => [c.cs, c.ce])])).sort((a, b) => a - b);

  let minConcurrent = Infinity;
  let coveredMin = 0;
  const segments: CoverageSegment[] = [];
  for (let i = 0; i < bps.length - 1; i++) {
    const a = bps[i], b = bps[i + 1];
    if (b <= a || a < w0 || a >= w1) continue;
    const emps = new Set<string>();
    for (const c of clips) if (c.cs <= a && c.ce > a) emps.add(c.employeeId);
    const n = emps.size;
    minConcurrent = Math.min(minConcurrent, n);
    const covered = n >= cap;
    if (covered) coveredMin += b - a;
    const last = segments[segments.length - 1];
    if (last && last.covered === covered && last.endMin === a) last.endMin = b;
    else segments.push({ startMin: a, endMin: b, covered });
  }
  if (!Number.isFinite(minConcurrent)) minConcurrent = 0;

  const span = w1 - w0;
  const coveringEmployees: CoveringEmployee[] = clips
    .map((c) => ({ employeeId: c.employeeId, employeeName: c.employeeName, startMin: c.cs, endMin: c.ce }))
    .sort((a, b) => a.startMin - b.startMin);

  return {
    minConcurrent,
    openSpots: Math.max(0, cap - minConcurrent),
    coveragePct: span > 0 ? Math.round((coveredMin / span) * 100) : 100,
    segments,
    coveringEmployees,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/shiftCoverage.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Add TZ-portability + overnight tests, run under 3 timezones**

Append to the test file:

```ts
describe('computeSlotCoverage — overnight + capacity>1', () => {
  const tz = 'America/Chicago';
  const D = '2026-06-27';
  it('overnight window 22:00-02:00 covered by an overnight shift', () => {
    const shifts = [mk('A', '2026-06-28T03:00:00Z', '2026-06-28T07:00:00Z')]; // 22:00-02:00 CDT
    const c = computeSlotCoverage('22:00:00', '02:00:00', 1, D, shifts, 'Server', tz);
    expect(c.openSpots).toBe(0);
  });
  it('capacity 3 with one early-leaver leaves a gap', () => {
    const shifts = [
      mk('A', '2026-06-27T21:00:00Z', '2026-06-28T04:30:00Z'), // 16:00-23:30
      mk('B', '2026-06-27T21:00:00Z', '2026-06-28T04:30:00Z'), // 16:00-23:30
      mk('C', '2026-06-27T21:00:00Z', '2026-06-28T00:30:00Z'), // 16:00-19:30
    ];
    const c = computeSlotCoverage('16:00:00', '23:30:00', 3, D, shifts, 'Server', tz);
    expect(c.minConcurrent).toBe(2);
    expect(c.openSpots).toBe(1);
    expect(c.coveragePct).toBe(47); // 3.5h of 7.5h at >=3
  });
});
```

Run (TZ-portable, lesson 2026-05-10):
`TZ=UTC npx vitest run tests/unit/shiftCoverage.test.ts && TZ=America/Los_Angeles npx vitest run tests/unit/shiftCoverage.test.ts && TZ=Asia/Tokyo npx vitest run tests/unit/shiftCoverage.test.ts`
Expected: PASS in all three.

- [ ] **Step 7: Commit**

```bash
git add src/lib/shiftCoverage.ts tests/unit/shiftCoverage.test.ts src/types/scheduling.ts
git commit -m "feat(scheduling): coverage engine — concurrent-minimum sweep"
```

---

## Task 2: Engine — covering-employee names + segment time labels (display polish)

**Files:**
- Modify: `src/lib/shiftCoverage.ts`
- Modify: `tests/unit/shiftCoverage.test.ts`

- [ ] **Step 1: Failing test** — assert covering employees carry names and gap segments are reported.

```ts
it('reports covering employees with names and gap segments', () => {
  const tz = 'America/Chicago'; const D = '2026-06-27';
  const shifts = [
    { ...mk('A', '2026-06-27T21:00:00Z', '2026-06-28T04:30:00Z'), employee_name: 'Jodi' },
    { ...mk('B', '2026-06-27T21:00:00Z', '2026-06-28T00:30:00Z'), employee_name: 'Shy' },
  ];
  const c = computeSlotCoverage('16:00:00', '23:30:00', 2, D, shifts, 'Server', tz);
  expect(c.coveringEmployees.map((e) => e.employeeName)).toContain('Jodi');
  expect(c.segments.some((s) => !s.covered)).toBe(true); // gap after Shy leaves
});
```

- [ ] **Step 2: Run to verify** — should already pass if Task 1 carries `employee_name`; if not, thread it. Run `npx vitest run tests/unit/shiftCoverage.test.ts`.
- [ ] **Step 3: Implement** — ensure `employee_name` flows into `CoveringEmployee` (already in Task 1); add `formatSegmentLabel(min)` helper reusing `formatCompactTime` from `openShiftHelpers`:

```ts
import { formatCompactTime } from '@/lib/openShiftHelpers';
export function minutesToCompact(min: number): string {
  const norm = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60), m = norm % 60;
  return formatCompactTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
}
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run tests/unit/shiftCoverage.test.ts`
- [ ] **Step 5: Commit** — `git commit -am "feat(scheduling): coverage engine display helpers"`

---

## Task 3: SQL — `shift_slot_min_concurrent` function + pgTAP

**Files:**
- Create: `supabase/migrations/<ts>_open_shift_coverage.sql` (function part first)
- Create: `supabase/tests/open_shift_coverage.test.sql`

Use timestamp `<ts>` = a value greater than `20260529120000` (e.g. `20260626120000`); confirm with `ls supabase/migrations | sort | tail`.

- [ ] **Step 1: Write the function** (top of the new migration)

```sql
CREATE OR REPLACE FUNCTION public.shift_slot_min_concurrent(
  p_restaurant_id uuid, p_position text, p_date date,
  p_start time, p_end time, p_tz text
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH win AS (
    SELECT (EXTRACT(EPOCH FROM p_start)/60)::int AS ws,
           (CASE WHEN p_end <= p_start THEN EXTRACT(EPOCH FROM p_end)/60 + 1440
                 ELSE EXTRACT(EPOCH FROM p_end)/60 END)::int AS we
  ),
  cand AS (
    SELECT s.employee_id,
      (EXTRACT(EPOCH FROM ((s.start_time AT TIME ZONE p_tz) - p_date::timestamp))/60)::int AS ds,
      (EXTRACT(EPOCH FROM ((s.end_time   AT TIME ZONE p_tz) - p_date::timestamp))/60)::int AS de
    FROM public.shifts s
    WHERE s.restaurant_id = p_restaurant_id
      AND s.position = p_position
      AND s.status <> 'cancelled'
      AND (s.start_time AT TIME ZONE p_tz)::date = p_date
  ),
  norm AS (
    SELECT employee_id, ds AS sm_start,
           CASE WHEN de <= ds THEN de + 1440 ELSE de END AS sm_end FROM cand
  ),
  clip AS (
    SELECT n.employee_id, GREATEST(w.ws, n.sm_start) AS cs, LEAST(w.we, n.sm_end) AS ce
    FROM norm n, win w WHERE n.sm_start < w.we AND w.ws < n.sm_end
  ),
  bp AS (
    SELECT ws AS b FROM win UNION SELECT we FROM win
    UNION SELECT cs FROM clip UNION SELECT ce FROM clip
  ),
  seg AS (
    SELECT b AS seg_start, LEAD(b) OVER (ORDER BY b) AS seg_end FROM (SELECT DISTINCT b FROM bp) d
  ),
  cnt AS (
    SELECT (SELECT COUNT(DISTINCT c.employee_id) FROM clip c
            WHERE c.cs <= s.seg_start AND c.ce > s.seg_start) AS n
    FROM seg s, win w
    WHERE s.seg_end IS NOT NULL AND s.seg_end > s.seg_start
      AND s.seg_start >= w.ws AND s.seg_start < w.we
  )
  SELECT COALESCE(MIN(n), 0)::int FROM cnt;
$$;
GRANT EXECUTE ON FUNCTION public.shift_slot_min_concurrent(uuid, text, date, time, time, text) TO authenticated;
```

- [ ] **Step 2: pgTAP test** (`supabase/tests/open_shift_coverage.test.sql`) — dates from `CURRENT_DATE`, deterministic fixture.

```sql
BEGIN;
SELECT plan(4);
ALTER TABLE public.shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE v_rid uuid := '00000000-0000-0000-0000-0000000000aa';
        v_emp1 uuid := '00000000-0000-0000-0000-0000000000b1';
        v_emp2 uuid := '00000000-0000-0000-0000-0000000000b2';
        v_d date := CURRENT_DATE + 2;
BEGIN
  DELETE FROM public.shifts WHERE restaurant_id = v_rid;
  DELETE FROM public.employees WHERE restaurant_id = v_rid;
  DELETE FROM public.restaurants WHERE id = v_rid;
  INSERT INTO public.restaurants(id, name, timezone) VALUES (v_rid, 'cov-test', 'America/Chicago')
    ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;
  INSERT INTO public.employees(id, restaurant_id, name, position, is_active, status)
    VALUES (v_emp1, v_rid, 'E1', 'Server', true, 'active'), (v_emp2, v_rid, 'E2', 'Server', true, 'active')
    ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position;
  -- mid-shift fill-in that does NOT exactly match a 16:00-22:30 window: 15:00-23:00 local
  INSERT INTO public.shifts(restaurant_id, employee_id, start_time, end_time, position, status)
    VALUES (v_rid, v_emp1, (v_d || ' 15:00')::timestamp AT TIME ZONE 'America/Chicago',
            (v_d || ' 23:00')::timestamp AT TIME ZONE 'America/Chicago', 'Server', 'scheduled');
END $$;

-- cap-1 16:00-22:30 fully covered by the 15:00-23:00 fill-in => min concurrent 1
SELECT is(
  public.shift_slot_min_concurrent('00000000-0000-0000-0000-0000000000aa','Server', CURRENT_DATE + 2,
    '16:00'::time, '22:30'::time, 'America/Chicago'), 1,
  'fill-in overlapping the full window yields min concurrent 1 (exact-match would be 0)');

-- a window with no shifts => 0
SELECT is(
  public.shift_slot_min_concurrent('00000000-0000-0000-0000-0000000000aa','Server', CURRENT_DATE + 2,
    '06:00'::time, '09:00'::time, 'America/Chicago'), 0, 'empty window yields 0');

-- position mismatch => 0
SELECT is(
  public.shift_slot_min_concurrent('00000000-0000-0000-0000-0000000000aa','Cook', CURRENT_DATE + 2,
    '16:00'::time, '22:30'::time, 'America/Chicago'), 0, 'position mismatch ignored');

-- partial window: shift ends 23:00, so 23:00-23:30 of a 16:00-23:30 window is uncovered => 0
SELECT is(
  public.shift_slot_min_concurrent('00000000-0000-0000-0000-0000000000aa','Server', CURRENT_DATE + 2,
    '16:00'::time, '23:30'::time, 'America/Chicago'), 0, 'trailing gap yields min concurrent 0');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run** `npm run test:db` (or the targeted runner). Expected: 4/4 pass. If the fixture's employees/shifts columns differ, adjust to the actual schema (`\d public.shifts`, `\d public.employees`).
- [ ] **Step 4: Commit** — `git add supabase/migrations/<ts>_open_shift_coverage.sql supabase/tests/open_shift_coverage.test.sql && git commit -m "feat(db): shift_slot_min_concurrent coverage function + pgTAP"`

---

## Task 4: SQL — rewrite `get_open_shifts` to use coverage

**Files:**
- Modify: `supabase/migrations/<ts>_open_shift_coverage.sql` (append `get_open_shifts`)
- Modify: `supabase/tests/open_shifts_capacity_one.test.sql` (update expectations)

- [ ] **Step 1:** Append the rewritten `get_open_shifts` to the migration. Copy the latest body from `20260529120000_fix_open_shifts_capacity_one.sql`, keep everything (`SECURITY DEFINER STABLE SET search_path=public`, `open_shifts_enabled` gate, `published_dates` future filter, `capacity > 0`, per-(template,date) rows, `ORDER BY`, `GRANT`), and replace the `assigned` CTE + final arithmetic:

```sql
    -- (drop the old `assigned` CTE entirely)
    ...
    SELECT
        td.tmpl_id, td.tmpl_name, td.pub_date, td.tmpl_start, td.tmpl_end,
        td.tmpl_position, td.tmpl_area, td.tmpl_capacity,
        mc.minc AS assigned_count,
        COALESCE(p.cnt, 0) AS pending_claims,
        GREATEST(1, td.tmpl_capacity) - mc.minc - COALESCE(p.cnt, 0) AS open_spots
    FROM template_days td
    CROSS JOIN LATERAL (
      SELECT public.shift_slot_min_concurrent(
        p_restaurant_id, td.tmpl_position, td.pub_date, td.tmpl_start, td.tmpl_end, v_tz) AS minc
    ) mc
    LEFT JOIN pending p ON p.shift_template_id = td.tmpl_id AND p.shift_date = td.pub_date
    WHERE GREATEST(1, td.tmpl_capacity) - mc.minc - COALESCE(p.cnt, 0) > 0
    ORDER BY td.pub_date, td.tmpl_start;
```

Add a comment above the function: `-- STABLE is correct: read-only; CURRENT_DATE is stable per statement. Do not add NOW().` Re-issue `GRANT EXECUTE ON FUNCTION public.get_open_shifts(UUID, DATE, DATE) TO authenticated;`.

- [ ] **Step 2:** Update `supabase/tests/open_shifts_capacity_one.test.sql` so any assertion that depended on exact-time assigned counts now reflects coverage. Read the file, and for each `is(...open_spots...)` assertion, recompute the expected value under coverage (an overlapping shift now reduces open_spots). Keep date math `CURRENT_DATE`-relative.
- [ ] **Step 3:** Run `npm run test:db`. Expected: green (this file + the new one).
- [ ] **Step 4: Commit** — `git commit -am "feat(db): get_open_shifts uses coverage min-concurrent"`

---

## Task 5: SQL — `claim_open_shift` guard uses coverage

**Files:**
- Modify: `supabase/migrations/<ts>_open_shift_coverage.sql` (append `claim_open_shift`)
- Modify: `supabase/tests/open_shift_coverage.test.sql` (add claim-rejection assertion)

- [ ] **Step 1:** Append the rewritten `claim_open_shift` (copy the full body from `20260413001912_fix_shift_claim_timezone.sql`), replacing only the `v_assigned_count` computation and the guard:

```sql
    -- coverage-based assigned count (was exact time match)
    v_assigned_count := public.shift_slot_min_concurrent(
      p_restaurant_id, v_template.position, p_shift_date,
      v_template.start_time, v_template.end_time, v_tz);
    ...
    IF (v_assigned_count + v_pending_count) >= GREATEST(1, v_template.capacity) THEN
        RETURN json_build_object('success', false, 'error', 'No open spots available');
    END IF;
```

Keep the overnight timestamp construction (`+ interval '1 day'`), the conflict check, and the GRANT.

- [ ] **Step 2:** Add pgTAP (bump `plan()` count) asserting a claim on a coverage-full slot is rejected:

```sql
SELECT is(
  (public.claim_open_shift('00000000-0000-0000-0000-0000000000aa',
     (SELECT id FROM public.shift_templates WHERE restaurant_id='00000000-0000-0000-0000-0000000000aa'
       AND start_time='16:00' AND end_time='22:30' LIMIT 1),
     CURRENT_DATE + 2, '00000000-0000-0000-0000-0000000000b2') ->> 'success'),
  'false', 'claim rejected when coverage already fills the slot');
```

(Seed a `shift_templates` row cap 1 16:00-22:30 + the staffing_settings `open_shifts_enabled=true` and a `schedule_publications` row in the fixture so the slot is claimable-eligible; the fill-in already covers it.)

- [ ] **Step 3:** Run `npm run test:db`. Expected green.
- [ ] **Step 4: Commit** — `git commit -am "feat(db): claim_open_shift guard uses coverage (no double-claim)"`

---

## Task 6: SQL — composite index (separate CONCURRENTLY migration)

**Files:**
- Create: `supabase/migrations/<ts2>_idx_shifts_coverage.sql`

- [ ] **Step 1:** Create the migration (own file — `CONCURRENTLY` can't run in a txn):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_restaurant_start_status
  ON public.shifts (restaurant_id, start_time, status);
```

- [ ] **Step 2:** Run `npm run db:reset` (or the migration smoke step) to confirm it applies cleanly; `npm run test:db` stays green.
- [ ] **Step 3: Commit** — `git commit -am "perf(db): composite index for coverage sweep"`

---

## Task 7: Wire `openShiftCount` in `Scheduling.tsx` to the engine

**Files:**
- Modify: `src/pages/Scheduling.tsx` (`openShiftCount` ~`:531`; import at `:55`)
- Modify: existing `tests/unit/Scheduling*.test.*` / `useShiftPlanner.test.ts` expectations as needed.

- [ ] **Step 1:** Confirm `restaurantTimezone` (`:175`) is in scope at the `openShiftCount` memo (same component). If not, compute `const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC'` locally near the memo.
- [ ] **Step 2:** Replace the memo body:

```ts
import { computeSlotCoverage } from '@/lib/shiftCoverage';
import type { CoverageShift } from '@/types/scheduling';
// ...
const openShiftCount = useMemo(() => {
  if (!templates.length || shifts === undefined) return 0;
  const cov: CoverageShift[] = shifts.map((s) => ({
    employee_id: s.employee_id, employee_name: s.employee?.name ?? null,
    start_time: s.start_time, end_time: s.end_time, position: s.position, status: s.status,
  }));
  let total = 0;
  for (const t of templates) {
    for (const dayStr of weekDays.map(formatLocalDate)) {
      if (!templateAppliesToDay(t, dayStr)) continue;
      total += computeSlotCoverage(t.start_time, t.end_time, t.capacity, dayStr, cov, t.position, restaurantTimezone).openSpots;
    }
  }
  return total;
}, [templates, shifts, weekDays, restaurantTimezone]);
```

Remove the now-unused `buildTemplateGridData`/`computeOpenSpots` imports here if no other use in this file (grep first).

- [ ] **Step 3:** Run `npx vitest run tests/unit/useShiftPlanner.test.ts tests/unit/SchedulingSkeleton.test.ts` and any `Scheduling` test; update banner-count expectations to coverage values. Expected green.
- [ ] **Step 4: Commit** — `git commit -am "feat(scheduling): banner needs-staff uses coverage engine"`

---

## Task 8: Planner — tab-level coverage map + lifted popover/Drawer state

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

- [ ] **Step 1:** Add a memoized coverage map keyed correctly, with per-slot try/catch:

```ts
import { computeSlotCoverage } from '@/lib/shiftCoverage';
import type { CoverageShift, SlotCoverage } from '@/types/scheduling';
// ...
const coverageByTemplateDay = useMemo(() => {
  const cov: CoverageShift[] = shifts.map((s) => ({
    employee_id: s.employee_id, employee_name: s.employee?.name ?? null,
    start_time: s.start_time, end_time: s.end_time, position: s.position, status: s.status,
  }));
  const map = new Map<string, Map<string, SlotCoverage>>();
  for (const t of templates) {
    const inner = new Map<string, SlotCoverage>();
    for (const day of weekDays) {
      if (!templateAppliesToDay(t, day)) continue;
      try { inner.set(day, computeSlotCoverage(t.start_time, t.end_time, t.capacity, day, cov, t.position, restaurantTimezone)); }
      catch { /* one bad row never blanks the grid */ }
    }
    map.set(t.id, inner);
  }
  return map;
}, [shifts, templates, weekDays, restaurantTimezone]);
```

- [ ] **Step 2:** Add single lifted detail state + render ONE `CoverageDetail` (Popover desktop / Drawer mobile), following the existing `AssignmentPopover`/`pendingAssignment` precedent:

```ts
const [coverageDetail, setCoverageDetail] = useState<{ templateId: string; day: string; anchorRect?: DOMRect } | null>(null);
```

Pass `coverageByTemplateDay` down to the grid/cells and `onCoverageClick={(templateId, day, rect) => setCoverageDetail({ templateId, day, anchorRect: rect })}`.

- [ ] **Step 3:** Lightweight source-text test (lesson 2026-05-17) `tests/unit/shiftPlannerCoverageWiring.test.ts` asserting `ShiftPlannerTab.tsx` contains `coverageByTemplateDay` and a single `CoverageDetail` usage (no per-cell popover). Run it.
- [ ] **Step 4: Commit** — `git commit -am "feat(planner): tab-level coverage map + lifted detail state"`

---

## Task 9: `ShiftCell` — compact accessible indicator

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`

- [ ] **Step 1:** Accept `coverage?: SlotCoverage` + `onCoverageClick` props; replace `classifyCapacity(capacity, shifts.length)` with status derived from `coverage`. Render a compact `<button>`:

```tsx
{coverage && !(coverage.coveragePct === 100 && shifts.length <= 1) && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onCoverageClick?.(templateId, day, (e.currentTarget.getBoundingClientRect())); }}
    aria-label={`Coverage ${coverage.coveragePct}%${coverage.openSpots > 0 ? `, needs ${coverage.openSpots} more` : ''}. Open details`}
    aria-haspopup="dialog"
    className={`mt-1 flex items-center gap-1 text-[11px] ${coverage.openSpots > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
  >
    <span className="inline-block h-1.5 w-10 rounded-full bg-muted overflow-hidden" aria-hidden="true">
      <span className={`block h-full ${coverage.openSpots > 0 ? 'bg-destructive/70' : 'bg-foreground/60'}`} style={{ width: `${coverage.coveragePct}%` }} />
    </span>
    <span>{coverage.coveragePct}%</span>
    {coverage.openSpots > 0 && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
    <span className="sr-only">{coverage.openSpots > 0 ? `Needs ${coverage.openSpots} more; ` : 'Fully covered; '}{coverage.coveragePct}% of window covered</span>
  </button>
)}
```

Use semantic tokens only (no `emerald/amber/red`). Import `AlertTriangle` from lucide-react.

- [ ] **Step 2:** Update the `React.memo` comparator to include `coverage` (reference equality — the parent map entry is stable):

```ts
return prev.coverage === next.coverage && /* ...existing checks... */;
```

- [ ] **Step 3:** Source-text test asserting the indicator is a `<button>` with `aria-label`, uses `text-destructive`/`text-muted-foreground` (not `text-amber-600`/`text-emerald-600`/`text-red-500`), and the comparator references `coverage`. Run `npx vitest run`.
- [ ] **Step 4: Commit** — `git commit -am "feat(planner): accessible per-cell coverage indicator"`

---

## Task 10: `CoverageDetail` — covering employees + gaps (Popover/Drawer)

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/CoverageDetail.tsx`
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` (render it)

- [ ] **Step 1:** Build the component. Desktop → shadcn `Popover` anchored to the clicked rect; mobile (`useIsMobile`) → shadcn `Drawer`. Body lists covering employees with `minutesToCompact(startMin)–minutesToCompact(endMin)` and renders gap segments with a non-color cue (icon + text), heading "Covering employees for this slot".

```tsx
// header: `${coveragePct}% covered · needs ${openSpots} more`
// list: coveringEmployees.map(e => `${e.employeeName ?? 'Employee'} · ${minutesToCompact(e.startMin)}–${minutesToCompact(e.endMin)}`)
// gaps: segments.filter(s => !s.covered).map(s => <div><AlertTriangle/> Gap {minutesToCompact(s.startMin)}–{minutesToCompact(s.endMin)}</div>)
```

CLAUDE.md three-state: if `!coverage` render nothing; if no covering employees show an empty hint.

- [ ] **Step 2:** Render exactly one instance in `ShiftPlannerTab`, driven by `coverageDetail` state; Esc/overlay closes it (Popover/Drawer handle focus + Esc natively).
- [ ] **Step 3:** Component render test (`@testing-library/react`): given a `SlotCoverage` with a gap, asserts the covering employee name and a "Gap" label render with `getByText`. Run `npx vitest run tests/unit/CoverageDetail.test.tsx`.
- [ ] **Step 4: Commit** — `git commit -am "feat(planner): coverage detail popover/drawer (who + gaps)"`

---

## Task 11: Cleanup dead helpers

**Files:**
- Modify: `src/lib/openShiftHelpers.ts`
- Modify: `tests/unit/shiftTemplateCapacity.test.ts` (if it tested removed fns)

- [ ] **Step 1:** `grep -rn "computeOpenSpots\|classifyCapacity" src/` — confirm only the now-migrated call sites remain (none). Move `capacityFloor` to (or re-export from) `shiftCoverage.ts`; keep `formatCompactTime`.
- [ ] **Step 2:** Remove `computeOpenSpots` + `classifyCapacity` and their tests if they exercised only the removed fns; keep tests for surviving helpers.
- [ ] **Step 3:** Run `npm run typecheck && npx vitest run`. Expected green.
- [ ] **Step 4: Commit** — `git commit -am "refactor(scheduling): remove exact-match open-spot helpers"`

---

## Self-review notes

- **Spec coverage:** engine (T1-2), SQL fn (T3), get_open_shifts (T4), claim guard (T5), index (T6), banner (T7), planner map+lift (T8), cell indicator (T9), detail popover/Drawer (T10), cleanup (T11) — every spec "Files" row maps to a task.
- **Type consistency:** `SlotCoverage`/`CoverageShift`/`CoveringEmployee`/`CoverageSegment` defined in T1, used identically in T7-T10; `computeSlotCoverage` signature `(start, end, capacity, dateStr, shifts, position, tz)` is identical at every call site; `shift_slot_min_concurrent(uuid,text,date,time,time,text)` identical in T3/T4/T5.
- **No placeholders:** all code shown; the only deferred literals are migration timestamps `<ts>`/`<ts2>` (resolved at creation against `ls supabase/migrations`).
