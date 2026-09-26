import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateDailyAllocation } from '@/utils/compensationCalculations';
import type { LaborEmployee } from '../../supabase/functions/_shared/labor/types';

// generateDailyAllocation takes a calendar day (YYYY-MM-DD). It must read it
// as a local-midnight day token (parseDateOnly), not `new Date(date)`, which
// is UTC midnight and is the previous local day on a host west of UTC.
const salaried: LaborEmployee = {
  id: 'e1',
  restaurant_id: 'rest-1',
  name: 'Salaried',
  position: 'Manager',
  status: 'active',
  is_active: true,
  compensation_type: 'salary',
  hourly_rate: 0,
  salary_amount: 70000,
  pay_period_type: 'weekly',
};

describe.each(['America/Chicago', 'Pacific/Auckland', 'UTC'])('generateDailyAllocation day token (host %s)', (tz) => {
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('puts Sunday 2026-03-01 in the weekly pay period that starts on that Sunday', () => {
    const allocation = generateDailyAllocation(salaried, '2026-03-01');
    expect(allocation.source_pay_period_start).toBe('2026-03-01');
    expect(allocation.source_pay_period_end).toBe('2026-03-07');
  });
});
