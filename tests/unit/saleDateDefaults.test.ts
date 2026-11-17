import { describe, it, expect, vi } from 'vitest';
import { alignDefaultEndDate, getSaleDateTimeDefaults } from '@/lib/timezone';

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
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-16T04:46:00Z'));
      expect(getSaleDateTimeDefaults('UTC')).toEqual({
        saleDate: '2026-01-16',
        saleTime: '04:46',
      });
      vi.setSystemTime(new Date('2026-01-17T05:47:00Z'));
      expect(getSaleDateTimeDefaults('UTC')).toEqual({
        saleDate: '2026-01-17',
        saleTime: '05:47',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('alignDefaultEndDate', () => {
  // 06:30 UTC on 4 Nov is 22:30 on 3 Nov in Los Angeles and 19:30 on 4 Nov in Auckland.
  const now = new Date('2026-11-04T06:30:00Z');

  it('moves a default end date to the restaurant day', () => {
    expect(alignDefaultEndDate('2026-11-03', '2026-11-03', 'Pacific/Auckland', now)).toBe('2026-11-04');
  });

  it('keeps an end date that the user changed', () => {
    expect(alignDefaultEndDate('2026-10-15', '2026-11-03', 'Pacific/Auckland', now)).toBe('2026-10-15');
  });

  it('keeps an end date that the user cleared', () => {
    expect(alignDefaultEndDate('', '2026-11-03', 'Pacific/Auckland', now)).toBe('');
  });
});
