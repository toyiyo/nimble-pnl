import { describe, it, expect } from 'vitest';
import { buildGridData, buildTemplateGridData, buildShiftPayload, getWeekDays, getMondayOfWeek, getWeekEnd, computeTotalHours, formatLocalTime } from '@/hooks/useShiftPlanner';
import { ShiftInterval } from '@/lib/shiftInterval';
import type { Shift, ShiftTemplate } from '@/types/scheduling';

function mockShift(overrides: Partial<Shift>): Shift {
  return {
    id: crypto.randomUUID(),
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

describe('useShiftPlanner utilities', () => {
  describe('getWeekDays', () => {
    it('should return 7 days starting from the given Monday', () => {
      const monday = new Date('2026-03-02T00:00:00'); // a Monday
      const days = getWeekDays(monday);
      expect(days).toHaveLength(7);
      expect(days[0]).toBe('2026-03-02');
      expect(days[6]).toBe('2026-03-08');
    });

    it('should return consecutive dates', () => {
      const monday = new Date('2026-03-02T00:00:00');
      const days = getWeekDays(monday);
      expect(days).toEqual([
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
        '2026-03-06',
        '2026-03-07',
        '2026-03-08',
      ]);
    });

    it('should handle month boundary crossing', () => {
      const monday = new Date('2026-02-23T00:00:00');
      const days = getWeekDays(monday);
      expect(days[0]).toBe('2026-02-23');
      expect(days[5]).toBe('2026-02-28');
      expect(days[6]).toBe('2026-03-01');
    });

    it('should handle year boundary crossing', () => {
      const monday = new Date('2025-12-29T00:00:00');
      const days = getWeekDays(monday);
      expect(days[0]).toBe('2025-12-29');
      expect(days[3]).toBe('2026-01-01');
      expect(days[6]).toBe('2026-01-04');
    });
  });

  describe('buildGridData', () => {
    it('should group shifts by employee and day', () => {
      const shifts = [
        mockShift({ employee_id: 'e1', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' }),
        mockShift({ employee_id: 'e1', start_time: '2026-03-04T14:00:00', end_time: '2026-03-04T22:00:00' }),
        mockShift({ employee_id: 'e2', start_time: '2026-03-02T08:00:00', end_time: '2026-03-02T14:00:00' }),
      ];
      const days = getWeekDays(new Date('2026-03-02T00:00:00'));
      const grid = buildGridData(shifts, days);

      expect(grid.get('e1')?.get('2026-03-02')).toHaveLength(1);
      expect(grid.get('e1')?.get('2026-03-04')).toHaveLength(1);
      expect(grid.get('e1')?.get('2026-03-03')).toBeUndefined();
      expect(grid.get('e2')?.get('2026-03-02')).toHaveLength(1);
    });

    it('should handle open shifts (no employee_id)', () => {
      const shifts = [
        mockShift({ employee_id: '', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' }),
      ];
      const days = getWeekDays(new Date('2026-03-02T00:00:00'));
      const grid = buildGridData(shifts, days);
      expect(grid.get('__open__')?.get('2026-03-02')).toHaveLength(1);
    });

    it('should handle null employee_id as open shift', () => {
      const shifts = [
        mockShift({ employee_id: null as unknown as string, start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' }),
      ];
      const days = getWeekDays(new Date('2026-03-02T00:00:00'));
      const grid = buildGridData(shifts, days);
      expect(grid.get('__open__')?.get('2026-03-02')).toHaveLength(1);
    });

    it('should handle employee with multiple shifts on same day', () => {
      const shifts = [
        mockShift({ employee_id: 'e1', start_time: '2026-03-02T08:00:00', end_time: '2026-03-02T12:00:00' }),
        mockShift({ employee_id: 'e1', start_time: '2026-03-02T16:00:00', end_time: '2026-03-02T22:00:00' }),
      ];
      const days = getWeekDays(new Date('2026-03-02T00:00:00'));
      const grid = buildGridData(shifts, days);
      expect(grid.get('e1')?.get('2026-03-02')).toHaveLength(2);
    });

    it('should exclude shifts outside the week', () => {
      const shifts = [
        mockShift({ employee_id: 'e1', start_time: '2026-03-01T10:00:00', end_time: '2026-03-01T16:00:00' }), // Sunday before
        mockShift({ employee_id: 'e1', start_time: '2026-03-09T10:00:00', end_time: '2026-03-09T16:00:00' }), // Monday after
        mockShift({ employee_id: 'e1', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' }), // Monday (in range)
      ];
      const days = getWeekDays(new Date('2026-03-02T00:00:00'));
      const grid = buildGridData(shifts, days);
      expect(grid.get('e1')?.size).toBe(1);
      expect(grid.get('e1')?.get('2026-03-02')).toHaveLength(1);
    });

    it('should return empty map for no shifts', () => {
      const days = getWeekDays(new Date('2026-03-02T00:00:00'));
      const grid = buildGridData([], days);
      expect(grid.size).toBe(0);
    });

    it('should handle multiple employees across multiple days', () => {
      const shifts = [
        mockShift({ employee_id: 'e1', start_time: '2026-03-02T08:00:00', end_time: '2026-03-02T14:00:00' }),
        mockShift({ employee_id: 'e2', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' }),
        mockShift({ employee_id: 'e3', start_time: '2026-03-03T09:00:00', end_time: '2026-03-03T17:00:00' }),
        mockShift({ employee_id: 'e1', start_time: '2026-03-05T12:00:00', end_time: '2026-03-05T20:00:00' }),
      ];
      const days = getWeekDays(new Date('2026-03-02T00:00:00'));
      const grid = buildGridData(shifts, days);

      expect(grid.size).toBe(3); // 3 employees
      expect(grid.get('e1')?.size).toBe(2); // 2 days with shifts
      expect(grid.get('e2')?.size).toBe(1);
      expect(grid.get('e3')?.size).toBe(1);
    });
  });

  describe('buildTemplateGridData', () => {
    const templates: ShiftTemplate[] = [
      { id: 't1', start_time: '06:00:00', end_time: '12:00:00', position: 'Server', days: [1, 2, 3, 4, 5], name: 'Morning', restaurant_id: 'r1', break_duration: 0, is_active: true, created_at: '', updated_at: '' },
      { id: 't2', start_time: '17:00:00', end_time: '23:00:00', position: 'Bartender', days: [0, 6], name: 'Evening', restaurant_id: 'r1', break_duration: 0, is_active: true, created_at: '', updated_at: '' },
    ];

    const weekDays = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'];

    it('should group shifts by template ID and day', () => {
      const shifts = [
        mockShift({ id: 's1', employee_id: 'e1', start_time: '2026-03-02T06:00:00', end_time: '2026-03-02T12:00:00', position: 'Server', status: 'scheduled' }),
        mockShift({ id: 's2', employee_id: 'e2', start_time: '2026-03-02T06:00:00', end_time: '2026-03-02T12:00:00', position: 'Server', status: 'scheduled' }),
      ];
      const grid = buildTemplateGridData(shifts, templates, weekDays);
      const t1Days = grid.get('t1');
      expect(t1Days).toBeDefined();
      const monShifts = t1Days!.get('2026-03-02');
      expect(monShifts).toHaveLength(2);
    });

    it('should not match shifts to wrong template', () => {
      const shifts = [
        mockShift({ id: 's1', employee_id: 'e1', start_time: '2026-03-02T17:00:00', end_time: '2026-03-02T23:00:00', position: 'Bartender', status: 'scheduled' }),
      ];
      const grid = buildTemplateGridData(shifts, templates, weekDays);
      const t1Days = grid.get('t1');
      expect(t1Days?.get('2026-03-02') ?? []).toHaveLength(0);
    });

    it('should put unmatched shifts under __unmatched__', () => {
      const shifts = [
        mockShift({ id: 's1', employee_id: 'e1', start_time: '2026-03-02T14:00:00', end_time: '2026-03-02T18:00:00', position: 'Host', status: 'scheduled' }),
      ];
      const grid = buildTemplateGridData(shifts, templates, weekDays);
      const unmatched = grid.get('__unmatched__');
      expect(unmatched?.get('2026-03-02')).toHaveLength(1);
    });

    it('should exclude cancelled shifts', () => {
      const shifts = [
        mockShift({ id: 's1', employee_id: 'e1', start_time: '2026-03-02T06:00:00', end_time: '2026-03-02T12:00:00', position: 'Server', status: 'cancelled' }),
      ];
      const grid = buildTemplateGridData(shifts, templates, weekDays);
      expect(grid.get('t1')?.get('2026-03-02') ?? []).toHaveLength(0);
    });

    it('should not match template when day is not in template.days', () => {
      // t2 has days=[0,6] (weekends). A Monday (day=1) Bartender shift at t2 times should be unmatched.
      const shifts = [
        mockShift({ id: 's1', employee_id: 'e1', start_time: '2026-03-02T17:00:00', end_time: '2026-03-02T23:00:00', position: 'Bartender', status: 'scheduled' }),
      ];
      const grid = buildTemplateGridData(shifts, templates, weekDays);
      expect(grid.get('t2')?.get('2026-03-02') ?? []).toHaveLength(0);
      expect(grid.get('__unmatched__')?.get('2026-03-02')).toHaveLength(1);
    });

    it('should match template when day is in template.days', () => {
      // t2 has days=[0,6] (weekends). A Saturday (day=6, 2026-03-07) Bartender shift should match t2.
      const shifts = [
        mockShift({ id: 's1', employee_id: 'e1', start_time: '2026-03-07T17:00:00', end_time: '2026-03-07T23:00:00', position: 'Bartender', status: 'scheduled' }),
      ];
      const grid = buildTemplateGridData(shifts, templates, weekDays);
      expect(grid.get('t2')?.get('2026-03-07')).toHaveLength(1);
    });

    it('should match shifts with UTC timestamps (Z suffix) to local-time templates', () => {
      // Simulate what Supabase returns: 6am local CST (UTC-6) = noon UTC
      // ShiftInterval.create('2026-03-02', '06:00', '12:00') in CST →
      //   new Date('2026-03-02T06:00:00').toISOString() → '2026-03-02T12:00:00.000Z'
      // The grid matching must convert back to local time (06:00:00) to match template
      const localSixAm = new Date('2026-03-02T06:00:00');
      const localNoon = new Date('2026-03-02T12:00:00');

      const shifts = [
        mockShift({
          id: 's1',
          employee_id: 'e1',
          start_time: localSixAm.toISOString(),
          end_time: localNoon.toISOString(),
          position: 'Server',
          status: 'scheduled',
        }),
      ];

      const grid = buildTemplateGridData(shifts, templates, weekDays);
      const t1Days = grid.get('t1');
      expect(t1Days?.get('2026-03-02')).toHaveLength(1);
    });

    it('should bucket shift by shift_template_id when present, ignoring time-based matching', () => {
      // Two templates with identical time/position/days but different areas
      const cscTemplate: ShiftTemplate = {
        id: 't-csc', start_time: '10:00:00', end_time: '16:30:00', position: 'Server',
        days: [5, 6, 0], name: 'Open-weekend-csc', area: 'Cold Stone',
        restaurant_id: 'r1', break_duration: 0, capacity: 2, is_active: true, created_at: '', updated_at: '',
      };
      const wtzTemplate: ShiftTemplate = {
        id: 't-wtz', start_time: '10:00:00', end_time: '16:30:00', position: 'Server',
        days: [5, 6, 0], name: 'Open-weekend-wtz', area: "Wetzel's",
        restaurant_id: 'r1', break_duration: 0, capacity: 2, is_active: true, created_at: '', updated_at: '',
      };

      // Shift explicitly linked to wtz template
      const shift = mockShift({
        id: 's1', employee_id: 'e1',
        start_time: '2026-03-07T10:00:00', end_time: '2026-03-07T16:30:00',
        position: 'Server', status: 'scheduled',
        shift_template_id: 't-wtz',
      });

      const grid = buildTemplateGridData([shift], [cscTemplate, wtzTemplate], weekDays);

      // Should be in wtz bucket, NOT csc (which would be the .find() first-match)
      expect(grid.get('t-wtz')?.get('2026-03-07')).toHaveLength(1);
      expect(grid.get('t-csc')?.get('2026-03-07') ?? []).toHaveLength(0);
    });

    it('should fall back to time-based matching when shift_template_id is absent', () => {
      // Legacy shift without shift_template_id — should still match by time/position/day
      const shift = mockShift({
        id: 's1', employee_id: 'e1',
        start_time: '2026-03-02T06:00:00', end_time: '2026-03-02T12:00:00',
        position: 'Server', status: 'scheduled',
        // No shift_template_id
      });

      const grid = buildTemplateGridData([shift], templates, weekDays);
      expect(grid.get('t1')?.get('2026-03-02')).toHaveLength(1);
    });

    it('should bucket shift as unmatched when shift_template_id references an archived template', () => {
      // Shift has a template ID that is NOT in the active templates list (archived/deleted)
      // Should go to __unmatched__, NOT fall through to time-based matching
      const shift = mockShift({
        id: 's1', employee_id: 'e1',
        start_time: '2026-03-02T06:00:00', end_time: '2026-03-02T12:00:00',
        position: 'Server', status: 'scheduled',
        shift_template_id: 'archived-template-id',
      });

      const grid = buildTemplateGridData([shift], templates, weekDays);
      // Must NOT match t1 via time-based fallback
      expect(grid.get('t1')?.get('2026-03-02') ?? []).toHaveLength(0);
      // Must be in __unmatched__
      expect(grid.get('__unmatched__')?.get('2026-03-02')).toHaveLength(1);
    });

    it('should match shifts with timezone offset (+00:00) to local-time templates', () => {
      // Supabase may return timestamps with +00:00 instead of Z
      const localSixAm = new Date('2026-03-02T06:00:00');
      const localNoon = new Date('2026-03-02T12:00:00');
      // Manually build +00:00 format like Supabase might return
      const startStr = localSixAm.toISOString().replace('Z', '+00:00');
      const endStr = localNoon.toISOString().replace('Z', '+00:00');

      const shifts = [
        mockShift({
          id: 's1',
          employee_id: 'e1',
          start_time: startStr,
          end_time: endStr,
          position: 'Server',
          status: 'scheduled',
        }),
      ];

      const grid = buildTemplateGridData(shifts, templates, weekDays);
      const t1Days = grid.get('t1');
      expect(t1Days?.get('2026-03-02')).toHaveLength(1);
    });
  });

  describe('formatLocalTime', () => {
    it('should extract local HH:MM:SS from a naive ISO string', () => {
      expect(formatLocalTime('2026-03-02T06:00:00')).toBe('06:00:00');
      expect(formatLocalTime('2026-03-02T23:30:45')).toBe('23:30:45');
    });

    it('should convert UTC timestamp to local time', () => {
      const localSixAm = new Date('2026-03-02T06:00:00');
      const utcStr = localSixAm.toISOString();
      expect(formatLocalTime(utcStr)).toBe('06:00:00');
    });

    it('should handle +00:00 suffix', () => {
      const localNoon = new Date('2026-03-02T12:00:00');
      const offsetStr = localNoon.toISOString().replace('Z', '+00:00');
      expect(formatLocalTime(offsetStr)).toBe('12:00:00');
    });

    it('should handle midnight', () => {
      expect(formatLocalTime('2026-03-02T00:00:00')).toBe('00:00:00');
    });
  });

  describe('getMondayOfWeek', () => {
    it('should return same date when given a Monday', () => {
      const monday = new Date('2026-03-02T10:30:00');
      const result = getMondayOfWeek(monday);
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(2); // March
      expect(result.getDate()).toBe(2);
      expect(result.getHours()).toBe(0);
    });

    it('should go back to Monday when given a Wednesday', () => {
      const wed = new Date('2026-03-04T14:00:00');
      const result = getMondayOfWeek(wed);
      expect(result.getDate()).toBe(2);
    });

    it('should go back to Monday when given a Sunday', () => {
      const sun = new Date('2026-03-08T12:00:00');
      const result = getMondayOfWeek(sun);
      expect(result.getDate()).toBe(2);
    });

    it('should go back to Monday when given a Saturday', () => {
      const sat = new Date('2026-03-07T12:00:00');
      const result = getMondayOfWeek(sat);
      expect(result.getDate()).toBe(2);
    });

    it('should handle month boundary (Sunday in March, Monday in Feb)', () => {
      const sun = new Date('2026-03-01T12:00:00');
      const result = getMondayOfWeek(sun);
      expect(result.getMonth()).toBe(1); // February
      expect(result.getDate()).toBe(23);
    });

    it('should set time to midnight', () => {
      const d = new Date('2026-03-04T15:30:45');
      const result = getMondayOfWeek(d);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });
  });

  describe('getWeekEnd', () => {
    it('should return Sunday 23:59:59.999 from a Monday', () => {
      const monday = new Date('2026-03-02T00:00:00');
      const end = getWeekEnd(monday);
      expect(end.getDate()).toBe(8); // Sunday March 8
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
      expect(end.getMilliseconds()).toBe(999);
    });

    it('should handle month boundary', () => {
      const monday = new Date('2026-02-23T00:00:00');
      const end = getWeekEnd(monday);
      expect(end.getMonth()).toBe(2); // March
      expect(end.getDate()).toBe(1);
    });
  });

  describe('computeTotalHours', () => {
    it('should compute hours for a single shift', () => {
      const shifts = [
        mockShift({ start_time: '2026-03-02T08:00:00', end_time: '2026-03-02T16:00:00', break_duration: 0 }),
      ];
      expect(computeTotalHours(shifts)).toBe(8);
    });

    it('should subtract break duration', () => {
      const shifts = [
        mockShift({ start_time: '2026-03-02T08:00:00', end_time: '2026-03-02T16:00:00', break_duration: 30 }),
      ];
      expect(computeTotalHours(shifts)).toBe(7.5);
    });

    it('should exclude cancelled shifts', () => {
      const shifts = [
        mockShift({ start_time: '2026-03-02T08:00:00', end_time: '2026-03-02T16:00:00', break_duration: 0, status: 'scheduled' }),
        mockShift({ start_time: '2026-03-03T08:00:00', end_time: '2026-03-03T16:00:00', break_duration: 0, status: 'cancelled' }),
      ];
      expect(computeTotalHours(shifts)).toBe(8);
    });

    it('should sum multiple shifts', () => {
      const shifts = [
        mockShift({ start_time: '2026-03-02T08:00:00', end_time: '2026-03-02T12:00:00', break_duration: 0 }),
        mockShift({ start_time: '2026-03-02T14:00:00', end_time: '2026-03-02T20:00:00', break_duration: 0 }),
      ];
      expect(computeTotalHours(shifts)).toBe(10);
    });

    it('should return 0 for empty shifts', () => {
      expect(computeTotalHours([])).toBe(0);
    });

    it('should handle shifts where break exceeds duration (net 0)', () => {
      const shifts = [
        mockShift({ start_time: '2026-03-02T08:00:00', end_time: '2026-03-02T08:30:00', break_duration: 60 }),
      ];
      expect(computeTotalHours(shifts)).toBe(0);
    });
  });

  describe('buildGridData with UTC timestamps', () => {
    it('should extract local date from UTC timestamp', () => {
      // A shift at 11pm local on March 2 in UTC-6 = 5am UTC March 3
      // The grid should place it on March 2 (local), not March 3 (UTC)
      const localLateNight = new Date('2026-03-02T23:00:00');
      const localEnd = new Date('2026-03-03T03:00:00');

      const shifts = [
        mockShift({
          employee_id: 'e1',
          start_time: localLateNight.toISOString(),
          end_time: localEnd.toISOString(),
        }),
      ];
      const days = getWeekDays(new Date('2026-03-02T00:00:00'));
      const grid = buildGridData(shifts, days);

      // Should be on March 2 (local date), not whatever UTC date it converts to
      expect(grid.get('e1')?.get('2026-03-02')).toHaveLength(1);
    });
  });

  describe('buildShiftPayload', () => {
    it('should include shift_template_id and source=template when shiftTemplateId is provided', () => {
      const input = {
        employeeId: 'e1',
        date: '2026-03-02',
        startTime: '10:00',
        endTime: '16:30',
        position: 'Server',
        breakDuration: 30,
        shiftTemplateId: 'tmpl-123',
      };
      const interval = ShiftInterval.create('2026-03-02', '10:00', '16:30');
      const payload = buildShiftPayload('r1', input, interval);

      expect(payload.shift_template_id).toBe('tmpl-123');
      expect(payload.source).toBe('template');
      expect(payload.restaurant_id).toBe('r1');
      expect(payload.employee_id).toBe('e1');
      expect(payload.position).toBe('Server');
      expect(payload.break_duration).toBe(30);
    });

    it('should set shift_template_id to null and source=manual when no template ID', () => {
      const input = {
        employeeId: 'e1',
        date: '2026-03-02',
        startTime: '10:00',
        endTime: '16:30',
        position: 'Server',
      };
      const interval = ShiftInterval.create('2026-03-02', '10:00', '16:30');
      const payload = buildShiftPayload('r1', input, interval);

      expect(payload.shift_template_id).toBeNull();
      expect(payload.source).toBe('manual');
    });
  });
});
