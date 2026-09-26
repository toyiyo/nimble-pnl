import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calculateEmployeePay } from '@/utils/payrollCalculations';
import { parseDateOnly } from '../../supabase/functions/_shared/labor/dateOnly';
import type { LaborEmployee, LaborTimePunch } from '../../supabase/functions/_shared/labor/types';

// calculateEmployeePay groups the restaurant days of a pay period into
// weeks (WEEK_STARTS_ON = Monday) for weekly overtime. The week key comes
// from the day string, so the result is the same on every host timezone.
const TZ = 'America/Chicago';
const employee: LaborEmployee = {
  id: 'e1', restaurant_id: 'r', name: 'E1', position: 'Cook', status: 'active',
  is_active: true, compensation_type: 'hourly', hourly_rate: 2000,
};

function shift(day: string, n: number): LaborTimePunch[] {
  // 15:00Z-00:00Z next day = 10:00-19:00 CDT: 9 hours on `day` (Chicago).
  const inT = `${day}T15:00:00.000Z`;
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 3600e3).toISOString().slice(0, 10);
  const outT = `${next}T00:00:00.000Z`;
  return [
    { id: `i${n}`, restaurant_id: 'r', employee_id: 'e1', punch_type: 'clock_in', punch_time: inT, created_at: inT, updated_at: inT },
    { id: `o${n}`, restaurant_id: 'r', employee_id: 'e1', punch_type: 'clock_out', punch_time: outT, created_at: outT, updated_at: outT },
  ];
}

// Week 1: Mon Jul 20 to Sun Jul 26, 2026: five 9 h shifts, the last on
// Sunday = 45 h, 5 h overtime. Week 2: Mon Jul 27: one 9 h shift, no OT.
const punches = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-25', '2026-07-26', '2026-07-27']
  .flatMap((day, n) => shift(day, n));

describe.each(['America/Chicago', 'Pacific/Auckland', 'UTC'])('weekly OT week key (host %s)', (hostTz) => {
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = hostTz;
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('bands 5 h of weekly overtime in the Monday week, not in the next week', () => {
    const dayEnd = parseDateOnly('2026-08-02');
    dayEnd.setHours(23, 59, 59, 999);
    const pay = calculateEmployeePay(employee, punches, 0, TZ, parseDateOnly('2026-07-20'), dayEnd);
    expect(pay.regularHours).toBeCloseTo(49, 6);
    expect(pay.overtimeHours).toBeCloseTo(5, 6);
  });
});
