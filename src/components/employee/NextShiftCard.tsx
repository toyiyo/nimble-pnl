import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Shift } from '@/types/scheduling';
import { formatInstant } from '@/lib/restaurantClock';

interface NextShiftCardProps {
  shifts: Shift[];
  isLoading: boolean;
  isError: boolean;
  timezone: string;
}

/**
 * The answer to "am I working?", above the week grid.
 *
 * The card never depends on the week the employee views. An employee opened
 * the page on a Sunday night, saw the week that had just ended, and did not
 * come to work.
 *
 * The card states no publish status. A shift that exists gets stated.
 *
 * The height stays constant across the three states on purpose. A collapsed
 * card would push the grid down on a page that is already painted.
 */
export function NextShiftCard({
  shifts,
  isLoading,
  isError,
  timezone,
}: NextShiftCardProps): JSX.Element {
  const [next, ...following] = shifts;

  return (
    <Card className="min-h-[132px]">
      <CardContent className="p-5">
        <p className="text-[13px] text-muted-foreground mb-2">You work next</p>

        {isLoading ? (
          <div data-testid="next-shift-loading" className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : isError ? (
          // Never state that no shift exists when the read failed. A wrong
          // line is worse than no line.
          <p className="text-[14px] text-muted-foreground">
            We couldn't load your next shift.
          </p>
        ) : !next ? (
          <p className="text-[14px] text-muted-foreground">
            No shift scheduled in the next 3 weeks.
          </p>
        ) : (
          <>
            <p className="text-[22px] font-semibold text-foreground">
              {formatInstant(next.start_time, timezone, 'EEEE')}{' '}
              {formatInstant(next.start_time, timezone, 'h:mm a')}
            </p>
            <p className="text-[14px] text-muted-foreground mt-0.5">
              {formatInstant(next.start_time, timezone, 'MMM d')} ·{' '}
              {formatInstant(next.start_time, timezone, 'h:mm a')} –{' '}
              {formatInstant(next.end_time, timezone, 'h:mm a')}
            </p>

            {following.length > 0 && (
              <div
                data-testid="next-shift-following"
                className="mt-3 pt-3 border-t border-border/40 space-y-1"
              >
                {following.map((s) => (
                  <p key={s.id} className="text-[13px] text-muted-foreground">
                    {formatInstant(s.start_time, timezone, 'EEE MMM d')} ·{' '}
                    {formatInstant(s.start_time, timezone, 'h:mm a')} –{' '}
                    {formatInstant(s.end_time, timezone, 'h:mm a')}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
