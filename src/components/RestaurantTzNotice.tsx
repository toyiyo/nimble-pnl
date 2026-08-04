import { useRestaurantClock } from '@/hooks/useRestaurantClock';

/**
 * A quiet cue that times on this surface are the restaurant's, shown only when
 * the viewer's current UTC offset differs. Offsets are compared rather than
 * IANA names so America/Chicago and US/Central do not trigger it.
 */
export function RestaurantTzNotice() {
  const { tz, tzAbbrev, viewerTzDiffers } = useRestaurantClock();

  if (!viewerTzDiffers) return null;

  return (
    <p className="text-[13px] text-muted-foreground">
      Times shown in restaurant time (
      <abbr title={tz} className="no-underline">
        {tzAbbrev}
      </abbr>
      )
    </p>
  );
}
