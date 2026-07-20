import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetToday } = vi.hoisted(() => ({ mockGetToday: vi.fn(() => '2026-07-07') }));
vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  getTodayInTimezone: mockGetToday,
}));

import { useTodayInTimezone } from '@/hooks/useTodayInTimezone';

describe('useTodayInTimezone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToday.mockReturnValue('2026-07-07');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the restaurant-tz date at mount', () => {
    const { result } = renderHook(() => useTodayInTimezone('UTC'));
    expect(result.current).toBe('2026-07-07');
  });

  it('advances when the date rolls over (1-minute poll)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTodayInTimezone('UTC'));
    expect(result.current).toBe('2026-07-07');

    mockGetToday.mockReturnValue('2026-07-08');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-07-08');
  });

  it('does not re-render when the date is unchanged on a poll tick', () => {
    vi.useFakeTimers();
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useTodayInTimezone('UTC');
    });
    const afterMount = renders;

    act(() => {
      vi.advanceTimersByTime(180_000); // three ticks, same date
    });
    // Functional updater returns `prev` → React bails out, no extra renders.
    expect(renders).toBe(afterMount);
  });
});
