import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { useMarketplaceRange } from '@/hooks/useMarketplaceRange';
import { marketplaceRange } from '@/lib/claimableTrades';

describe('useMarketplaceRange', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the marketplace range for the host day of nowMs', () => {
    const nowMs = new Date(2026, 8, 25, 10, 30).getTime();
    const { result } = renderHook(() => useMarketplaceRange(nowMs));
    expect(result.current).toEqual(marketplaceRange(new Date(2026, 8, 25)));
  });

  it('keeps the same object on the same day and changes it on the next day', () => {
    const { result, rerender } = renderHook(({ nowMs }) => useMarketplaceRange(nowMs), {
      initialProps: { nowMs: new Date(2026, 8, 27, 9, 0).getTime() },
    });
    const first = result.current;

    rerender({ nowMs: new Date(2026, 8, 27, 23, 59).getTime() });
    expect(result.current).toBe(first);

    rerender({ nowMs: new Date(2026, 8, 28, 0, 1).getTime() });
    expect(result.current).not.toBe(first);
    expect(result.current).toEqual(marketplaceRange(new Date(2026, 8, 28)));
  });

  it('uses the current time when nowMs is not given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0));
    const { result } = renderHook(() => useMarketplaceRange());
    expect(result.current).toEqual(marketplaceRange(new Date(2026, 8, 25)));
  });
});
