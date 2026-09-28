import { describe, it, expect } from 'vitest';
import { buildTimePunchShifts } from '../../supabase/functions/_shared/timePunchShifts';
import { restaurantDayBounds } from '../../supabase/functions/_shared/restaurantDate';
import type { Employee, TimePunch } from '../../supabase/functions/_shared/laborCalculations';

const TZ = 'America/Chicago';

function hourlyEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'e1',
    name: 'Ana',
    restaurant_id: 'r1',
    status: 'active',
    position: 'Server',
    compensation_type: 'hourly',
    hourly_rate: 1500, // cents
    ...overrides,
  };
}

function punch(id: string, employee_id: string, punch_time: string, punch_type: TimePunch['punch_type']): TimePunch {
  return { id, employee_id, restaurant_id: 'r1', punch_time, punch_type };
}

describe('buildTimePunchShifts', () => {
  it('gives one row with the restaurant day and hours for a Friday-night clock-in', () => {
    const employees = [hourlyEmployee()];
    const punches = [
      punch('p1', 'e1', '2026-09-26T02:00:00Z', 'clock_in'),
      punch('p2', 'e1', '2026-09-26T08:00:00Z', 'clock_out'),
    ];
    const bounds = restaurantDayBounds('2026-09-24', '2026-09-27', TZ);

    const shifts = buildTimePunchShifts(employees, punches, bounds, TZ, 0);

    expect(shifts).toHaveLength(1);
    expect(shifts[0].date).toBe('2026-09-25');
    expect(shifts[0].hours).toBe(6);
  });

  it('drops a clock-in before bounds.start', () => {
    const employees = [hourlyEmployee()];
    const punches = [
      punch('p1', 'e1', '2026-09-20T02:00:00Z', 'clock_in'),
      punch('p2', 'e1', '2026-09-20T08:00:00Z', 'clock_out'),
    ];
    const bounds = restaurantDayBounds('2026-09-24', '2026-09-27', TZ);

    const shifts = buildTimePunchShifts(employees, punches, bounds, TZ, 0);

    expect(shifts).toHaveLength(0);
  });

  it('drops a clock-in after bounds.end', () => {
    const employees = [hourlyEmployee()];
    const punches = [
      punch('p1', 'e1', '2026-10-01T02:00:00Z', 'clock_in'),
      punch('p2', 'e1', '2026-10-01T08:00:00Z', 'clock_out'),
    ];
    const bounds = restaurantDayBounds('2026-09-24', '2026-09-27', TZ);

    const shifts = buildTimePunchShifts(employees, punches, bounds, TZ, 0);

    expect(shifts).toHaveLength(0);
  });

  it('keeps an overnight shift that ends after bounds.end', () => {
    const employees = [hourlyEmployee()];
    const bounds = restaurantDayBounds('2026-09-24', '2026-09-26', TZ);
    // Clock-in is inside bounds; clock-out lands after bounds.end.
    const punches = [
      punch('p1', 'e1', '2026-09-27T02:00:00Z', 'clock_in'),
      punch('p2', 'e1', '2026-09-27T09:00:00Z', 'clock_out'),
    ];

    const shifts = buildTimePunchShifts(employees, punches, bounds, TZ, 0);

    expect(shifts).toHaveLength(1);
    expect(shifts[0].hours).toBe(7);
  });

  it('drops a period whose hours are below minHours, and drops a break period', () => {
    const employees = [hourlyEmployee()];
    const bounds = restaurantDayBounds('2026-09-24', '2026-09-27', TZ);
    const punches = [
      // Short clock-in/out: 0.5h, below minHours of 1.
      punch('p1', 'e1', '2026-09-26T02:00:00Z', 'clock_in'),
      punch('p2', 'e1', '2026-09-26T02:30:00Z', 'clock_out'),
      // A break_start/break_end pair on a separate clock-in.
      punch('p3', 'e1', '2026-09-26T04:00:00Z', 'clock_in'),
      punch('p4', 'e1', '2026-09-26T04:15:00Z', 'break_start'),
      punch('p5', 'e1', '2026-09-26T04:30:00Z', 'break_end'),
      punch('p6', 'e1', '2026-09-26T04:31:00Z', 'clock_out'),
    ];

    const shifts = buildTimePunchShifts(employees, punches, bounds, TZ, 1);

    expect(shifts).toHaveLength(0);
  });

  it('gives cost_cents = hourly_rate x hours from the snapshot of the restaurant day, using the rate in effect that day', () => {
    const employees = [
      hourlyEmployee({
        hourly_rate: 2000, // current rate
        compensation_history: [
          {
            effective_date: '2026-09-26',
            compensation_type: 'hourly',
            amount_cents: 2000,
          },
          {
            effective_date: '2026-09-01',
            compensation_type: 'hourly',
            amount_cents: 1500, // rate before the 09-26 raise
          },
        ],
      }),
    ];
    const bounds = restaurantDayBounds('2026-09-24', '2026-09-27', TZ);
    // Friday-night shift lands on the restaurant day 2026-09-25 (before the
    // 2026-09-26 pay change), so it must use the old $15.00/hr rate.
    const punches = [
      punch('p1', 'e1', '2026-09-26T02:00:00Z', 'clock_in'),
      punch('p2', 'e1', '2026-09-26T08:00:00Z', 'clock_out'),
    ];

    const shifts = buildTimePunchShifts(employees, punches, bounds, TZ, 0);

    expect(shifts).toHaveLength(1);
    expect(shifts[0].date).toBe('2026-09-25');
    expect(shifts[0].cost_cents).toBe(9000); // 6h x $15.00/hr = $90.00, in cents
  });

  it('gives cost_cents = null for a salary or contractor employee', () => {
    const employees = [
      hourlyEmployee({
        id: 'e2',
        compensation_type: 'salary',
        salary_amount: 500000,
        pay_period_type: 'bi-weekly',
      }),
      hourlyEmployee({
        id: 'e3',
        compensation_type: 'contractor',
        contractor_payment_amount: 100000,
        contractor_payment_interval: 'weekly',
      }),
    ];
    const bounds = restaurantDayBounds('2026-09-24', '2026-09-27', TZ);
    const punches = [
      punch('p1', 'e2', '2026-09-26T02:00:00Z', 'clock_in'),
      punch('p2', 'e2', '2026-09-26T08:00:00Z', 'clock_out'),
      punch('p3', 'e3', '2026-09-26T02:00:00Z', 'clock_in'),
      punch('p4', 'e3', '2026-09-26T08:00:00Z', 'clock_out'),
    ];

    const shifts = buildTimePunchShifts(employees, punches, bounds, TZ, 0);

    expect(shifts).toHaveLength(2);
    for (const shift of shifts) {
      expect(shift.cost_cents).toBeNull();
    }
  });

  it('gives fields matching the current Shift type in executeGetTimePunches', () => {
    const employees = [hourlyEmployee()];
    const bounds = restaurantDayBounds('2026-09-24', '2026-09-27', TZ);
    const punches = [
      punch('p1', 'e1', '2026-09-26T02:00:00Z', 'clock_in'),
      punch('p2', 'e1', '2026-09-26T08:00:00Z', 'clock_out'),
    ];

    const shifts = buildTimePunchShifts(employees, punches, bounds, TZ, 0);

    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toEqual({
      employee_id: 'e1',
      employee_name: 'Ana',
      position: 'Server',
      compensation_type: 'hourly',
      start_time: '2026-09-26T02:00:00.000Z',
      end_time: '2026-09-26T08:00:00.000Z',
      hours: 6,
      cost_cents: 9000,
      date: '2026-09-25',
    });
  });
});
