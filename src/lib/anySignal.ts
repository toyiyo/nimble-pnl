export interface AnySignal {
  /** Aborts when one of the input signals aborts, with the reason of that signal. */
  signal: AbortSignal;
  /** Removes the listeners of the fallback. Call it when the work ends. */
  cleanup: () => void;
}

/**
 * Combines signals into one signal. It uses AbortSignal.any when the browser
 * has it. Older browsers, for example Safari before 17.4, do not have it. Then
 * one controller listens to each input signal.
 */
export function anySignal(signals: AbortSignal[]): AnySignal {
  const native = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof native === 'function') {
    return { signal: native.call(AbortSignal, signals), cleanup: () => undefined };
  }

  const controller = new AbortController();
  const listeners: Array<[AbortSignal, () => void]> = [];
  const cleanup = () => {
    for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
    listeners.length = 0;
  };

  for (const source of signals) {
    if (source.aborted) {
      cleanup();
      controller.abort(source.reason);
      return { signal: controller.signal, cleanup };
    }
    const listener = () => {
      cleanup();
      controller.abort(source.reason);
    };
    listeners.push([source, listener]);
    source.addEventListener('abort', listener, { once: true });
  }
  return { signal: controller.signal, cleanup };
}
