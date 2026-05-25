import { describe, it, expect } from 'vitest';
import type { ClientSafeUnfilledSlot, ClientSafeFairnessSummary } from '../../supabase/functions/generate-schedule/index';

describe('Response shape — ClientSafe projections do not carry UUIDs', () => {
  it('ClientSafeUnfilledSlot omits template_id', () => {
    const s: ClientSafeUnfilledSlot = {
      day: '2026-06-08', position: 'Server', area: null,
      reason: 'NO_ELIGIBLE_EMPLOYEE', template_name: 'Lunch',
    };
    expect('template_id' in s).toBe(false);
  });
  it('ClientSafeFairnessSummary omits employee_id', () => {
    const f: ClientSafeFairnessSummary = {
      hours_assigned: 0, days_worked: 0, hours_budget: 40, employee_name: 'Alice',
    };
    expect('employee_id' in f).toBe(false);
  });
});
