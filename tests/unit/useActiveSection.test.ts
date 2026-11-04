import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ACTIVATION_LINE_PX, useActiveSection } from '@/hooks/useActiveSection';

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

function setTop(id: string, top: number) {
  const el = document.getElementById(id) as HTMLElement;
  el.getBoundingClientRect = () => ({ top } as DOMRect);
}

// Queue animation frames so a test can run them on demand.
let frameQueue: FrameRequestCallback[] = [];

function scrollAndFlush() {
  document.dispatchEvent(new Event('scroll'));
  const frames = frameQueue;
  frameQueue = [];
  frames.forEach((frame) => frame(0));
}

function clearSections() {
  document.body.innerHTML = '';
}

describe('useActiveSection', () => {
  beforeEach(() => {
    mockCapture.mockClear();
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    frameQueue = [];
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
      frameQueue.push(frame);
      return frameQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    mountSections(SECTION_IDS);
    // The page is at the top: every section starts below the line.
    setTop('dash-today', ACTIVATION_LINE_PX + 80);
    setTop('dash-attention', ACTIVATION_LINE_PX + 800);
    setTop('dash-cashflow', ACTIVATION_LINE_PX + 1600);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSections();
  });

  it('sets the first section as the default active section', () => {
    const { result } = renderHook(() => useActiveSection(SECTION_IDS));

    expect(result.current).toBe('dash-today');
  });

  it('makes the last section above the activation line active on scroll', () => {
    const { result } = renderHook(() => useActiveSection(SECTION_IDS));

    setTop('dash-today', -700);
    setTop('dash-attention', ACTIVATION_LINE_PX - 10);
    setTop('dash-cashflow', ACTIVATION_LINE_PX + 600);
    act(() => {
      scrollAndFlush();
    });

    expect(result.current).toBe('dash-attention');
  });

  it('keeps the first section active at the top even when a tall section fills the view', () => {
    const { result } = renderHook(() => useActiveSection(SECTION_IDS));

    act(() => {
      intersect('dash-cashflow', true, 0.9);
      scrollAndFlush();
    });

    expect(result.current).toBe('dash-today');
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
    setTop('dash-cashflow', 0);
    scrollAndFlush();

    expect(observer.disconnected).toBe(true);
    expect(frameQueue).toHaveLength(0);
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
    setTop('dash-new', ACTIVATION_LINE_PX + 2400);
    rerender({ ids: nextIds });

    act(() => {
      intersect('dash-today');
    });

    expect(result.current).toBe('dash-today');
    expect(
      mockCapture.mock.calls.filter((call) => call[1]?.section_id === 'dash-today')
    ).toHaveLength(1);
  });
});
