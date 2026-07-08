/**
 * Tests for the hide-shift-templates pure helpers in useShiftPlanner.ts:
 * - partitionTemplatesForDisplay: active-first stable ordering for grid rows.
 * - collectHiddenLane: merges hidden-template grid buckets into a single
 *   Map<day, Shift[]> for the "From hidden templates" lane, honoring areaFilter.
 *
 * Also pins two invariants required by the design doc:
 * - computeTotalHours never sees templates, so hiding a template cannot change
 *   its result (it operates purely on the shifts array).
 * - buildTemplateGridData buckets a hidden template's FK-linked shift under
 *   that template (not __unmatched__) as long as the template is present in
 *   the templates array passed in (grid built with ALL templates).
 * - computeOpenShiftCount (imported from Scheduling.tsx), given only active
 *   templates, does not count a hidden template's open slots.
 */
import { describe, it, expect } from 'vitest';

import {
  partitionTemplatesForDisplay,
  collectHiddenLane,
  buildTemplateGridData,
  computeTotalHours,
} from '@/hooks/useShiftPlanner';
import { computeOpenShiftCount } from '@/pages/Scheduling';
import { UNASSIGNED } from '@/lib/templateAreaGrouping';
import type { Shift, ShiftTemplate } from '@/types/scheduling';

