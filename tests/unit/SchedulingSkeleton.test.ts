import { describe, it, expect } from 'vitest';
import { SKELETON_ROWS, SKELETON_DAYS } from '@/pages/Scheduling';

describe('Scheduling skeleton keys', () => {
  it('provides stable row keys', () => {
    expect(SKELETON_ROWS).toEqual(['row-0', 'row-1', 'row-2', 'row-3']);
    expect(new Set(SKELETON_ROWS).size).toBe(SKELETON_ROWS.length);
  });

  it('provides stable day keys', () => {
    expect(SKELETON_DAYS).toEqual([
      'day-0',
      'day-1',
      'day-2',
      'day-3',
      'day-4',
      'day-5',
      'day-6',
    ]);
    expect(new Set(SKELETON_DAYS).size).toBe(SKELETON_DAYS.length);
  });
});
