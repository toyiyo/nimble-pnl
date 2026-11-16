import React, { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { BrowserRouter, useSearchParams } from 'react-router-dom';

import { useSharedWeek } from '@/hooks/useSharedWeek';
import { useSetSearchParams } from '@/hooks/useSearchParamState';

function wrap(initialUrl: string) {
  window.history.replaceState(null, '', initialUrl);
  return ({ children }: { children: ReactNode }) => <BrowserRouter>{children}</BrowserRouter>;
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
    expect(result.current.shared.weekStart.getFullYear()).toBe(2026);
    expect(result.current.shared.weekStart.getMonth()).toBe(4); // May (0-indexed)
    expect(result.current.shared.weekStart.getDate()).toBe(4);
  });

  it('keeps the week and a tab param when both setters run in one handler', () => {
    const wrapper = wrap('/scheduling?week=2026-04-20');
    const { result } = renderHook(
      () => ({ shared: useSharedWeek(), setParams: useSetSearchParams() }),
      { wrapper },
    );
    act(() => {
      result.current.shared.setWeekStart(new Date(2026, 4, 4));
      result.current.setParams({ tab: 'planner' });
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('week')).toBe('2026-05-04');
    expect(params.get('tab')).toBe('planner');
  });
});