function mkTemplate(overrides: Partial<ShiftTemplate> & { id: string }): ShiftTemplate {
  return {
    restaurant_id: 'r1',
    name: 'Test',
    start_time: '10:00:00',
    end_time: '16:00:00',
    position: 'Server',
    days: [1, 2, 3, 4, 5],
    capacity: 1,
    is_active: true,
    break_duration: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as ShiftTemplate;
}

function mockShift(overrides: Partial<Shift> & { id: string }): Shift {
  return {
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-03-02T10:00:00',
    end_time: '2026-03-02T16:00:00',
    break_duration: 30,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Shift;
}

const weekDays = [
  '2026-03-02',
  '2026-03-03',
  '2026-03-04',
  '2026-03-05',
  '2026-03-06',
  '2026-03-07',
  '2026-03-08',
];

describe('partitionTemplatesForDisplay', () => {
  it('returns activeTemplates/hiddenTemplates/displayTemplates partitions', () => {
    const active1 = mkTemplate({ id: 'a1', is_active: true });
    const hidden1 = mkTemplate({ id: 'h1', is_active: false });
    const active2 = mkTemplate({ id: 'a2', is_active: true });
    const hidden2 = mkTemplate({ id: 'h2', is_active: false });

    const { activeTemplates, hiddenTemplates, displayTemplates } =
      partitionTemplatesForDisplay([active1, hidden1, active2, hidden2], true);

    expect(activeTemplates).toEqual([active1, active2]);
    expect(hiddenTemplates).toEqual([hidden1, hidden2]);
    // Active-first stable ordering, preserving relative order within each partition.
    expect(displayTemplates).toEqual([active1, active2, hidden1, hidden2]);
  });

  it('preserves relative order within each partition (stable sort)', () => {
    const a1 = mkTemplate({ id: 'a1', is_active: true });
    const a2 = mkTemplate({ id: 'a2', is_active: true });
    const a3 = mkTemplate({ id: 'a3', is_active: true });
    const h1 = mkTemplate({ id: 'h1', is_active: false });
    const h2 = mkTemplate({ id: 'h2', is_active: false });

    // Interleaved input order.
    const input = [h1, a1, h2, a2, a3];
    const { displayTemplates } = partitionTemplatesForDisplay(input, true);

    expect(displayTemplates).toEqual([a1, a2, a3, h1, h2]);
  });

  it('when showHidden is false, displayTemplates === activeTemplates (no hidden rows)', () => {
    const active1 = mkTemplate({ id: 'a1', is_active: true });
    const hidden1 = mkTemplate({ id: 'h1', is_active: false });

    const { activeTemplates, hiddenTemplates, displayTemplates } =
      partitionTemplatesForDisplay([active1, hidden1], false);

    expect(activeTemplates).toEqual([active1]);
    expect(hiddenTemplates).toEqual([hidden1]);
    expect(displayTemplates).toEqual(activeTemplates);
  });

  it('returns empty arrays for empty input', () => {
    const result = partitionTemplatesForDisplay([], true);
    expect(result.activeTemplates).toEqual([]);
    expect(result.hiddenTemplates).toEqual([]);
    expect(result.displayTemplates).toEqual([]);
  });

  it('handles all-active input (hiddenTemplates empty)', () => {
    const a1 = mkTemplate({ id: 'a1', is_active: true });
    const a2 = mkTemplate({ id: 'a2', is_active: true });
    const { activeTemplates, hiddenTemplates, displayTemplates } =
      partitionTemplatesForDisplay([a1, a2], true);
    expect(activeTemplates).toEqual([a1, a2]);
    expect(hiddenTemplates).toEqual([]);
    expect(displayTemplates).toEqual([a1, a2]);
  });

  it('handles all-hidden input (activeTemplates empty)', () => {
    const h1 = mkTemplate({ id: 'h1', is_active: false });
    const h2 = mkTemplate({ id: 'h2', is_active: false });
    const { activeTemplates, hiddenTemplates, displayTemplates } =
      partitionTemplatesForDisplay([h1, h2], true);
    expect(activeTemplates).toEqual([]);
    expect(hiddenTemplates).toEqual([h1, h2]);
    expect(displayTemplates).toEqual([h1, h2]);
  });
});

describe('collectHiddenLane', () => {
  it('merges grid buckets of hidden templates into a single Map<day, Shift[]>', () => {
    const hiddenT1 = mkTemplate({ id: 'h1', is_active: false });
    const hiddenT2 = mkTemplate({ id: 'h2', is_active: false });
    const activeT = mkTemplate({ id: 'a1', is_active: true });

    const s1 = mockShift({ id: 's1', shift_template_id: 'h1', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' });
    const s2 = mockShift({ id: 's2', shift_template_id: 'h2', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' });
    const s3 = mockShift({ id: 's3', shift_template_id: 'h1', start_time: '2026-03-03T10:00:00', end_time: '2026-03-03T16:00:00' });
    const sActive = mockShift({ id: 's4', shift_template_id: 'a1', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' });

    const grid = buildTemplateGridData([s1, s2, s3, sActive], [hiddenT1, hiddenT2, activeT], weekDays);

    const lane = collectHiddenLane(grid, [hiddenT1, hiddenT2], undefined);

    expect(lane.get('2026-03-02')).toEqual(expect.arrayContaining([s1, s2]));
    expect(lane.get('2026-03-02')).toHaveLength(2);
    expect(lane.get('2026-03-03')).toEqual([s3]);
    // Active template's shift must not leak into the hidden lane.
    for (const shifts of lane.values()) {
      expect(shifts).not.toContain(sActive);
    }
  });

  it('merges day arrays in template order (h1 before h2)', () => {
    const hiddenT1 = mkTemplate({ id: 'h1', is_active: false });
    const hiddenT2 = mkTemplate({ id: 'h2', is_active: false });

    const s1 = mockShift({ id: 's1', shift_template_id: 'h1', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' });
    const s2 = mockShift({ id: 's2', shift_template_id: 'h2', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' });

    const grid = buildTemplateGridData([s1, s2], [hiddenT1, hiddenT2], weekDays);
    const lane = collectHiddenLane(grid, [hiddenT1, hiddenT2], undefined);

    expect(lane.get('2026-03-02')).toEqual([s1, s2]);
  });

  it('honors areaFilter using the t.area || UNASSIGNED convention', () => {
    const hiddenCold = mkTemplate({ id: 'h-cold', is_active: false, area: 'Cold Stone' });
    const hiddenUnassigned = mkTemplate({ id: 'h-none', is_active: false, area: null });

    const sCold = mockShift({ id: 's1', shift_template_id: 'h-cold', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' });
    const sUnassigned = mockShift({ id: 's2', shift_template_id: 'h-none', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' });

    const grid = buildTemplateGridData([sCold, sUnassigned], [hiddenCold, hiddenUnassigned], weekDays);

    const coldLane = collectHiddenLane(grid, [hiddenCold, hiddenUnassigned], 'Cold Stone');
    expect(coldLane.get('2026-03-02')).toEqual([sCold]);

    const unassignedLane = collectHiddenLane(grid, [hiddenCold, hiddenUnassigned], UNASSIGNED);
    expect(unassignedLane.get('2026-03-02')).toEqual([sUnassigned]);
  });

  it('returns an empty Map when there are no hidden templates', () => {
    const grid = buildTemplateGridData([], [], weekDays);
    const lane = collectHiddenLane(grid, [], undefined);
    expect(lane.size).toBe(0);
  });

  it('returns an empty Map when hidden templates have no shifts this week', () => {
    const hiddenT1 = mkTemplate({ id: 'h1', is_active: false });
    const grid = buildTemplateGridData([], [hiddenT1], weekDays);
    const lane = collectHiddenLane(grid, [hiddenT1], undefined);
    expect(lane.size).toBe(0);
  });
});

describe('invariant: computeTotalHours never sees templates', () => {
  it('is identical whether or not a template is hidden (same shifts input)', () => {
    const shifts = [
      mockShift({ id: 's1', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00', break_duration: 30 }),
      mockShift({ id: 's2', start_time: '2026-03-03T09:00:00', end_time: '2026-03-03T17:00:00', break_duration: 0 }),
    ];

    // computeTotalHours takes only `shifts` — hiding a template can never
    // change this result because the function has no template parameter.
    const beforeHide = computeTotalHours(shifts);
    const afterHide = computeTotalHours(shifts);

    expect(afterHide).toBe(beforeHide);
    expect(computeTotalHours).toHaveLength(1);
  });
});

describe('invariant: buildTemplateGridData buckets hidden-template shifts under the template', () => {
  it('a hidden template FK-linked shift is bucketed under that template, not __unmatched__', () => {
    const hiddenTemplate = mkTemplate({ id: 'h1', is_active: false });
    const activeTemplate = mkTemplate({ id: 'a1', is_active: true });

    const shift = mockShift({
      id: 's1',
      shift_template_id: 'h1',
      start_time: '2026-03-02T10:00:00',
      end_time: '2026-03-02T16:00:00',
    });

    // Grid must be built with ALL templates (active + hidden) per design.
    const grid = buildTemplateGridData([shift], [hiddenTemplate, activeTemplate], weekDays);

    expect(grid.get('h1')?.get('2026-03-02')).toEqual([shift]);
    expect(grid.get('__unmatched__')?.get('2026-03-02') ?? []).toHaveLength(0);
  });
});

describe('invariant: computeOpenShiftCount excludes hidden templates when caller filters to active', () => {
  it('given only active templates, a hidden template contributes zero open slots', () => {
    const tz = 'America/Chicago';
    const weekDay = '2026-06-29'; // Monday, in days=[1..5]

    const hiddenTemplate = mkTemplate({ id: 'h1', is_active: false, capacity: 2 });
    const activeTemplate = mkTemplate({ id: 'a1', is_active: true, capacity: 1 });

    // No shifts assigned at all — both templates would have open slots if counted.
    const shifts: Shift[] = [];

    const countAllTemplates = computeOpenShiftCount(
      [hiddenTemplate, activeTemplate],
      shifts,
      [weekDay],
      tz,
    );
    const countActiveOnly = computeOpenShiftCount(
      [activeTemplate],
      shifts,
      [weekDay],
      tz,
    );

    // Active-only excludes the hidden template's 2 open slots.
    expect(countAllTemplates).toBe(3); // 2 (hidden) + 1 (active)
    expect(countActiveOnly).toBe(1); // only the active template's capacity
  });
});
