import { describe, it, expect, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { renderHook, act } from '@testing-library/react';
import { useSearchParamState, useSetSearchParams } from '@/hooks/useSearchParamState';
import { tabParam, groupParam, parseIsoDay } from '@/lib/schedulingUrlParams';
import type { ParamSpec } from '@/lib/schedulingUrlParams';

// Local spec: tests an ISO-day param with a generic key.
const isoDayParam: ParamSpec<string> = { key: 'week', fallback: '', parse: parseIsoDay };

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(BrowserRouter, null, children);

const setUrl = (url: string) => window.history.replaceState(null, '', url);

describe('useSearchParamState', () => {
  beforeEach(() => setUrl('/scheduling'));

  it('shows the fallback when the param is missing', () => {
    const { result } = renderHook(() => useSearchParamState(tabParam), { wrapper });
    expect(result.current[0]).toBe('schedule');
  });

  it('shows the fallback when the param is not valid', () => {
    setUrl('/scheduling?tab=bogus');
    const { result } = renderHook(() => useSearchParamState(tabParam), { wrapper });
    expect(result.current[0]).toBe('schedule');
    expect(window.location.search).toBe('?tab=bogus');
  });

  it('shows a valid value from the URL', () => {
    setUrl('/scheduling?tab=planner');
    const { result } = renderHook(() => useSearchParamState(tabParam), { wrapper });
    expect(result.current[0]).toBe('planner');
  });

  it('writes a value that differs from the fallback', () => {
    const { result } = renderHook(() => useSearchParamState(tabParam), { wrapper });
    act(() => result.current[1]('planner'));
    expect(window.location.search).toBe('?tab=planner');
    expect(result.current[0]).toBe('planner');
  });

  it('deletes the param when the value equals the fallback', () => {
    setUrl('/scheduling?tab=planner');
    const { result } = renderHook(() => useSearchParamState(tabParam), { wrapper });
    act(() => result.current[1]('schedule'));
    expect(window.location.search).toBe('');
  });

  it('keeps the param at the fallback when keepDefault is set', () => {
    const { result } = renderHook(() => useSearchParamState(groupParam), { wrapper });
    act(() => result.current[1]('none'));
    expect(window.location.search).toBe('?group=none');
  });

  it('push adds a history entry', () => {
    const { result } = renderHook(() => useSearchParamState(tabParam), { wrapper });
    const before = window.history.length;
    act(() => result.current[1]('planner', { history: 'push' }));
    expect(window.history).toHaveLength(before + 1);
  });

  it('replace does not add a history entry', () => {
    const { result } = renderHook(() => useSearchParamState(tabParam), { wrapper });
    const before = window.history.length;
    act(() => result.current[1]('planner'));
    expect(window.history).toHaveLength(before);
  });

  it('keeps other params and the hash', () => {
    setUrl('/scheduling?area=Bar&week=2026-11-09#top');
    const { result } = renderHook(() => useSearchParamState(tabParam), { wrapper });
    act(() => result.current[1]('planner'));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('area')).toBe('Bar');
    expect(params.get('week')).toBe('2026-11-09');
    expect(params.get('tab')).toBe('planner');
    expect(window.location.hash).toBe('#top');
  });

  it('keeps both values for two setter calls in one handler', () => {
    const { result } = renderHook(
      () => ({
        week: useSearchParamState(isoDayParam),
        tab: useSearchParamState(tabParam),
      }),
      { wrapper },
    );
    act(() => {
      result.current.week[1]('2026-11-09');
      result.current.tab[1]('planner');
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('week')).toBe('2026-11-09');
    expect(params.get('tab')).toBe('planner');
  });

  it('keeps the setter identity after a param change', () => {
    const { result, rerender } = renderHook(() => useSearchParamState(tabParam), { wrapper });
    const first = result.current[1];
    act(() => result.current[1]('planner'));
    rerender();
    expect(result.current[1]).toBe(first);
  });
});

describe('useSetSearchParams', () => {
  beforeEach(() => setUrl('/scheduling'));

  it('sets one param and deletes another in one write', () => {
    setUrl('/scheduling?b=old&c=keep');
    const { result } = renderHook(() => useSetSearchParams(), { wrapper });
    act(() => result.current({ a: 'x', b: null }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('a')).toBe('x');
    expect(params.has('b')).toBe(false);
    expect(params.get('c')).toBe('keep');
  });

  it('keeps a stable identity', () => {
    const { result, rerender } = renderHook(() => useSetSearchParams(), { wrapper });
    const first = result.current;
    act(() => result.current({ a: 'x' }));
    rerender();
    expect(result.current).toBe(first);
  });
});
