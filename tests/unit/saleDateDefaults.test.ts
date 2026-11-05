import { describe, it, expect } from 'vitest';
import { getSaleDateTimeDefaults } from '@/lib/timezone';

describe('getSaleDateTimeDefaults', () => {
  it('gives the restaurant day and time at 22:46 CST (after UTC midnight)', () => {
    // 2026-01-16T04:46Z is 2026-01-15 22:46 in America/Chicago (CST, UTC-6)
    const now = new Date(Date.UTC(2026, 0, 16, 4, 46));
    expect(getSaleDateTimeDefaults('America/Chicago', now)).toEqual({
      saleDate: '2026-01-15',
      saleTime: '22:46',
    });
  });

  it('uses the same zone for date and time in a zone ahead of UTC', () => {
    // 2026-01-15T20:30Z is 2026-01-16 05:30 in Asia/Tokyo (UTC+9)
    const now = new Date(Date.UTC(2026, 0, 15, 20, 30));
    expect(getSaleDateTimeDefaults('Asia/Tokyo', now)).toEqual({
      saleDate: '2026-01-16',
      saleTime: '05:30',
    });
  });

  it('uses the current time when now is not given', () => {
    const result = getSaleDateTimeDefaults('UTC');
    expect(result.saleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.saleTime).toMatch(/^\d{2}:\d{2}$/);
  });
});
