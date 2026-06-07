import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadModuleWithRetry } from '@/lib/lazyWithRetry';

function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    _map: m,
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

  it('native mode never reloads — rethrows immediately', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    await expect(
      loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, storage, reload, isNative: true }),
    ).rejects.toThrow('gone');
    expect(reload).not.toHaveBeenCalled();
  });
});
