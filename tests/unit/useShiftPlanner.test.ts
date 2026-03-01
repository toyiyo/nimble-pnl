import { describe, it, expect } from 'vitest';
import { buildGridData, buildTemplateGridData, getWeekDays } from '@/hooks/useShiftPlanner';
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
});
