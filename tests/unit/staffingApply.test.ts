import { describe, it, expect } from 'vitest';
import { distributePositions } from '@/lib/staffingApply';

describe('distributePositions', () => {
  it('returns generic Staff when min_crew is null', () => {
    expect(distributePositions(3, null)).toEqual([{ position: 'Staff', count: 3 }]);
  });

  it('returns generic Staff when min_crew is empty', () => {
    expect(distributePositions(2, {})).toEqual([{ position: 'Staff', count: 2 }]);
  });

  it('splits proportionally and preserves total headcount', () => {
    const out = distributePositions(3, { Server: 3, Cook: 2 }); // weights 3:2
    expect(out.reduce((s, p) => s + p.count, 0)).toBe(3);
    expect(out.find((p) => p.position === 'Server')!.count).toBe(2);
    expect(out.find((p) => p.position === 'Cook')!.count).toBe(1);
  });

  it('gives every listed position at least the headcount it can when headcount < positions', () => {
    const out = distributePositions(1, { Server: 1, Cook: 1, Host: 1 });
    expect(out.reduce((s, p) => s + p.count, 0)).toBe(1);
  });

  it('returns empty for zero headcount', () => {
    expect(distributePositions(0, { Server: 1 })).toEqual([]);
  });
});
