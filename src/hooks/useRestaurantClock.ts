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
 * changes at most once per day (when `today` rolls over) plus whenever the
 * selected restaurant changes. Consumers may safely list its functions in
 * `useEffect`/`useCallback` dependency arrays.
 */
export function useRestaurantClock(): RestaurantClock {
  const { selectedRestaurant } = useRestaurantContext();

  // Declared immediately after the context read. Threading a local into an
  // earlier hook while declaring it lower is a TDZ ReferenceError at render
  // that tsc does not catch (memory/lessons.md:1303-1304).
  const tz = safeTz(selectedRestaurant?.restaurant?.timezone);

  const today = useTodayInTimezone(tz);

  // `today` MUST be in the deps. Without it the closures capture the mount-day
  // value and a long-lived page stops rolling over at midnight — the exact
  // behaviour useTodayInTimezone exists to provide.
  return useMemo<RestaurantClock>(() => {
    const now = new Date();
    // Compare current UTC offsets, not IANA strings: America/Chicago and
    // US/Central name the same zone and must not trigger a cue.
    const viewerOffset = -now.getTimezoneOffset();
    const viewerTzDiffers = viewerOffset !== tzOffsetMinutes(tz, now);

    return {
      tz,
      tzAbbrev: tzAbbrevOf(tz, now),
      viewerTzDiffers,
      today,
      formatInstant: (value, pattern) => formatInstantIn(value, tz, pattern),
      toBusinessDay: (value) => toBusinessDayIn(value, tz),
      toWallClockInput: (value) => toWallClockInputIn(value, tz),
      parseWallClock: (wallClock) => parseWallClockIn(wallClock, tz),
    };
  }, [tz, today]);
}
