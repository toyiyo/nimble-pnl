import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { loadModuleWithRetry, lazyWithRetry } from '@/lib/lazyWithRetry';

function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}
const mod = { default: () => null };

describe('loadModuleWithRetry', () => {
  let storage: ReturnType<typeof makeStorage>;
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    storage = makeStorage();
    reload = vi.fn();
  });

  it('returns the module on success and clears the guard', async () => {
    storage.setItem('lazyWithRetry:reloaded', '1');
    const factory = vi.fn().mockResolvedValue(mod);
    const result = await loadModuleWithRetry(factory, { storage, reload, isNative: false });
    expect(result).toBe(mod);
    expect(storage.getItem('lazyWithRetry:reloaded')).toBeNull();
  });

  it('retries a transient failure then succeeds', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce(mod);
    const result = await loadModuleWithRetry(factory, { retries: 1, retryDelayMs: 0, storage, reload, isNative: false });
    expect(result).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once (web) on persistent failure when guard not set', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    // function hangs after triggering reload; assert via waitFor without awaiting it
    void loadModuleWithRetry(factory, { retries: 1, retryDelayMs: 0, storage, reload, isNative: false });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(storage.getItem('lazyWithRetry:reloaded')).toBe('1');
  });

  it('rethrows (no reload) when guard already set', async () => {
    storage.setItem('lazyWithRetry:reloaded', '1');
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    await expect(
      loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, storage, reload, isNative: false }),
    ).rejects.toThrow('gone');
    expect(reload).not.toHaveBeenCalled();
  });

  it('storage unavailable (null) — rethrows without reloading to prevent infinite loop', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    await expect(
      loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, storage: null, reload, isNative: false }),
    ).rejects.toThrow('gone');
    expect(reload).not.toHaveBeenCalled();
  });

  it('native mode never reloads — rethrows immediately', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    await expect(
      loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, storage, reload, isNative: true }),
    ).rejects.toThrow('gone');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('default dependency wiring (real defaults, no injection)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
  });

  it('lazyWithRetry renders the lazily-loaded component (covers wrapper + default storage)', async () => {
    const Lazy = lazyWithRetry(
      () => Promise.resolve({ default: () => React.createElement('div', null, 'lazy-loaded') }),
      { isNative: false },
    );
    render(
      React.createElement(
        Suspense,
        { fallback: React.createElement('span', null, 'loading') },
        React.createElement(Lazy),
      ),
    );
    expect(await screen.findByText('lazy-loaded')).toBeInTheDocument();
  });

  it('detectNative default: no Capacitor global → treated as web (reload enabled)', async () => {
    const reload = vi.fn();
    const storage = makeStorage();
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    // omit isNative → exercises detectNative() (no Capacitor → false → reloadOnFail=true)
    void loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, storage, reload });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('detectNative default: Capacitor native → never reloads', async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const reload = vi.fn();
    const storage = makeStorage();
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    await expect(
      loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, storage, reload }),
    ).rejects.toThrow('gone');
    expect(reload).not.toHaveBeenCalled();
  });

  it('default reload calls globalThis.location.reload (covers the default reload arrow)', async () => {
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { reload: reloadSpy });
    const storage = makeStorage();
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    // omit reload → exercises the default `() => globalThis.location.reload()`
    void loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, storage, isNative: false });
    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
  });

  it('default storage uses sessionStorage when available (covers safeSessionStorage)', async () => {
    globalThis.sessionStorage.removeItem('lazyWithRetry:reloaded');
    const factory = vi.fn().mockResolvedValue({ default: () => null });
    // omit storage → exercises safeSessionStorage() success branch
    const result = await loadModuleWithRetry(factory, { retries: 0, isNative: false });
    expect(result).toBeTruthy();
  });

  it('safeSessionStorage swallows access errors (covers catch → null → no reload)', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('sessionStorage blocked'); },
    });
    const reload = vi.fn();
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    try {
      // omit storage → safeSessionStorage() throws → caught → undefined → null → rethrow, no reload
      await expect(
        loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, reload, isNative: false }),
      ).rejects.toThrow('gone');
      expect(reload).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    }
  });
});
