import { memo } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import type { DailyLaborPercentView } from '@/lib/dailyLaborPercent';

import {
  describeDailyLaborPercent,
  formatDailyLaborPercent,
  formatDollars,
} from '@/lib/dailyLaborPercent';
import { cn } from '@/lib/utils';

type DailyLaborPercentBadgeVariant = 'tooltip' | 'plain';

interface DailyLaborPercentBadgeProps {
  labor: DailyLaborPercentView;
  /** Day as `yyyy-MM-dd`. */
  day: string;
  /** Day name for the screen reader label, for example "Mon, Sep 28". */
  dayLabel: string;
  /**
   * `tooltip` (default) is a focusable label with a detail tooltip.
   * `plain` is text only, for use inside a parent button.
   */
  variant?: DailyLaborPercentBadgeVariant;
  /** True on a `bg-foreground` parent (a selected day button). */
  inverse?: boolean;
}

function toneClass(overTarget: boolean, inverse: boolean): string {
  // Red (not the amber of the planner's hourly bars) keeps its contrast on
  // both the plain header and the inverse selected-day button.
  if (overTarget) return 'text-destructive';
  if (inverse) return 'text-background/80';
  return 'text-muted-foreground';
}

/**
 * Daily labor cost % for a schedule day header: scheduled labor cost divided
 * by the projected sales for the day. Red when the percent is over the target.
 */
export const DailyLaborPercentBadge = memo(function DailyLaborPercentBadge({
  labor,
  day,
  dayLabel,
  variant = 'tooltip',
  inverse = false,
}: Readonly<DailyLaborPercentBadgeProps>) {
  if (labor.isLoading) {
    // A <span>, not the <div> Skeleton: the plain variant renders inside a <button>.
    return (
      <span
        data-testid="daily-labor-percent-loading"
        className="block h-3 w-12 mx-auto mt-1 animate-pulse rounded bg-muted"
      />
    );
  }

  const value = labor.hasError ? undefined : labor.byDay.get(day);
  const text = formatDailyLaborPercent(value);
  const textClass = cn(
    'block text-[11px] font-medium tabular-nums whitespace-nowrap',
    toneClass(value?.overTarget ?? false, inverse),
  );

  if (variant === 'plain') {
    return <span className={textClass}>{text}</span>;
  }

  const description = describeDailyLaborPercent(value, dayLabel, labor);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={description}
            className={cn(
              textClass,
              'mt-1 cursor-default rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
            )}
          >
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[12px] space-y-0.5">
          {value && value.percent !== null ? (
            <>
              <p>Scheduled labor: {formatDollars(value.laborCost)}</p>
              <p>Projected sales: {formatDollars(value.projectedSales)}</p>
              <p className="text-muted-foreground">
                Target {labor.targetLaborPct}% · average of the last {labor.lookbackWeeks} weeks
              </p>
            </>
          ) : (
            <p>{description}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
