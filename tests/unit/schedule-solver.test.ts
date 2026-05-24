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
