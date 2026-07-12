import { describe, it, expect } from 'vitest';
import { deriveWindow, buildLanes, expandDemand, computeGaps, buildTimelineModel, computeCoverage } from '@/lib/timelineModel';
import type { Shift, Employee, HourlyStaffingRecommendation } from '@/types/scheduling';
import type { EffectiveAvailability } from '@/lib/effectiveAvailability';

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

  it("with groupBy 'none' returns a single unlabelled lane", () => {
    const lanes = buildLanes(
      [shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')],
      employees, '2026-07-11', 'America/Chicago', 'none',
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0].label).toBe('');
    expect(lanes[0].bars).toHaveLength(1);
  });

  it("with groupBy 'none' and no shifts returns no lanes", () => {
    expect(buildLanes([], employees, '2026-07-11', 'America/Chicago', 'none')).toEqual([]);
  });

  it('sorts sections alphabetically with unassigned area last', () => {
    const mixed = [
      emp('e1', 'Ann', 'Front', 'Server'),
      emp('e2', 'Bob', '', 'Server'),      // no area → Unassigned
      emp('e3', 'Cy', 'Back', 'Server'),
    ];
    const shifts = [
      shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'),
      shiftFor('s2', 'e2', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'),
      shiftFor('s3', 'e3', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'),
    ];
    const lanes = buildLanes(shifts, mixed, '2026-07-11', 'America/Chicago', 'area');
    expect(lanes.map((l) => l.label)).toEqual(['Back', 'Front', 'Unassigned']);
    expect(lanes[2].key).toBe('unassigned');
  });

  it('drops shifts whose employee is missing', () => {
    const lanes = buildLanes(
      [shiftFor('s1', 'ghost', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')],
      employees, '2026-07-11', 'America/Chicago', 'area',
    );
    expect(lanes).toEqual([]);
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
  it('closes an open gap that runs to the last sample', () => {
    const coverage = [{ min: 600, count: 0 }, { min: 615, count: 0 }];
    const demand = [{ min: 600, target: 1 }, { min: 615, target: 1 }];
    expect(computeGaps(coverage, demand)).toEqual([{ startMin: 600, endMin: 615 }]);
  });
});

describe('buildTimelineModel', () => {
  const employees = [emp('e1', 'Ann', 'Front', 'Server')];
  const shiftFor = (id: string, eid: string, start: string, end: string) =>
    ({ id, restaurant_id: 'r', employee_id: eid, start_time: start, end_time: end, break_duration: 0,
       position: 'Server', status: 'scheduled', is_published: false, source: 'manual',
       locked: false, created_at: '', updated_at: '' } as Shift);

  it('assembles window, lanes, coverage, demand and gaps', () => {
    const shifts = [shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')]; // 10-13 CT
    const model = buildTimelineModel(
      shifts, employees, '2026-07-11', 'America/Chicago', 'area', [rec(10, 1), rec(11, 1), rec(12, 1)],
    );
    expect(model.window.startMin).toBe(600);
    expect(model.lanes[0].label).toBe('Front');
    expect(model.coverage.some((c) => c.count === 1)).toBe(true);
    expect(model.demand).not.toBeNull();
    expect(Array.isArray(model.gaps)).toBe(true);
  });

  it('excludes cancelled shifts and yields null demand with no recs', () => {
    const shifts = [
      shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'),
      { ...shiftFor('s2', 'e1', '2026-07-11T19:00:00Z', '2026-07-11T22:00:00Z'), status: 'cancelled' } as Shift,
    ];
    const model = buildTimelineModel(shifts, employees, '2026-07-11', 'America/Chicago', 'area', []);
    expect(model.lanes[0].bars).toHaveLength(1); // cancelled dropped
    expect(model.demand).toBeNull();
    expect(model.gaps).toEqual([]);
  });
});

describe('computeCoverage (Fix 1 — live coverage against a frozen window, no lane rebuild)', () => {
  const employees = [emp('e1', 'Ann', 'Front', 'Server')];
  const shiftFor = (id: string, eid: string, start: string, end: string) =>
    ({ id, restaurant_id: 'r', employee_id: eid, start_time: start, end_time: end, break_duration: 0,
       position: 'Server', status: 'scheduled', is_published: false, source: 'manual',
       locked: false, created_at: '', updated_at: '' } as Shift);

  it('computes coverage/demand/gaps for the given shifts against a FIXED window (no window/lane derivation)', () => {
    const shifts = [shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')]; // 10-13 CT
    // Fixed window wider than what deriveWindow would compute for these shifts,
    // proving computeCoverage never re-derives its own window from the shifts.
    const fixedWindow = { startMin: 480, endMin: 1440 }; // 08:00-24:00
    const result = computeCoverage(
      shifts, '2026-07-11', 'America/Chicago', fixedWindow, [rec(10, 1), rec(11, 1), rec(12, 1)],
    );
    expect(result.coverage[0].min).toBe(480); // samples span the FIXED window, not deriveWindow's 600-1020
    expect(result.coverage[result.coverage.length - 1].min).toBe(1440);
    expect(result.coverage.some((c) => c.count === 1)).toBe(true);
    expect(result.demand).not.toBeNull();
    expect(Array.isArray(result.gaps)).toBe(true);
  });

  it('matches buildTimelineModel\'s coverage/demand/gaps when given the same window (equivalence, no behavior drift)', () => {
    const shifts = [
      shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'),
      shiftFor('s2', 'e1', '2026-07-11T19:00:00Z', '2026-07-11T22:00:00Z'),
    ];
    const recs = [rec(10, 1), rec(11, 1), rec(12, 1), rec(13, 1), rec(14, 1)];
    const model = buildTimelineModel(shifts, employees, '2026-07-11', 'America/Chicago', 'area', recs);
    const coverage = computeCoverage(shifts, '2026-07-11', 'America/Chicago', model.window, recs);
    expect(coverage.coverage).toEqual(model.coverage);
    expect(coverage.demand).toEqual(model.demand);
    expect(coverage.gaps).toEqual(model.gaps);
  });

  it('reflects a moved shift\'s live position while a DIFFERENT fixed window (from the committed shifts) stays untouched', () => {
    // Simulates dragging s1 later in time: the committed window (derived from
    // the ORIGINAL, pre-drag shifts) must stay fixed, while coverage computed
    // against that same fixed window reflects the drafted position.
    const committedShifts = [
      shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z'), // 10-13 CT
    ];
    const frozenWindow = deriveWindow(committedShifts, '2026-07-11', 'America/Chicago'); // 10:00-13:00

    // Drafted (in-flight drag) shift moved to 11-14 CT — still within frozenWindow.
    const draftedShifts = [
      shiftFor('s1', 'e1', '2026-07-11T16:00:00Z', '2026-07-11T19:00:00Z'), // 11-14 CT
    ];
    const live = computeCoverage(draftedShifts, '2026-07-11', 'America/Chicago', frozenWindow, []);

    // Coverage reflects the drafted 11:00 start (not the committed 10:00 start).
    const at10 = live.coverage.find((c) => c.min === frozenWindow.startMin);
    const at11 = live.coverage.find((c) => c.min === frozenWindow.startMin + 60);
    expect(at10?.count).toBe(0); // no longer covered at 10:00 post-drag
    expect(at11?.count).toBe(1); // covered at 11:00 post-drag
  });
});

describe('outsideAvailability marker (Task 7)', () => {
  const employees = [emp('e1', 'Ann', 'Front', 'Server')];
  const shiftFor = (id: string, eid: string, start: string, end: string) =>
    ({ id, restaurant_id: 'r', employee_id: eid, start_time: start, end_time: end, break_duration: 0,
       position: 'Server', status: 'scheduled', is_published: false, source: 'manual',
       locked: false, created_at: '', updated_at: '' } as Shift);

  // 2026-07-11 is a Saturday (getDay() === 6).
  const SAT = 6;

  const availMap = (dow: number, effective: EffectiveAvailability): Map<string, Map<number, EffectiveAvailability>> =>
    new Map([['e1', new Map([[dow, effective]])]]);

  const recurringOff: EffectiveAvailability = {
    type: 'recurring',
    slots: [{ isAvailable: false, startTime: null, endTime: null, sourceRecord: {} as never }],
  };

  // 14:00Z-19:00Z UTC == 09:00-14:00 America/Chicago (CDT, UTC-5 in July) — comfortably
  // covers the 10-13 CT test shift below.
  const recurringOnWideWindow: EffectiveAvailability = {
    type: 'recurring',
    slots: [{ isAvailable: true, startTime: '14:00:00', endTime: '19:00:00', sourceRecord: {} as never }],
  };

  it('flags a bar outsideAvailability=true when the employee is recurring-unavailable that day', () => {
    const shifts = [shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')]; // Sat 10-13 CT
    const lanes = buildLanes(shifts, employees, '2026-07-11', 'America/Chicago', 'area', availMap(SAT, recurringOff));
    expect(lanes[0].bars[0].outsideAvailability).toBe(true);
  });

  it('leaves outsideAvailability false when the shift falls inside the available window', () => {
    const shifts = [shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')]; // Sat 10-13 CT
    const lanes = buildLanes(shifts, employees, '2026-07-11', 'America/Chicago', 'area', availMap(SAT, recurringOnWideWindow));
    expect(lanes[0].bars[0].outsideAvailability).toBe(false);
  });

  it('defaults outsideAvailability to false when no availabilityByEmployee map is supplied (backward-compatible)', () => {
    const shifts = [shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')];
    const lanes = buildLanes(shifts, employees, '2026-07-11', 'America/Chicago', 'area');
    expect(lanes[0].bars[0].outsideAvailability).toBe(false);
  });

  it('threads availabilityByEmployee through buildTimelineModel', () => {
    const shifts = [shiftFor('s1', 'e1', '2026-07-11T15:00:00Z', '2026-07-11T18:00:00Z')]; // Sat 10-13 CT
    const model = buildTimelineModel(
      shifts, employees, '2026-07-11', 'America/Chicago', 'area', [], availMap(SAT, recurringOff),
    );
    expect(model.lanes[0].bars[0].outsideAvailability).toBe(true);
  });
});
