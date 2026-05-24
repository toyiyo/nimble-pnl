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

describe('solveSchedule — Stage B (locked shifts seed)', () => {
  it("a locked 6.5h shift counts against the employee's fairness/hours", () => {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'e1', name: 'Alice', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '2000-01-01', is_minor: false },
    ];
    ctx.lockedShifts = [
      { employee_id: 'e1', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = solveSchedule(ctx);
    const e1Row = result.fairness.find((f) => f.employee_id === 'e1');
    expect(e1Row).toMatchObject({ hours_assigned: 6.5, days_worked: 1 });
  });
});

describe('solveSchedule — eligibility (position + area + availability + window)', () => {
  function ctxWithOneSlot(opts: {
    employeePosition: string;
    employeeArea: string | null;
    slotPosition: string;
    slotArea: string | null;
    availability?: { isAvailable: boolean; startTime: string | null; endTime: string | null };
  }) {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'e1', name: 'A', position: opts.employeePosition, area: opts.employeeArea,
        max_weekly_hours: 40, date_of_birth: '2000-01-01', is_minor: false },
    ];
    ctx.templates = [
      { id: 't1', name: 'Lunch', position: opts.slotPosition, area: opts.slotArea,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1] },
    ];
    ctx.requiredStaff = new Map([
      ['t1:2026-06-08', { template_id: 't1', day: '2026-06-08', count: 1 }],
    ]);
    ctx.availability = {
      'e1': { 1: opts.availability ?? { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
    };
    return ctx;
  }

  it('position mismatch → unfilled', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Cook', employeeArea: null,
      slotPosition: 'Server', slotArea: null,
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(0);
    expect(result.unfilled).toHaveLength(1);
  });

  it('area match required when slot has an area', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Server', employeeArea: 'Brand A',
      slotPosition: 'Server', slotArea: 'Brand B',
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(0);
  });

  it('availability outside window → unfilled', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Server', employeeArea: null,
      slotPosition: 'Server', slotArea: null,
      availability: { isAvailable: true, startTime: '16:30:00', endTime: '19:00:00' },
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(0);
  });

  it('unavailable day → unfilled', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Server', employeeArea: null,
      slotPosition: 'Server', slotArea: null,
      availability: { isAvailable: false, startTime: null, endTime: null },
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(0);
  });

  it('all predicates satisfied → assigned', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Server', employeeArea: null,
      slotPosition: 'Server', slotArea: null,
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(1);
    expect(result.shifts[0]).toMatchObject({
      employee_id: 'e1', template_id: 't1', day: '2026-06-08',
      start_time: '10:00:00', end_time: '16:30:00', position: 'Server',
    });
    expect(result.unfilled).toHaveLength(0);
  });

  it('overnight availability window admits a shift in its evening half', () => {
    // Regression: withinWindow needs minute integers, not HH:MM:SS strings.
    // String comparison happens to work for non-overnight windows but fails
    // for overnight windows like 18:00 → 02:00.
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'e1', name: 'A', position: 'Server', area: null,
        max_weekly_hours: 40, date_of_birth: '2000-01-01', is_minor: false },
    ];
    ctx.templates = [
      { id: 't1', name: 'Late', position: 'Server', area: null,
        start_time: '22:00:00', end_time: '23:00:00', days_of_week: [1] },
    ];
    ctx.requiredStaff = new Map([
      ['t1:2026-06-08', { template_id: 't1', day: '2026-06-08', count: 1 }],
    ]);
    ctx.availability = {
      'e1': { 1: { isAvailable: true, startTime: '18:00:00', endTime: '02:00:00' } },
    };
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(1);
  });
});
