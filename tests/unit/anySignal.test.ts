import { describe, it, expect, afterEach, vi } from 'vitest';
import { anySignal } from '@/lib/anySignal';

type AnyFn = typeof AbortSignal.any;

describe('anySignal', () => {
  const originalAny = (AbortSignal as { any?: AnyFn }).any;

  afterEach(() => {
    if (originalAny) {
      (AbortSignal as { any?: AnyFn }).any = originalAny;
    } else {
      delete (AbortSignal as { any?: AnyFn }).any;
    }
  });

  it('uses AbortSignal.any when it exists', () => {
    const spy = vi.fn(originalAny ?? (() => new AbortController().signal));
    (AbortSignal as { any?: AnyFn }).any = spy as unknown as AnyFn;
    const a = new AbortController();

    anySignal([a.signal]);

    expect(spy).toHaveBeenCalledWith([a.signal]);
  });

  describe('when AbortSignal.any does not exist', () => {
    const removeAny = () => {
      delete (AbortSignal as { any?: AnyFn }).any;
      expect((AbortSignal as { any?: AnyFn }).any).toBeUndefined();
    };

    it('aborts when one input aborts, with the reason of that input', () => {
      removeAny();
      const a = new AbortController();
      const b = new AbortController();
      const { signal } = anySignal([a.signal, b.signal]);

      expect(signal.aborted).toBe(false);
      const reason = new DOMException('Stop', 'TimeoutError');
      b.abort(reason);

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe(reason);
    });

    it('is aborted at once when an input is aborted before the call', () => {
      removeAny();
      const a = new AbortController();
      a.abort('early');

      const { signal } = anySignal([a.signal, new AbortController().signal]);

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe('early');
    });

    it('cleanup removes the listeners, so a later abort has no effect', () => {
      removeAny();
      const a = new AbortController();
      const remove = vi.spyOn(a.signal, 'removeEventListener');
      const { signal, cleanup } = anySignal([a.signal]);

      cleanup();
      a.abort();

      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(signal.aborted).toBe(false);
    });

    it('adds each listener with once: true', () => {
      removeAny();
      const a = new AbortController();
      const add = vi.spyOn(a.signal, 'addEventListener');

      anySignal([a.signal]);

      expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    });
  });
});
