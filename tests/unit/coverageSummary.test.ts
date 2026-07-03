import { describe, it, expect } from 'vitest';
import { summarizeCoverageHours, buildVerdict, summarizeAreaCoverage } from '@/lib/coverageSummary';
import type { Shift, Employee } from '@/types/scheduling';

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
  it('CRITICAL: aggregates scheduled as the per-hour minimum and aligns needed', () => {
    const hrs = summarizeCoverageHours(coverage, demand, win);
    expect(hrs.map((h) => h.hour)).toEqual([10, 11, 12]);
    expect(hrs[0]).toMatchObject({ scheduled: 1, needed: 1, delta: 0 });   // covered (met)
    expect(hrs[1]).toMatchObject({ scheduled: 3, needed: 3, delta: 0 });
    expect(hrs[2]).toMatchObject({ scheduled: 2, needed: 4, delta: -2 });  // short 2
  });
  it('CRITICAL: yields null needed/delta when demand is null', () => {
    const hrs = summarizeCoverageHours(coverage, null, win);
    expect(hrs[0].needed).toBeNull();
    expect(hrs[0].delta).toBeNull();
    expect(hrs[0].scheduled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// summarizeAreaCoverage
// ---------------------------------------------------------------------------

const emp = (id: string, area: string | null): Employee =>
  ({ id, restaurant_id: 'r', name: id, area: area ?? undefined, position: 'Server',
     status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 0,
     locked: false, created_at: '', updated_at: '' } as Employee);

const shiftFor = (id: string, eid: string, start: string, end: string): Shift =>
  ({ id, restaurant_id: 'r', employee_id: eid, start_time: start, end_time: end,
     break_duration: 0, position: 'Server', status: 'scheduled', is_published: false,
     source: 'manual', locked: false, created_at: '', updated_at: '' } as unknown as Shift);

describe('summarizeAreaCoverage', () => {
  const employees = [emp('a', 'Cold Stone'), emp('b', "Wetzel's")];
  // window 10:00–12:00 CT  (America/Chicago = UTC−5 in July/CDT = UTC−5)
  const win = { startMin: 600, endMin: 720 }; // 10:00–12:00 local

  // Cold Stone emp 'a': 2026-07-11 15:00Z–18:00Z → CDT (UTC-5) = 10:00–13:00
  // Wetzel's  emp 'b': 2026-07-11 16:00Z–19:00Z → CDT (UTC-5) = 11:00–14:00
  const shifts = [
    shiftFor('s1', 'a', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'),
    shiftFor('s2', 'b', '2026-07-11T16:00:00Z', '2026-07-11T19:00:00Z'),
  ];

  it('CRITICAL: groups scheduled coverage per area (scheduled-only, no demand)', () => {
    const res = summarizeAreaCoverage(shifts, employees, '2026-07-11', 'America/Chicago', win);
    const cs = res.find((r) => r.area === 'Cold Stone')!;
    const wz = res.find((r) => r.area === "Wetzel's")!;
    expect(cs).toBeDefined();
    expect(wz).toBeDefined();
    // Cold Stone is on at 10:00
    expect(cs.hours[0]).toMatchObject({ hour: 10, scheduled: 1, needed: null, delta: null });
    // Wetzel's not scheduled at 10:00 (starts 11:00 CDT)
    expect(wz.hours[0].scheduled).toBe(0);
    // Wetzel's is scheduled at 11:00
    expect(wz.hours.find((h) => h.hour === 11)!.scheduled).toBe(1);
  });

  it('CRITICAL: buckets a null/blank area under the Unassigned label', () => {
    const res = summarizeAreaCoverage(
      [shiftFor('s3', 'c', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')],
      [emp('c', null)],
      '2026-07-11', 'America/Chicago', win,
    );
    expect(res[0].area).toBe('Unassigned');
  });

  it('returns [] for no shifts', () => {
    expect(summarizeAreaCoverage([], employees, '2026-07-11', 'America/Chicago', win)).toEqual([]);
  });

  it('omits areas that have employees but no shifts in the window (by-design: only shift-bearing areas shown)', () => {
    // Design intent: summarizeAreaCoverage groups active shifts by area.
    // An area with assigned employees but zero shifts has nothing to contribute
    // to the per-area headcount strip, so it is excluded.
    // Per-area zero-coverage rows for staffed-but-not-scheduled areas are a
    // deferred enhancement (no per-area demand targets yet).
    const res = summarizeAreaCoverage(
      [shiftFor('s1', 'a', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')],
      employees,
      '2026-07-11',
      'America/Chicago',
      win,
    );
    expect(res.map((r) => r.area)).toContain('Cold Stone');
    expect(res.map((r) => r.area)).not.toContain("Wetzel's");
  });
});

describe('buildVerdict', () => {
  it('CRITICAL: counts short hours and picks the worst', () => {
    const hrs = summarizeCoverageHours(coverage, demand, win);
    const v = buildVerdict(hrs);
    expect(v.metAll).toBe(false);
    expect(v.shortHours).toBe(1);
    expect(v.worst).toEqual({ hour: 12, delta: -2 });
  });
  it('CRITICAL: reports metAll when nothing is short', () => {
    const hrs = summarizeCoverageHours(
      [{ min: 600, count: 5 }, { min: 660, count: 5 }], [{ min: 600, target: 1 }], { startMin: 600, endMin: 720 },
    );
    expect(buildVerdict(hrs).metAll).toBe(true);
    expect(buildVerdict(hrs).worst).toBeNull();
  });
  it('CRITICAL: reports no demand and zero short hours when demand absent', () => {
    const hrs = summarizeCoverageHours([{ min: 600, count: 2 }], null, { startMin: 600, endMin: 660 });
    const v = buildVerdict(hrs);
    expect(v.hasDemand).toBe(false);
    expect(v.shortHours).toBe(0);
  });
});

describe('summarizeCoverageHours — zero-coverage with demand', () => {
  it('CRITICAL: emits scheduled=0 hours when coverage is empty but demand is configured', () => {
    // Regression: the old early-return `if (coverage.length === 0) return []` silently
    // dropped fully-unstaffed periods even when demand was configured, causing
    // buildVerdict to report hasDemand:false / shortHours:0 for critical shortages.
    const hrs = summarizeCoverageHours(
      [],
      [{ min: 600, target: 2 }, { min: 660, target: 3 }],
      { startMin: 600, endMin: 720 },
    );
    expect(hrs).toHaveLength(2);
    expect(hrs[0]).toMatchObject({ hour: 10, scheduled: 0, needed: 2, delta: -2 });
    expect(hrs[1]).toMatchObject({ hour: 11, scheduled: 0, needed: 3, delta: -3 });

    const verdict = buildVerdict(hrs);
    expect(verdict.hasDemand).toBe(true);
    expect(verdict.shortHours).toBe(2);
    expect(verdict.metAll).toBe(false);
  });

  it('returns [] when both coverage and demand are absent (hour completely outside window)', () => {
    const hrs = summarizeCoverageHours([], null, { startMin: 600, endMin: 660 });
    expect(hrs).toHaveLength(0);
  });
});
