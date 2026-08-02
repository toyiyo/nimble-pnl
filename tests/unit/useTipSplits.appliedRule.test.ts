import { describe, it, expect } from 'vitest';
import { buildSplitItemRows } from '@/hooks/useTipSplits';
import type { TipShare } from '@/utils/tipPooling';

describe('buildSplitItemRows', () => {
  it('persists the applied rule when one was in force', () => {
    const shares: TipShare[] = [
      {
        employeeId: 'e1',
        name: 'Manager Mo',
        hours: 2,
        role: 'Manager',
        amountCents: 3000,
        appliedRule: { mode: 'at_least', percentage: 30 },
      },
    ];

    expect(buildSplitItemRows('split-1', shares)).toEqual([
      {
        tip_split_id: 'split-1',
        employee_id: 'e1',
        amount: 3000,
        hours_worked: 2,
        role: 'Manager',
        role_weight: null,
        manually_edited: false,
        applied_rule: { mode: 'at_least', percentage: 30 },
      },
    ]);
  });

  it('writes null when no rule applied', () => {
    const shares: TipShare[] = [
      { employeeId: 'e2', name: 'Server Sam', hours: 8, role: 'Server', amountCents: 7000 },
    ];

    expect(buildSplitItemRows('split-1', shares)[0].applied_rule).toBeNull();
  });

  it('normalises missing hours and role to null', () => {
    const shares: TipShare[] = [{ employeeId: 'e3', name: 'Even Eve', amountCents: 100 }];
    const row = buildSplitItemRows('split-1', shares)[0];

    expect(row.hours_worked).toBeNull();
    expect(row.role).toBeNull();
  });

  it('preserves an explicit zero hours value instead of normalising it to null', () => {
    const shares: TipShare[] = [
      { employeeId: 'e4', name: 'Zero Zack', hours: 0, role: 'Server', amountCents: 500 },
    ];
    const row = buildSplitItemRows('split-1', shares)[0];

    expect(row.hours_worked).toBe(0);
  });
});
