import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useRestaurantClock } from '@/hooks/useRestaurantClock';

const mockContext = vi.fn();
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockContext(),
}));

describe('useRestaurantClock', () => {
  beforeEach(() => {
    mockContext.mockReturnValue({
      selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
    });
  });

  it('binds the restaurant timezone', () => {
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.tz).toBe('America/Chicago');
    expect(result.current.toBusinessDay('2026-07-23T01:56:20Z')).toBe('2026-07-22');
  });

  it('falls back when the restaurant has no timezone', () => {
    mockContext.mockReturnValue({ selectedRestaurant: { restaurant: {} } });
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.tz).toBe('America/Chicago');
  });

  it('falls back when no restaurant is selected', () => {
    mockContext.mockReturnValue({ selectedRestaurant: null });
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.tz).toBe('America/Chicago');
  });

  it('keeps a stable object identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useRestaurantClock());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('produces a new identity when the restaurant changes', () => {
    const { result, rerender } = renderHook(() => useRestaurantClock());
    const first = result.current;
    mockContext.mockReturnValue({
      selectedRestaurant: { restaurant: { timezone: 'Pacific/Auckland' } },
    });
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current.tz).toBe('Pacific/Auckland');
  });

  // The viewer's offset is forced rather than read from the host, so these
  // assert the same thing under all three zones in the test:tz matrix.
  it('flags no mismatch when the viewer shares the restaurant offset', () => {
    // Phoenix, deliberately: it does not observe DST, so its offset is UTC-7
    // year round. Asserting against Chicago here would pass in July and fail
    // in November when the offset moves to UTC-6.
    mockContext.mockReturnValue({
      selectedRestaurant: { restaurant: { timezone: 'America/Phoenix' } },
    });
    // getTimezoneOffset is minutes WEST of UTC, so UTC-7 is +420.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(420);
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.viewerTzDiffers).toBe(false);
    vi.restoreAllMocks();
  });

  it('flags a mismatch when the viewer is in another offset', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-720); // UTC+12
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.viewerTzDiffers).toBe(true);
    vi.restoreAllMocks();
  });
});
