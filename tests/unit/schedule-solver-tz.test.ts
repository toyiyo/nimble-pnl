import { describe, it, expect } from 'vitest';
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';
import type { ScheduleContext } from '../../supabase/functions/_shared/schedule-solver';

function smallCtx(): ScheduleContext {
  return {
    restaurantId: 'r1',
    weekStart: '2026-06-08',
    employees: [
      { id: 'e1', name: 'A', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '1990-01-01', is_minor: false },
    ],
    templates: [
      { id: 't1', name: 'L', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1, 2, 3, 4, 5] },
    ],
    availability: {
      'e1': Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' }])),
    },
    requiredStaff: new Map([
      ['t1:2026-06-08', { template_id: 't1', day: '2026-06-08', count: 1 }],
      ['t1:2026-06-12', { template_id: 't1', day: '2026-06-12', count: 1 }],
    ]),
    lockedShifts: [],
    excludedEmployeeIds: new Set(),
    priorPatterns: [],
    weeklySalesHistory: [],
    hourlySalesHistory: [],
    targetLaborPercentage: 0.30,
    minimumWageCents: 0,
  };
}

describe('solveSchedule — TZ portability', () => {
  it('produces stable output regardless of host TZ (snapshot)', () => {
    const result = solveSchedule(smallCtx());
    expect(result.shifts).toMatchInlineSnapshot(`
      [
        {
          "day": "2026-06-08",
          "employee_id": "e1",
          "end_time": "16:30:00",
          "position": "Server",
          "start_time": "10:00:00",
          "template_id": "t1",
        },
        {
          "day": "2026-06-12",
          "employee_id": "e1",
          "end_time": "16:30:00",
          "position": "Server",
          "start_time": "10:00:00",
          "template_id": "t1",
        },
      ]
    `);
    expect(result.unfilled).toEqual([]);
  });
});
