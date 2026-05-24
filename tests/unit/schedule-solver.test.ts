import { describe, it, expect } from 'vitest';
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';
import type { ScheduleContext } from '../../supabase/functions/_shared/schedule-solver';

function emptyCtx(): ScheduleContext {
  return {
    restaurantId: 'r1',
    weekStart: '2026-06-08',
    employees: [],
    templates: [],
    availability: {},
    requiredStaff: new Map(),
    lockedShifts: [],
    excludedEmployeeIds: new Set(),
    priorPatterns: [],
    weeklySalesHistory: [],
    hourlySalesHistory: [],
    targetLaborPercentage: 0.30,
    minimumWageCents: 0,
  };
}

describe('solveSchedule — smoke', () => {
  it('empty requiredStaff returns empty result with empty fairness', () => {
    const result = solveSchedule(emptyCtx());
    expect(result.shifts).toEqual([]);
    expect(result.unfilled).toEqual([]);
    expect(result.fairness).toEqual([]);
  });

  it('empty requiredStaff but with employees returns one zero-hour fairness row per employee', () => {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'e1', name: 'Alice', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '2000-01-01', is_minor: false },
    ];
    const result = solveSchedule(ctx);
    expect(result.fairness).toEqual([
      { employee_id: 'e1', hours_assigned: 0, days_worked: 0, hours_budget: 40 },
    ]);
  });
});

describe('solveSchedule — Stage A (slot enumeration)', () => {
  it('produces one slot per required headcount per (template, day)', () => {
    const ctx = emptyCtx();
    ctx.templates = [
      { id: 't1', name: 'Lunch', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1, 2, 3] },
    ];
    ctx.requiredStaff = new Map([
      ['t1:2026-06-08', { template_id: 't1', day: '2026-06-08', count: 2 }],
    ]);
    // No employees, so all slots fall through to unfilled
    const result = solveSchedule(ctx);
    expect(result.unfilled).toHaveLength(2);
    expect(result.unfilled[0]).toMatchObject({
      template_id: 't1', day: '2026-06-08', position: 'Server',
    });
  });

  it('skips slots whose day-of-week is not in template.days_of_week', () => {
    const ctx = emptyCtx();
    ctx.templates = [
      // Mon=1, Tue=2 only — exclude Wed
      { id: 't1', name: 'Lunch', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1, 2] },
    ];
    ctx.requiredStaff = new Map([
      ['t1:2026-06-10', { template_id: 't1', day: '2026-06-10', count: 1 }], // Wed
    ]);
    const result = solveSchedule(ctx);
    expect(result.unfilled).toHaveLength(0);
    expect(result.shifts).toHaveLength(0);
  });
});
