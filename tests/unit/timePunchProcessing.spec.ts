import { test, expect } from '@playwright/test';
import { processPunchesForPeriod } from '../../src/utils/timePunchProcessing';
import { TimePunch } from '../../src/types/timeTracking';

test.describe('timePunchProcessing', () => {
  test('uses first clock_out to close a session and ignores extra clock_outs', () => {
    const employee = { id: 'emp1', name: 'Juan Valdez', position: 'Bartender' };
    const base = new Date('2025-11-26T15:39:55.000Z'); // clock in

    const punches: TimePunch[] = [
      {
        id: 'p1',
        restaurant_id: 'r1',
        employee_id: 'emp1',
        punch_type: 'clock_in',
        punch_time: new Date(base).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        employee: employee,
      },
      // manager-forced earlier clock out
      {
        id: 'p2',
        restaurant_id: 'r1',
        employee_id: 'emp1',
        punch_type: 'clock_out',
        punch_time: new Date(base.getTime() + 80 * 60 * 1000).toISOString(), // +80min
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        employee: employee,
      },
      // accidental/second force clock out later
      {
        id: 'p3',
        restaurant_id: 'r1',
        employee_id: 'emp1',
        punch_type: 'clock_out',
        punch_time: new Date(base.getTime() + 146 * 60 * 1000).toISOString(), // +146min
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        employee: employee,
      },
    ];

    const result = processPunchesForPeriod(punches);

    // Should identify a single session starting at the clock_in and ending at the first clock_out
    expect(result.sessions.length).toBe(1);
    const session = result.sessions[0];
    expect(session.clock_in.toISOString()).toBe(punches[0].punch_time);
    expect(session.clock_out?.toISOString()).toBe(punches[1].punch_time);
  });

  test('treats a clock_in after break_start as break_end and pairs a later clock_out to the session', () => {
    const employee = { id: 'emp2', name: 'Juan Valdez', position: 'Bartender' };
    // base session clock in at 3:39:55
    const base = new Date('2025-11-26T15:39:55.000Z');

    const punches: TimePunch[] = [
      // initial clock in
      {
        id: 'a1', restaurant_id: 'r1', employee_id: employee.id, punch_type: 'clock_in',
        punch_time: new Date(base).toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), employee
      },
      // break start at 3:42
      {
        id: 'a2', restaurant_id: 'r1', employee_id: employee.id, punch_type: 'break_start',
        punch_time: new Date(base.getTime() + (2 * 60 + 21) * 1000).toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), employee
      },
      // some clients store break end as a clock_in (4:05)
      {
        id: 'a3', restaurant_id: 'r1', employee_id: employee.id, punch_type: 'clock_in',
        punch_time: new Date(base.getTime() + (25 * 60 + 12) * 1000).toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), employee
      },
      // manager forced clock out later at 5:00
      {
        id: 'a4', restaurant_id: 'r1', employee_id: employee.id, punch_type: 'clock_out',
        punch_time: new Date(base.getTime() + (80 * 60) * 1000).toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), employee
      }
    ];

    const result = processPunchesForPeriod(punches);
    expect(result.sessions.length).toBe(1);
    const s = result.sessions[0];
    expect(s.clock_in.toISOString()).toBe(punches[0].punch_time);
    expect(s.clock_out?.toISOString()).toBe(punches[3].punch_time);
    // break should be recorded
    expect(s.breaks.length).toBeGreaterThan(0);
    expect(s.is_complete).toBe(true);
  });
});
