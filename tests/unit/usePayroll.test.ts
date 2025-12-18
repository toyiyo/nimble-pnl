import { describe, it, expect } from 'vitest';
import { aggregateTips, computeTipTotals } from '@/hooks/usePayroll';

describe('aggregateTips', () => {
  it('combines tip_split_items and employee_tips (cents) and returns cents', () => {
    const tipItems = [
      { employee_id: 'e1', amount: 5000 }, // 5000 cents ($50)
      { employee_id: 'e1', amount: 2500 }, // 2500 cents ($25)
      { employee_id: 'e2', amount: 1000 }, // 1000 cents ($10)
    ];

    const employeeTips = [
      { employee_id: 'e1', tip_amount: 1500 }, // 1500 cents ($15)
      { employee_id: 'e3', tip_amount: 2000 }, // 2000 cents ($20)
    ];

    const map = aggregateTips(tipItems, employeeTips);

    expect(map.get('e1')).toBe(9000); // 5000 + 2500 + 1500 cents
    expect(map.get('e2')).toBe(1000); // 1000 cents
    expect(map.get('e3')).toBe(2000); // 2000 cents
    expect(map.get('missing')).toBeUndefined();
  });

  it('handles empty inputs', () => {
    const map = aggregateTips([], []);
    expect(map.size).toBe(0);
  });
});

describe('computeTipTotals', () => {
  it('falls back to split totals when no items exist and only one employee', () => {
    const employees = [{ id: 'emp1' } as any];
    const tipItems: any[] = []; // simulate missing tip_split_items rows
    const employeeTips: any[] = [];
    const tipSplits = [
      { id: 's1', total_amount: 50000 },
      { id: 's2', total_amount: 50000 },
    ];

    const map = computeTipTotals(tipItems, employeeTips, tipSplits, employees);

    // 50000 cents each → 100000 cents total ($1000) to the single employee
    expect(map.get('emp1')).toBe(100000);
  });

  it('evenly allocates split totals to multiple employees when items are missing', () => {
    const employees = [
      { id: 'emp1', status: 'active' } as any,
      { id: 'emp2', status: 'active' } as any,
    ];
    const tipItems: any[] = []; // missing items
    const employeeTips: any[] = [];
    const tipSplits = [{ id: 's1', total_amount: 50000 }]; // 50000 cents ($500)

    const map = computeTipTotals(tipItems, employeeTips, tipSplits, employees);

    // 50000 / 2 = 25000 cents each ($250)
    expect(map.get('emp1')).toBe(25000);
    expect(map.get('emp2')).toBe(25000);
  });
});
