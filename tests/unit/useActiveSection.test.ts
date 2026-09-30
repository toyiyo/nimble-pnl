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

  it('does not observe while ready is false, then observes once ready flips to true', () => {
    clearSections();
    const { rerender } = renderHook(
      ({ ready }) => useActiveSection(SECTION_IDS, ready),
      { initialProps: { ready: false } },
    );

    expect(FakeIntersectionObserver.instances).toHaveLength(0);

    mountSections(SECTION_IDS);
    rerender({ ready: true });

    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    expect(FakeIntersectionObserver.instances[0].observed).toHaveLength(SECTION_IDS.length);
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

  it('keeps a section marked viewed across an observer rebuild when sectionIds changes', () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useActiveSection(ids),
      { initialProps: { ids: SECTION_IDS } },
    );

    act(() => {
      intersect('dash-today');
    });
    expect(
      mockCapture.mock.calls.filter((call) => call[1]?.section_id === 'dash-today')
    ).toHaveLength(1);

    // sectionIds changes reference and content (for example a query moving
    // from loading to loaded data adds a new section), which rebuilds the
    // observer.
    const nextIds = [...SECTION_IDS, 'dash-new'];
    mountSections(['dash-new']);
    rerender({ ids: nextIds });

    act(() => {
      intersect('dash-today');
    });

    expect(result.current).toBe('dash-today');
    expect(
      mockCapture.mock.calls.filter((call) => call[1]?.section_id === 'dash-today')
    ).toHaveLength(1);
  });

  it('picks the section covering the most viewport height as active, not the highest intersectionRatio', () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });

    const { result } = renderHook(() => useActiveSection(SECTION_IDS));

    act(() => {
      const observer =
        FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];
      // A short section with a high ratio but little viewport coverage
      // (for example a header just scrolling into view)...
      const shortEl = document.getElementById('dash-attention') as Element;
      // ...versus a section taller than the viewport, which can never
      // reach a high intersectionRatio but fills most of the screen.
      const tallEl = document.getElementById('dash-cashflow') as Element;

      observer.callback([
        {
          target: shortEl,
          isIntersecting: true,
          intersectionRatio: 0.9,
          intersectionRect: { height: 90 } as DOMRectReadOnly,
        },
        {
          target: tallEl,
          isIntersecting: true,
          intersectionRatio: 0.3,
          intersectionRect: { height: 700 } as DOMRectReadOnly,
        },
      ]);
    });

    expect(result.current).toBe('dash-cashflow');

    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
  });
});
