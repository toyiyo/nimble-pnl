import { useEffect, useState } from 'react';

import { getTodayInTimezone } from '@/lib/timezone';

/**
 * The current restaurant-tz date (`YYYY-MM-DD`), kept fresh across midnight.
 *
 * `getTodayInTimezone` reads `new Date()`, which a `useMemo`/`useState`
 * initializer captures only once — so a long-lived page (e.g. a back-office TV
 * dashboard left open) would keep treating the mount day as "today" until it
 * remounts. This hook re-checks once a minute and whenever the tab regains
 * focus/visibility, and updates state **only when the date string actually
 * changes** (the functional updater returns `prev` otherwise, so React bails out
 * of the re-render on every no-op tick). Callers thread the result into their
 * date-window `useMemo` deps so those recompute as the day rolls over.
 */
export function useTodayInTimezone(tz: string): string {
  const [todayStr, setTodayStr] = useState(() => getTodayInTimezone(tz));

  useEffect(() => {
    const refresh = () =>
      setTodayStr((prev) => {
        const next = getTodayInTimezone(tz);
        return next === prev ? prev : next;
      });
    refresh(); // resync immediately when tz changes
    const intervalId = window.setInterval(refresh, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [tz]);

  return todayStr;
}
