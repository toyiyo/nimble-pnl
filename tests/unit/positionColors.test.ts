import { describe, it, expect } from 'vitest';
import { getPositionColors, DEFAULT_POSITION_COLORS } from '@/lib/positionColors';

describe('getPositionColors', () => {
  it('returns the server palette case-insensitively', () => {
    expect(getPositionColors('Server').text).toBe('text-blue-700 dark:text-blue-300');
    expect(getPositionColors('SERVER').bg).toBe('bg-blue-500/15');
  });
  it('falls back to default for unknown positions', () => {
    expect(getPositionColors('barista')).toEqual(DEFAULT_POSITION_COLORS);
    expect(getPositionColors('')).toEqual(DEFAULT_POSITION_COLORS);
  });
  it('maps every known position', () => {
    for (const p of ['server', 'cook', 'bartender', 'host', 'manager']) {
      expect(getPositionColors(p)).not.toEqual(DEFAULT_POSITION_COLORS);
    }
  });
});
