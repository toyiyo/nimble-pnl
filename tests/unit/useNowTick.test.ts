import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { useNowTick } from '@/hooks/useNowTick';

describe('useNowTick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an epoch-ms value that advances on each interval tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T16:00:00Z'));

    const { result } = renderHook(() => useNowTick(60_000));
    const first = result.current;
    expect(typeof first).toBe('number');

    vi.setSystemTime(new Date('2026-07-20T16:01:00Z'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBeGreaterThan(first);
  });

  it('falls back to a 60s interval for an invalid period (no busy loop)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T16:00:00Z'));

    const { result } = renderHook(() => useNowTick(0)); // invalid → normalized to 60s
    const first = result.current;

    // A sub-60s advance must NOT tick (would fire immediately on a 0ms interval).
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(first);

    vi.setSystemTime(new Date('2026-07-20T16:01:00Z'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBeGreaterThan(first);
  });
});
