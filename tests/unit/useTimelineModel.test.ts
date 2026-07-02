import { describe, it, expect } from 'vitest';
import { deriveWindow, buildLanes, expandDemand, computeGaps } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { Shift, Employee, HourlyStaffingRecommendation } from '@/types/scheduling';

const shift = (start: string, end: string): Shift => ({
  id: start, restaurant_id: 'r', employee_id: 'e', start_time: start, end_time: end,
  break_duration: 0, position: 'Server', status: 'scheduled', is_published: false, source: 'manual',
  locked: false, created_at: '', updated_at: '',
} as Shift);

const emp = (id: string, name: string, area: string, position: string): Employee =>
  ({ id, restaurant_id: 'r', name, area, position } as Employee);

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

describe('buildLanes', () => {
  const employees = [emp('e1', 'Ann', 'Front', 'Server'), emp('e2', 'Bob', 'Front', 'Server')];
  const shiftFor = (id: string, eid: string, start: string, end: string) =>
    ({ id, restaurant_id: 'r', employee_id: eid, start_time: start, end_time: end, break_duration: 0,
       position: 'Server', status: 'scheduled', is_published: false, source: 'manual',
       locked: false, created_at: '', updated_at: '' } as Shift);

  it('groups by area and stacks overlapping shifts onto separate rows', () => {
    const shifts = [
      shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T21:00:00Z'), // Ann 10-16 CT
      shiftFor('s2', 'e2', '2026-07-11T17:00:00Z', '2026-07-11T23:00:00Z'), // Bob 12-18 CT (overlaps Ann)
    ];
    const lanes = buildLanes(shifts, employees, '2026-07-11', 'America/Chicago', 'area');
    expect(lanes).toHaveLength(1);
    expect(lanes[0].label).toBe('Front');
    expect(lanes[0].bars.map((b) => b.row).sort()).toEqual([0, 1]); // stacked
    expect(lanes[0].hours).toBe(12);
  });

  it('non-overlapping shifts in one lane share row 0', () => {
    const shifts = [
      shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'), // 10-13 CT
      shiftFor('s2', 'e2', '2026-07-11T19:00:00Z', '2026-07-11T22:00:00Z'), // 14-17 CT
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
    expect(computeGaps(coverage, demand)).toEqual([{ startMin: 600, endMin: 615 }]);
  });
  it('returns no gaps when demand is null', () => {
    expect(computeGaps([{ min: 600, count: 0 }], null)).toEqual([]);
  });
});
