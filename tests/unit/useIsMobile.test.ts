import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('useIsMobile', () => {
  let matchMediaListeners: Map<string, (e: { matches: boolean }) => void>;
  let matchMediaResults: Map<string, boolean>;

  beforeEach(() => {
    vi.resetModules();
    matchMediaListeners = new Map();
    matchMediaResults = new Map();
    matchMediaResults.set('(max-width: 767px)', false);
    matchMediaResults.set('(display-mode: standalone)', false);

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });

    window.matchMedia = vi.fn((query: string) => ({
      matches: matchMediaResults.get(query) ?? false,
      media: query,
      addEventListener: vi.fn((_event: string, handler: (e: { matches: boolean }) => void) => {
        matchMediaListeners.set(query, handler);
      }),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as any;
  });

  it('returns false on desktop viewport', async () => {
    const { useIsMobile } = await import('@/hooks/use-mobile');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true on mobile viewport (< 768px)', async () => {
    matchMediaResults.set('(max-width: 767px)', true);
    Object.defineProperty(window, 'innerWidth', { value: 375 });
    const { useIsMobile } = await import('@/hooks/use-mobile');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns true in standalone PWA mode regardless of viewport width', async () => {
    matchMediaResults.set('(display-mode: standalone)', true);
    Object.defineProperty(window, 'innerWidth', { value: 1024 });
    const { useIsMobile } = await import('@/hooks/use-mobile');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('reacts to viewport changes', async () => {
    const { useIsMobile } = await import('@/hooks/use-mobile');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 375 });
      const listener = matchMediaListeners.get('(max-width: 767px)');
      listener?.({ matches: true });
    });

    expect(result.current).toBe(true);
  });
});
