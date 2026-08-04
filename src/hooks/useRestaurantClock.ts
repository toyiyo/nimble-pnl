import { useMemo } from 'react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useTodayInTimezone } from '@/hooks/useTodayInTimezone';
import {
  formatInstant as formatInstantIn,
  parseWallClock as parseWallClockIn,
  safeTz,
  toBusinessDay as toBusinessDayIn,
  toWallClockInput as toWallClockInputIn,
  tzAbbrev as tzAbbrevOf,
  tzOffsetMinutes,
} from '@/lib/restaurantClock';

export interface RestaurantClock {
  tz: string;
  tzAbbrev: string;
  viewerTzDiffers: boolean;
  today: string;
  formatInstant: (value: string | Date, pattern: string) => string;
  toBusinessDay: (value: string | Date) => string;
  toWallClockInput: (value: string | Date) => string;
  parseWallClock: (wallClock: string) => string;
}

/**
 * The selected restaurant's clock — the default frame for user-visible dates.
 *
 * Identity contract: the returned object is stable across re-renders and
 * changes only when something it derives from actually changes — the
 * selected restaurant, `today` rolling over, or (see below) the viewer's or
 * restaurant's current UTC offset. Consumers may safely list its functions in
 * `useEffect`/`useCallback` dependency arrays.
 */
export function useRestaurantClock(): RestaurantClock {
  const { selectedRestaurant } = useRestaurantContext();

  // Declared immediately after the context read. Threading a local into an
  // earlier hook while declaring it lower is a TDZ ReferenceError at render
  // that tsc does not catch (memory/lessons.md:1303-1304).
  const tz = safeTz(selectedRestaurant?.restaurant?.timezone);

  const today = useTodayInTimezone(tz);

  // Computed at render time, OUTSIDE the memo, and threaded into its deps
  // below (not just captured in the closure) -- see the deps comment.
  const now = new Date();
  // Compare current UTC offsets, not IANA strings: America/Chicago and
  // US/Central name the same zone and must not trigger a cue.
  const viewerOffsetMinutes = -now.getTimezoneOffset();
  const restaurantOffsetMinutes = tzOffsetMinutes(tz, now);
  const abbrev = tzAbbrevOf(tz, now);

  // `today` MUST be in the deps. Without it the closures capture the mount-day
  // value and a long-lived page stops rolling over at midnight — the exact
  // behaviour useTodayInTimezone exists to provide.
  //
  // abbrev/viewerOffsetMinutes/restaurantOffsetMinutes MUST also be in the
  // deps, computed above (not inside the memo callback): US DST transitions
  // land at 02:00 local, which is AFTER the restaurant's midnight rollover
  // that changes `today`. Between 02:00 and the next midnight, `tz` and
  // `today` are both unchanged, so a memo keyed only on `[tz, today]` would
  // keep serving the pre-transition tzAbbrev/viewerTzDiffers for up to ~22h.
  // Recomputing these every render narrows that staleness window from "until
  // tomorrow" to "until the next render" -- there is no re-render triggered
  // by the transition itself absent a timer/interval, which is a known,
  // accepted gap (do not add one here).
  return useMemo<RestaurantClock>(() => ({
    tz,
    tzAbbrev: abbrev,
    viewerTzDiffers: viewerOffsetMinutes !== restaurantOffsetMinutes,
    today,
    formatInstant: (value, pattern) => formatInstantIn(value, tz, pattern),
    toBusinessDay: (value) => toBusinessDayIn(value, tz),
    toWallClockInput: (value) => toWallClockInputIn(value, tz),
    parseWallClock: (wallClock) => parseWallClockIn(wallClock, tz),
  }), [tz, today, abbrev, viewerOffsetMinutes, restaurantOffsetMinutes]);
}
