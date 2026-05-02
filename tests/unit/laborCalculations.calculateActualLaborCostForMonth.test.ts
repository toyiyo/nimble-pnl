import { describe, it, expect } from 'vitest';
import { calculateActualLaborCostForMonth } from '@/services/laborCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

const baseEmployee: Employee = {
  id: 'e1',
  restaurant_id: 'r1',
  name: 'Test Employee',
  position: 'Server',
  status: 'active',
  is_active: true,
  compensation_type: 'hourly',
  hourly_rate: 2000, // $20.00/hr in cents
  is_exempt: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as Employee;

function punch(employeeId: string, time: string, type: 'clock_in' | 'clock_out'): TimePunch {
  return {
    id: `${employeeId}-${time}-${type}`,
    employee_id: employeeId,
    restaurant_id: 'r1',
    punch_type: type,
    punch_time: new Date(time).toISOString(),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as TimePunch;
}

describe('calculateActualLaborCostForMonth', () => {
  it('adds tipsOwed to actualLaborCents per employee', () => {
    const monthStart = new Date('2026-04-01T00:00:00');
    const monthEnd = new Date('2026-04-30T23:59:59');

    const punches: TimePunch[] = [
      punch('e1', '2026-04-15T09:00:00', 'clock_in'),
      punch('e1', '2026-04-15T17:00:00', 'clock_out'),
    ]; // 8 hours @ $20 = $160 = 16,000 cents

    const tipsOwedByEmployee = new Map<string, number>([
      ['e1', 5000], // $50.00 in cents
    ]);

    const result = calculateActualLaborCostForMonth({
      employees: [baseEmployee],
      timePunches: punches,
      tipsOwedByEmployee,
      monthStart,
      monthEnd,
    });

    expect(result.tipsOwedCents).toBe(5000);
    expect(result.wagesCents).toBe(16000); // 8h * $20
    expect(result.actualLaborCents).toBe(21000); // wages + tips
  });

  it('applies OT to a full ISO week even when the week straddles month boundary (Apr 27 – May 3)', () => {
    // ISO week: Mon Apr 27 – Sun May 3, 2026
    // 6h Mon–Fri (30h) + 12h Sat May 2 = 42h → 2h weekly OT
    // Week wages: 40h × $20 + 2h × $30 = $800 + $60 = $860 = 86,000 cents
    //
    // Per-day hours: Apr27=6, Apr28=6, Apr29=6, Apr30=6, May1=6, May2=12, totalHours=42
    // Distribution (sorted, last day takes remainder):
    //   Apr27: round(86000 × 6/42) = round(12285.71) = 12,286
    //   Apr28: round(86000 × 6/42) = 12,286
    //   Apr29: round(86000 × 6/42) = 12,286
    //   Apr30: round(86000 × 6/42) = 12,286
    //   May1:  round(86000 × 6/42) = 12,286
    //   May2 (last): 86000 − 5 × 12286 = 86000 − 61430 = 24,570
    // April total: 4 × 12,286 = 49,144
    // May total: 12,286 + 24,570 = 36,856
    // Grand total: 86,000 ✓
    const punches: TimePunch[] = [
      punch('e1', '2026-04-27T09:00:00', 'clock_in'), punch('e1', '2026-04-27T15:00:00', 'clock_out'),
      punch('e1', '2026-04-28T09:00:00', 'clock_in'), punch('e1', '2026-04-28T15:00:00', 'clock_out'),
      punch('e1', '2026-04-29T09:00:00', 'clock_in'), punch('e1', '2026-04-29T15:00:00', 'clock_out'),
      punch('e1', '2026-04-30T09:00:00', 'clock_in'), punch('e1', '2026-04-30T15:00:00', 'clock_out'),
      punch('e1', '2026-05-01T09:00:00', 'clock_in'), punch('e1', '2026-05-01T15:00:00', 'clock_out'),
      punch('e1', '2026-05-02T09:00:00', 'clock_in'), punch('e1', '2026-05-02T21:00:00', 'clock_out'), // 12h
    ];

    const aprilResult = calculateActualLaborCostForMonth({
      employees: [baseEmployee],
      timePunches: punches,
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-04-01T00:00:00'),
      monthEnd: new Date('2026-04-30T23:59:59'),
    });

    expect(aprilResult.wagesCents).toBe(49_144);

    const mayResult = calculateActualLaborCostForMonth({
      employees: [baseEmployee],
      timePunches: punches,
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-05-01T00:00:00'),
      monthEnd: new Date('2026-05-31T23:59:59'),
    });

    expect(mayResult.wagesCents).toBe(36_856);

    // April + May sum exactly to the full week pay
    expect(aprilResult.wagesCents + mayResult.wagesCents).toBe(86_000);
  });

  it('handles salaried employees by prorating across the month with no OT', () => {
    // Weekly salary: $1,000/week (100,000 cents), pay_period_type = 'weekly'
    // DAYS_PER_PAY_PERIOD['weekly'] = 7
    // Daily rate = 100,000 / 7 = 14,285.714... cents/day
    // April 2026 has 30 days: round(30 × 14,285.714) = round(428,571.4) = 428,571 cents
    const salaried: Employee = {
      ...baseEmployee,
      id: 'e2',
      compensation_type: 'salary',
      salary_amount: 100_000, // $1,000/week in cents
      pay_period_type: 'weekly',
    } as Employee;

    const result = calculateActualLaborCostForMonth({
      employees: [salaried],
      timePunches: [],
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-04-01T00:00:00'),
      monthEnd: new Date('2026-04-30T23:59:59'),
    });

    // 30 days × (100_000 / 7) = 428,571.4 → 428,571
    expect(result.wagesCents).toBe(428_571);
    expect(result.tipsOwedCents).toBe(0);
    expect(result.actualLaborCents).toBe(428_571);
  });

  it('returns zeros for an empty month', () => {
    const result = calculateActualLaborCostForMonth({
      employees: [baseEmployee],
      timePunches: [],
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-04-01T00:00:00'),
      monthEnd: new Date('2026-04-30T23:59:59'),
    });
    expect(result.wagesCents).toBe(0);
    expect(result.tipsOwedCents).toBe(0);
    expect(result.actualLaborCents).toBe(0);
  });
});
