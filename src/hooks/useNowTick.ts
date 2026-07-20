import { useEffect, useState } from 'react';

/**
 * Returns the current epoch-ms, refreshed every `periodMs` (default 60s) and on
 * tab re-focus. Time-derived memos that read the clock (e.g. the intraday
 * open-shift "through now" synthesis) list the returned value as a dependency
 * so they recompute as time passes.
 *
 * Why this is needed: React Query's default `structuralSharing` hands back the
 * *same* array reference across content-identical refetches, so a memo keyed
 * only on the fetched rows never re-runs while a shift is open with no new
 * punches — freezing "now" at first compute. This ticker gives such memos a
 * value that actually advances. Only ticks while the tab is visible.
 */
export function useNowTick(periodMs: number = 60_000): number {
  // Guard against a busy interval from an invalid period (0, negative, NaN, ∞).
  const intervalMs = Number.isFinite(periodMs) && periodMs > 0 ? periodMs : 60_000;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible') setNowMs(Date.now());
    };
    const intervalId = window.setInterval(update, intervalMs);
    window.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, [intervalMs]);

  return nowMs;
}
