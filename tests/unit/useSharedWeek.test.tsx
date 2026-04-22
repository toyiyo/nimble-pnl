import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { ReactNode } from 'react';

import { useSharedWeek } from '@/hooks/useSharedWeek';

function wrap(initialUrl: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="/scheduling" element={<>{children}</>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('useSharedWeek', () => {
  it('defaults to the Monday of the current week when no param is present', () => {
    const { result } = renderHook(() => useSharedWeek(), { wrapper: wrap('/scheduling') });
    expect(result.current.weekStart.getDay()).toBe(1); // Monday
    expect(result.current.weekStart.getHours()).toBe(0);
  });

  it('reads ?week=YYYY-MM-DD and returns that Monday', () => {
    const { result } = renderHook(() => useSharedWeek(), {
      wrapper: wrap('/scheduling?week=2026-04-20'),
    });
    expect(result.current.weekStart.getFullYear()).toBe(2026);
    expect(result.current.weekStart.getMonth()).toBe(3); // April
    expect(result.current.weekStart.getDate()).toBe(20);
    expect(result.current.weekStart.getDay()).toBe(1);
  });

  it('normalizes a non-Monday param to the Monday of that week', () => {
    // 2026-04-22 is a Wednesday -> Monday is 2026-04-20
    const { result } = renderHook(() => useSharedWeek(), {
      wrapper: wrap('/scheduling?week=2026-04-22'),
    });
    expect(result.current.weekStart.getDate()).toBe(20);
    expect(result.current.weekStart.getDay()).toBe(1);
  });

  it('falls back to current Monday when param is malformed', () => {
    const { result } = renderHook(() => useSharedWeek(), {
      wrapper: wrap('/scheduling?week=not-a-date'),
    });
    expect(result.current.weekStart.getDay()).toBe(1);
  });

  it('setWeekStart updates the URL param to the Monday', () => {
    const wrapper = wrap('/scheduling?week=2026-04-20');
    const { result } = renderHook(
      () => {
        const shared = useSharedWeek();
        const [params] = useSearchParams();
        return { shared, param: params.get('week') };
      },
      { wrapper },
    );
    act(() => {
      result.current.shared.setWeekStart(new Date(2026, 4, 4)); // 2026-05-04 Monday
    });
    expect(result.current.param).toBe('2026-05-04');
  });
});
