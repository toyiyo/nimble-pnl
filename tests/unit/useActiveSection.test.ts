import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useActiveSection } from '@/hooks/useActiveSection';

const mockCapture = vi.fn();

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({ capture: mockCapture }),
}));

type ObserverCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: ObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve(el: Element) {
    this.observed = this.observed.filter((o) => o !== el);
  }

  disconnect() {
    this.disconnected = true;
  }
}

function intersect(id: string, isIntersecting = true, intersectionRatio = 0.6) {
  const observer = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];
  const target = document.getElementById(id) as Element;
  observer.callback([{ target, isIntersecting, intersectionRatio }]);
}

const SECTION_IDS = ['dash-today', 'dash-attention', 'dash-cashflow'];

function mountSections(ids: string[]) {
  ids.forEach((id) => {
    const el = document.createElement('section');
    el.id = id;
    document.body.appendChild(el);
  });
}

function clearSections() {
  document.body.innerHTML = '';
}

describe('useActiveSection', () => {
  beforeEach(() => {
    mockCapture.mockClear();
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    mountSections(SECTION_IDS);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSections();
  });

  it('sets the first section as the default active section', () => {
    const { result } = renderHook(() => useActiveSection(SECTION_IDS));

    expect(result.current).toBe('dash-today');
  });

  it('changes the active section when a new section intersects', () => {
    const { result } = renderHook(() => useActiveSection(SECTION_IDS));

    act(() => {
      intersect('dash-cashflow');
    });

    expect(result.current).toBe('dash-cashflow');
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = renderHook(() => useActiveSection(SECTION_IDS));
    const observer = FakeIntersectionObserver.instances[0];

    unmount();

    expect(observer.disconnected).toBe(true);
  });

  it('sends one dashboard_section_viewed capture per section per mount', () => {
    renderHook(() => useActiveSection(SECTION_IDS));

    act(() => {
      intersect('dash-today');
    });
    act(() => {
      intersect('dash-attention');
    });
    act(() => {
      intersect('dash-attention');
    });
    act(() => {
      intersect('dash-cashflow');
    });
    act(() => {
      intersect('dash-attention');
    });

    const attentionCalls = mockCapture.mock.calls.filter(
      (call) => call[1]?.section_id === 'dash-attention',
    );
    const cashflowCalls = mockCapture.mock.calls.filter(
      (call) => call[1]?.section_id === 'dash-cashflow',
    );
    const todayCalls = mockCapture.mock.calls.filter(
      (call) => call[1]?.section_id === 'dash-today',
    );

    expect(attentionCalls).toHaveLength(1);
    expect(cashflowCalls).toHaveLength(1);
    expect(todayCalls).toHaveLength(1);
    expect(mockCapture).toHaveBeenCalledWith('dashboard_section_viewed', {
      section_id: 'dash-attention',
    });
  });
});
