import { describe, it, expect } from 'vitest';
import { distributePositions, shiftBlocksToTemplates } from '@/lib/staffingApply';
import type { ShiftBlock } from '@/types/scheduling';

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

describe('shiftBlocksToTemplates', () => {
  const restaurantId = 'r1';
  // 2026-05-29 is a Friday -> getDay() === 5
  const block: ShiftBlock = { startHour: 17, endHour: 22, headcount: 3, day: '2026-05-29' };

  it('maps a block to one template row per crew position with capacity = split count', () => {
    const rows = shiftBlocksToTemplates([block], { Server: 2, Cook: 1 }, restaurantId);
    expect(rows).toHaveLength(2); // Server + Cook
    const server = rows.find((r) => r.position === 'Server')!;
    expect(server.days).toEqual([5]);
    expect(server.start_time).toBe('17:00:00');
    expect(server.end_time).toBe('22:00:00');
    expect(server.capacity).toBe(2);
    expect(server.is_active).toBe(true);
    expect(server.restaurant_id).toBe(restaurantId);
    expect(server.name).toBe('Suggested · Server 17:00-22:00');
    expect(rows.reduce((s, r) => s + r.capacity, 0)).toBe(3);
  });

  it('falls back to a single generic Staff template when no crew', () => {
    const rows = shiftBlocksToTemplates([block], null, restaurantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe('Staff');
    expect(rows[0].capacity).toBe(3);
  });

  it('skips blocks with zero headcount', () => {
    expect(shiftBlocksToTemplates([{ ...block, headcount: 0 }], null, restaurantId)).toEqual([]);
  });
});
