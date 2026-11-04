import { formatInstant, toBusinessDay } from '@/lib/restaurantClock';
import type { RestaurantClock } from '@/hooks/useRestaurantClock';

/**
 * Build a real `RestaurantClock` from the production library functions
 * (`src/lib/restaurantClock.ts`), so a test fake cannot drift from production
 * behaviour. `tz` fixes the restaurant zone. `today` defaults to `tz`'s
 * current business day when omitted; pass it explicitly to pin "Today" to a
 * fixed calendar day regardless of the system clock.
 *
 * `toWallClockInput` and `parseWallClock` exist only to satisfy the
 * `RestaurantClock` shape — the components under test in this suite do not
 * call them.
 */
export function makeClock(tz = 'UTC', today: string = toBusinessDay(new Date(), tz)): RestaurantClock {
  return {
    tz,
    tzAbbrev: '',
    viewerTzDiffers: false,
    today,
    formatInstant: (value, pattern) => formatInstant(value, tz, pattern),
    toBusinessDay: (value) => toBusinessDay(value, tz),
    toWallClockInput: (value) => formatInstant(value, tz, "yyyy-MM-dd'T'HH:mm"),
    parseWallClock: (wallClock) => wallClock,
  };
}
