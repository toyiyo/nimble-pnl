import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// `2026-07-09T02:30:00Z` is a fixed UTC instant chosen so the restaurant's
// zone and the DEFAULT_TIMEZONE ('America/Chicago') fallback land on
// *different* calendar days:
//   - Pacific/Auckland (NZST, +12 in July): 2026-07-09 14:30 -> "Jul 09, 2026"
//   - America/Chicago (CDT, -5 in July):    2026-07-08 21:30 -> "Jul 08, 2026"
// Using an explicit UTC instant (rather than `new Date(y, m, d, h)`, which
// reads host-local fields) keeps the expectations correct under any host TZ.
const INSTANT = '2026-07-09T02:30:00Z';
const FORMAT = 'MMM dd, yyyy';

const mockRestaurantContext = vi.hoisted(() => ({
  selectedRestaurant: null as { restaurant: { timezone?: string | null } } | null,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockRestaurantContext,
}));

import { useDateFormat } from '@/hooks/useDateFormat';

describe('useDateFormat', () => {
  beforeEach(() => {
    mockRestaurantContext.selectedRestaurant = null;
  });

  it('formats dates in the restaurant\'s timezone when it is valid and non-default', () => {
    mockRestaurantContext.selectedRestaurant = { restaurant: { timezone: 'Pacific/Auckland' } };

    const { result } = renderHook(() => useDateFormat());

    expect(result.current.timezone).toBe('Pacific/Auckland');
    expect(result.current.formatTransactionDate(INSTANT, FORMAT)).toBe('Jul 09, 2026');
  });

  it('falls back to America/Chicago when selectedRestaurant is undefined', () => {
    mockRestaurantContext.selectedRestaurant = null;

    const { result } = renderHook(() => useDateFormat());

    expect(result.current.timezone).toBe('America/Chicago');
    expect(result.current.formatTransactionDate(INSTANT, FORMAT)).toBe('Jul 08, 2026');
  });

  it('falls back to America/Chicago for an invalid IANA zone instead of throwing', () => {
    mockRestaurantContext.selectedRestaurant = { restaurant: { timezone: 'Not/AZone' } };

    const { result } = renderHook(() => useDateFormat());

    expect(result.current.timezone).toBe('America/Chicago');
    expect(() => result.current.formatTransactionDate(INSTANT, FORMAT)).not.toThrow();
    expect(result.current.formatTransactionDate(INSTANT, FORMAT)).toBe('Jul 08, 2026');
  });
});
