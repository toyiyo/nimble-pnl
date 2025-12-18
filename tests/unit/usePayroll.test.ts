import { describe, it, expect } from 'vitest';
import { aggregateTips } from '@/hooks/usePayroll';

describe('aggregateTips', () => {
  it('combines tip_split_items and employee_tips (cents) into dollars per employee', () => {
    const tipItems = [
      { employee_id: 'e1', amount: 5000 }, // $50
      { employee_id: 'e1', amount: 2500 }, // $25
      { employee_id: 'e2', amount: 1000 }, // $10
    ];

    const employeeTips = [
      { employee_id: 'e1', tip_amount: 1500 }, // $15
      { employee_id: 'e3', tip_amount: 2000 }, // $20
    ];

    const map = aggregateTips(tipItems, employeeTips);

    expect(map.get('e1')).toBeCloseTo(90); // 50 + 25 + 15
    expect(map.get('e2')).toBeCloseTo(10);
    expect(map.get('e3')).toBeCloseTo(20);
    expect(map.get('missing')).toBeUndefined();
  });

  it('handles empty inputs', () => {
    const map = aggregateTips([], []);
    expect(map.size).toBe(0);
  });
});
